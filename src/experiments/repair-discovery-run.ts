import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CodexCliGateway,
  codexCliProfileRef,
} from "../adapters/models/codex-cli.ts";
import type { TypedModelGateway } from "../adapters/models/typed.ts";
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import type { JsonValue } from "../core/graph.ts";
import { repairDiscoveryTasks } from "../fixtures/repair-discovery.ts";
import {
  CentralHypothesisRunner,
  centralIsolationProfile,
} from "../runtime/central-hypothesis-isolation.ts";
import {
  centralWorkflowPrompt,
  runCentralWorkflow,
} from "../runtime/central-hypothesis-workflow.ts";
import type { IsolatedCommandRunner } from "../runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../storage/sqlite.ts";
import { qualifyRepairDiscovery } from "./repair-discovery-qualification.ts";

const model = "gpt-5.6-luna";
const reasoningEffort = "low" as const;
const limits = { inputTokens: 30_000, outputTokens: 8_000, timeoutMs: 120_000 };
type Branch = "initial" | "feedback" | "fresh";
type Result = Awaited<ReturnType<typeof runCentralWorkflow>>;
type RecordEntry = {
  taskIndex: number;
  taskRef: string;
  branch: Branch;
  runId: string;
  parentAttemptId: string | null;
  publicEvaluationId: string | null;
  seedFingerprint: string | null;
  result: Result | null;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;
const runId = (index: number, branch: Branch) =>
  `repair-discovery/${index}/${branch}`;
export const repairSchedule = repairDiscoveryTasks.map((entry, index) => ({
  taskRef: entry.task.ref,
  initial: runId(index, "initial"),
  branches: (index % 2 === 0
    ? ["feedback", "fresh"]
    : ["fresh", "feedback"]) as ("feedback" | "fresh")[],
}));

/** Runs exactly one shared prefix per task; only its public outcome admits branches. */
export async function executeRepairDiscovery(input: {
  store: SqliteRunStore;
  gateway: () => TypedModelGateway;
  runner: IsolatedCommandRunner;
  manifestFingerprint: string;
  signal: AbortSignal;
  persist: (value: ReturnType<typeof report>) => void;
}) {
  const records: RecordEntry[] = [];
  const publish = (status: string, reason: string | null = null) => {
    const value = report(
      records,
      input.store,
      input.manifestFingerprint,
      status,
      reason,
    );
    input.persist(value);
    return value;
  };
  const execute = async (index: number, branch: Branch, initial?: Result) => {
    const entry = repairDiscoveryTasks[index];
    if (!entry) throw new Error("unknown task index");
    let seed:
      | {
          artifact: string;
          publicDiagnostics: { stdout: string; stderr: string };
        }
      | undefined;
    const parentAttemptId = initial?.attemptIds[0] ?? null;
    const publicEvaluationId =
      parentAttemptId === null ? null : `${parentAttemptId}/public`;
    if (branch !== "initial") {
      if (
        !initial ||
        initial.stopReason !== null ||
        initial.publicPassed ||
        parentAttemptId === null ||
        publicEvaluationId === null
      )
        throw new Error("branch requires a completed public failure");
      const evaluation = input.store.getM3TaskEvaluation(publicEvaluationId);
      if (
        evaluation?.outcome !== "failed" ||
        evaluation.taskRef !== entry.task.ref ||
        evaluation.command === null
      )
        throw new Error("branch public evidence missing or mismatched");
      if (branch === "feedback") {
        const command = evaluation.command as {
          stdout?: unknown;
          stderr?: unknown;
        };
        if (
          typeof command.stdout !== "string" ||
          typeof command.stderr !== "string"
        )
          throw new Error("public diagnostic is malformed");
        seed = {
          artifact: canonicalJson(evaluation.patch),
          publicDiagnostics: {
            stdout: command.stdout.slice(0, 4096),
            stderr: command.stderr.slice(0, 4096),
          },
        };
      }
    }
    if (records.length >= 9) throw new Error("attempt schedule exhausted");
    const record: RecordEntry = {
      taskIndex: index,
      taskRef: entry.task.ref,
      branch,
      runId: runId(index, branch),
      parentAttemptId,
      publicEvaluationId,
      seedFingerprint: seed ? hashCanonicalJson(seed) : null,
      result: null,
    };
    records.push(record);
    // Persist branch attribution before dispatch; provider intent then commits
    // separately in SQLite. Interrupted manifests are never replayed.
    publish("incomplete");
    record.result = await runCentralWorkflow(
      input.store,
      input.gateway(),
      {
        runId: record.runId,
        modelRef: model,
        configurationFingerprint: hashCanonicalJson({
          manifest: input.manifestFingerprint,
          branch,
          parentAttemptId,
          publicEvaluationId,
          seedFingerprint: record.seedFingerprint,
        }),
        task: entry.task,
        hiddenFiles: entry.hiddenFiles,
        workflow: branch === "feedback" ? "feedback" : "direct",
        ...(seed ? { feedbackSeed: seed } : {}),
        limits,
        occurredAt: () => new Date().toISOString(),
        runner: input.runner,
        evaluationProfile: {
          ref: centralIsolationProfile.ref,
          fingerprint: hashCanonicalJson({
            profile: centralIsolationProfile,
            manifest: input.manifestFingerprint,
          }),
        },
      },
      input.signal,
    );
    publish("incomplete");
    return record.result;
  };
  const stopReason = (result: Result) =>
    result.stopReason ??
    (!["verified", "failed"].includes(result.outcome)
      ? `artifact or evaluation failure: ${result.outcome}`
      : null);
  try {
    publish("incomplete");
    // Freeze and execute all initial attempts before opening any branch.
    const initials: Result[] = [];
    for (const [index] of repairDiscoveryTasks.entries()) {
      if (input.signal.aborted)
        return publish("stopped", "interrupted; no replay");
      const initial = await execute(index, "initial");
      initials.push(initial);
      const reason = stopReason(initial);
      if (reason) return publish("stopped", reason);
    }
    for (const [index, initial] of initials.entries()) {
      if (initial.publicPassed) continue;
      for (const branch of repairSchedule[index]?.branches ?? []) {
        if (input.signal.aborted)
          return publish("stopped", "interrupted; no replay");
        const result = await execute(index, branch, initial);
        const reason = stopReason(result);
        if (reason) return publish("stopped", reason);
      }
    }
    return publish("complete");
  } catch (error) {
    return publish(
      "stopped",
      `infrastructure: ${String(error)}; inspect durable attempts; no replay`,
    );
  }
}

function report(
  records: readonly RecordEntry[],
  store: SqliteRunStore,
  manifestFingerprint: string,
  status: string,
  reason: string | null,
) {
  const attempts = records.flatMap((record) => {
    const attempt = store.getProviderAttempt(`${record.runId}/attempt/1`);
    if (!attempt) return [];
    const terminal = attempt.terminal as {
      usage?: {
        totalTokens?: number | null;
        inputTokens?: number | null;
        outputTokens?: number | null;
        cachedInputTokens?: number | null;
      };
    } | null;
    return [
      {
        attemptId: attempt.attemptId,
        lifecycle: attempt.lifecycle,
        usage: terminal?.usage ?? null,
      },
    ];
  });
  const policies = (branch: "feedback" | "fresh") => {
    const tasks = repairDiscoveryTasks.map((entry, index) => {
      const initial = records.find(
        (r) => r.taskIndex === index && r.branch === "initial",
      );
      const continuation = records.find(
        (r) => r.taskIndex === index && r.branch === branch,
      );
      const selected = initial?.result?.publicPassed ? initial : continuation;
      const tokens = initial?.result?.totalTokens;
      const extra = initial?.result?.publicPassed
        ? 0
        : continuation?.result?.totalTokens;
      return {
        taskRef: entry.task.ref,
        selectedRunId: selected?.runId ?? null,
        outcome: selected?.result?.outcome ?? null,
        totalTokens: tokens == null || extra == null ? null : tokens + extra,
      };
    });
    return {
      tasks,
      successes: tasks.filter((t) => t.outcome === "verified").length,
      totalTokens: tasks.some((t) => t.totalTokens === null)
        ? null
        : tasks.reduce((n, t) => n + (t.totalTokens ?? 0), 0),
    };
  };
  const feedback = policies("feedback"),
    fresh = policies("fresh");
  const publicFailures = records.filter(
    (r) =>
      r.branch === "initial" && r.result?.evaluations[0]?.outcome === "failed",
  ).length;
  const hiddenOnlyFailures = records.filter(
    (r) =>
      r.branch === "initial" &&
      r.result?.publicPassed &&
      r.result.outcome === "failed",
  ).length;
  const feedbackOnlyRecoveries = feedback.tasks.filter(
    (t, i) => t.outcome === "verified" && fresh.tasks[i]?.outcome === "failed",
  ).length;
  const freshOnlyRecoveries = fresh.tasks.filter(
    (t, i) =>
      t.outcome === "verified" && feedback.tasks[i]?.outcome === "failed",
  ).length;
  return {
    manifestFingerprint,
    status,
    reason,
    records: json(records),
    attempts,
    actualKnownTotalTokens: attempts.reduce(
      (n, a) => n + (a.usage?.totalTokens ?? 0),
      0,
    ),
    unknownUsageAttempts: attempts.filter((a) => a.usage?.totalTokens == null)
      .length,
    policies: { feedback, fresh },
    publicFailures,
    hiddenOnlyFailures,
    feedbackOnlyRecoveries,
    freshOnlyRecoveries,
    decision:
      status !== "complete"
        ? "inconclusive"
        : publicFailures === 0
          ? hiddenOnlyFailures > 0
            ? "public-verifier-gap"
            : "no-retry-opportunity"
          : feedbackOnlyRecoveries > 0
            ? "development-signal-requires-replication"
            : "no-feedback-benefit-observed",
    monetaryCost: null,
    assessmentExecuted: false,
    promoted: false,
  };
}

function snapshot() {
  const implementation = Object.fromEntries(
    [
      "src/experiments/repair-discovery-run.ts",
      "src/experiments/repair-discovery-qualification.ts",
      "src/fixtures/repair-discovery.ts",
      "src/runtime/central-hypothesis-workflow.ts",
      "src/runtime/central-hypothesis-isolation.ts",
      "src/runtime/typescript-refactor-evaluator.ts",
      "src/runtime/provider-attempt.ts",
      "src/adapters/models/codex-cli.ts",
      "src/storage/sqlite.ts",
      "docs/tasks/repair-discovery-protocol.md",
    ].map((path) => [path, readFileSync(path, "utf8")]),
  );
  const corpus = json(repairDiscoveryTasks);
  return {
    implementation,
    corpus,
    identity: hashCanonicalJson({
      implementation,
      corpus,
      profile: centralIsolationProfile,
    }),
  };
}
function save(directory: string, name: string, value: unknown) {
  const path = join(directory, name);
  writeFileSync(`${path}.tmp`, canonicalJson(json(value)));
  renameSync(`${path}.tmp`, path);
}
export async function qualifyRepairComparison(directory: string) {
  mkdirSync(directory, { recursive: true });
  if (existsSync(join(directory, "manifest.json")))
    throw new Error("launched manifest cannot be requalified");
  const frozen = snapshot();
  const qualification = await qualifyRepairDiscovery(
    new CentralHypothesisRunner(),
  );
  save(directory, "qualification.json", {
    ...qualification,
    identity: frozen.identity,
  });
  return qualification.qualified;
}
export async function runRepairComparison(directory: string) {
  const frozen = snapshot();
  const qualification = JSON.parse(
    readFileSync(join(directory, "qualification.json"), "utf8"),
  );
  if (
    qualification.qualified !== true ||
    qualification.identity !== frozen.identity ||
    qualification.checks?.length !== 30
  )
    throw new Error("exact controller and corpus must qualify before launch");
  const manifest = {
    ref: "repair-discovery/comparison@1",
    identity: frozen.identity,
    model,
    reasoningEffort,
    limits,
    maxProviderAttempts: 9,
    profile: codexCliProfileRef,
    isolation: centralIsolationProfile,
    schedule: repairSchedule,
    initialPrompts: repairDiscoveryTasks.map((entry) =>
      centralWorkflowPrompt(entry.task),
    ),
    qualificationFingerprint: hashCanonicalJson(qualification),
  };
  const manifestFingerprint = hashCanonicalJson(manifest);
  writeFileSync(
    join(directory, "manifest.json"),
    canonicalJson({ ...manifest, manifestFingerprint }),
    { flag: "wx" },
  );
  save(directory, "implementation.json", frozen.implementation);
  save(directory, "corpus.json", frozen.corpus);
  const store = await SqliteRunStore.open(directory);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("comparison interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    return await executeRepairDiscovery({
      store,
      manifestFingerprint,
      signal: controller.signal,
      runner: new CentralHypothesisRunner(),
      gateway: () =>
        new CodexCliGateway({
          workingDirectory: mkdtempSync(join(tmpdir(), "repair-comparison-")),
          reasoningEffort,
          timeoutMs: limits.timeoutMs,
        }),
      persist: (value) => save(directory, "report.json", value),
    });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await store.close();
  }
}
if (import.meta.main) {
  const [directory, mode, ...extra] = process.argv.slice(2);
  if (
    !directory ||
    extra.length ||
    !["--qualify", "--run"].includes(mode ?? "")
  )
    throw new Error(
      "usage: bun src/experiments/repair-discovery-run.ts <new-state-directory> --qualify|--run",
    );
  if (mode === "--qualify") {
    const qualified = await qualifyRepairComparison(resolve(directory));
    process.stdout.write(
      `${JSON.stringify({ qualified, providerAttempts: 0 })}\n`,
    );
    if (!qualified) process.exitCode = 1;
  } else {
    const value = await runRepairComparison(resolve(directory));
    process.stdout.write(
      `${JSON.stringify({ status: value.status, decision: value.decision, tokens: value.actualKnownTotalTokens })}\n`,
    );
    if (value.status !== "complete") process.exitCode = 1;
  }
}
