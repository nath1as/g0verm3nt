import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CodexCliGateway,
  codexCliProfileRef,
} from "../adapters/models/codex-cli.ts";
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import type { JsonValue } from "../core/graph.ts";
import { centralTasks } from "../fixtures/central-hypothesis.ts";
import {
  CentralHypothesisRunner,
  centralIsolationProfile,
} from "../runtime/central-hypothesis-isolation.ts";
import { runCentralWorkflow } from "../runtime/central-hypothesis-workflow.ts";
import {
  evaluateTypescriptRefactorPatch,
  makeRestrictedPatch,
} from "../runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../storage/sqlite.ts";

export type DiscoveryCell = {
  taskRef: string;
  localImport: boolean;
  multipleExports: boolean;
  workflow: "direct" | "feedback";
  outcome: string;
  totalTokens: number | null;
};

/** Discovery cannot establish an assessment or promotion result. */
export function discoveryDecision(cells: readonly DiscoveryCell[]) {
  const discovery = centralTasks.filter((entry) => entry.phase === "discovery");
  if (cells.length !== discovery.length * 2)
    return { status: "incomplete", reason: "discovery schedule is incomplete" };
  const winners: string[] = [];
  let directSuccesses = 0;
  for (const entry of discovery) {
    const matched = cells.filter((cell) => cell.taskRef === entry.task.ref);
    const direct = matched.filter((cell) => cell.workflow === "direct");
    const feedback = matched.filter((cell) => cell.workflow === "feedback");
    if (direct.length !== 1 || feedback.length !== 1)
      throw new Error("discovery cells are not uniquely paired");
    const d = direct[0];
    const f = feedback[0];
    if (!d || !f) throw new Error("missing discovery cell");
    if (d.totalTokens === null || f.totalTokens === null)
      return { status: "inconclusive", reason: "discovery usage is unknown" };
    const ds = d.outcome === "verified";
    const fs = f.outcome === "verified";
    if (ds) directSuccesses += 1;
    winners.push(
      fs && (!ds || f.totalTokens < d.totalTokens) ? "feedback" : "direct",
    );
  }
  if (directSuccesses === discovery.length)
    return {
      status: "no-useful-tradeoff",
      reason:
        "direct verified every discovery task; no observed quality benefit justifies learning when to retry",
    };
  if (new Set(winners).size === 1)
    return {
      status: "no-useful-tradeoff",
      reason: "discovery selects the same fixed workflow on every task",
    };
  return {
    status: "candidate-needed",
    reason:
      "discovery contains workflow differences; a frozen candidate must be proposed before assessment",
  };
}

function frozenManifest() {
  const codePaths = [
    "src/experiments/central-hypothesis-run.ts",
    "src/fixtures/central-hypothesis.ts",
    "src/runtime/central-hypothesis-workflow.ts",
    "src/runtime/central-hypothesis-isolation.ts",
    "src/runtime/typescript-refactor-evaluator.ts",
    "src/runtime/provider-attempt.ts",
    "src/adapters/models/codex-cli.ts",
    "src/storage/sqlite.ts",
    "docs/tasks/central-hypothesis-experiment.md",
  ];
  return {
    ref: "central-hypothesis/discovery@1",
    model: "gpt-6-astra",
    executorProfile: codexCliProfileRef,
    isolation: centralIsolationProfile,
    taskCorpusFingerprint: hashCanonicalJson(
      centralTasks as unknown as JsonValue,
    ),
    tasks: centralTasks.map((entry) => ({
      ref: entry.task.ref,
      phase: entry.phase,
      features: entry.features,
      publicFingerprint: hashCanonicalJson(entry.task as unknown as JsonValue),
      hiddenFingerprint: hashCanonicalJson(entry.hiddenFiles),
    })),
    implementation: Object.fromEntries(
      codePaths.map((path) => [
        path,
        hashCanonicalJson(readFileSync(path, "utf8")),
      ]),
    ),
    limits: {
      providerAttempts: 12,
      inputPerAttempt: 20_000,
      outputPerAttempt: 2_000,
      timeoutMs: 60_000,
    },
    // Alternate paired order deterministically, before observing any result.
    schedule: centralTasks
      .filter((entry) => entry.phase === "discovery")
      .flatMap((entry, index) =>
        (index % 2 === 0
          ? (["direct", "feedback"] as const)
          : (["feedback", "direct"] as const)
        ).map((workflow) => ({ taskRef: entry.task.ref, workflow })),
      ),
  };
}

export async function executeCentralDiscovery(stateDirectory: string) {
  mkdirSync(stateDirectory, { recursive: true });
  const qualification = JSON.parse(
    readFileSync(join(stateDirectory, "qualification.json"), "utf8"),
  );
  if (
    qualification.qualified !== true ||
    qualification.corpusFingerprint !==
      hashCanonicalJson(centralTasks as unknown as JsonValue) ||
    hashCanonicalJson(qualification.profile) !==
      hashCanonicalJson(centralIsolationProfile)
  )
    throw new Error(
      "exact task corpus must pass isolated qualification before provider calls",
    );
  const manifest = frozenManifest();
  const fingerprint = hashCanonicalJson(manifest);
  // Exclusive creation prevents rerunning or silently resuming a paid schedule.
  writeFileSync(
    join(stateDirectory, "manifest.json"),
    canonicalJson({ ...manifest, fingerprint }),
    { flag: "wx" },
  );
  const store = await SqliteRunStore.open(stateDirectory);
  const results: Array<
    Awaited<ReturnType<typeof runCentralWorkflow>> & {
      taskRef: string;
      localImport: boolean;
      multipleExports: boolean;
    }
  > = [];
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("experiment interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const report = (decision: { status: string; reason: string }) => {
    const attempts = manifest.schedule.flatMap((_, index) =>
      [1, 2].flatMap((number) => {
        const attempt = store.getProviderAttempt(
          `central/discovery/${index}/attempt/${number}`,
        );
        if (attempt === null) return [];
        const terminal = attempt.terminal as {
          usage?: { totalTokens?: number };
        } | null;
        const total = terminal?.usage?.totalTokens;
        return [
          {
            attemptId: attempt.attemptId,
            lifecycle: attempt.lifecycle,
            totalTokens: typeof total === "number" ? total : null,
          },
        ];
      }),
    );
    const body = {
      manifestFingerprint: fingerprint,
      phase: "discovery",
      decision,
      results,
      knownTotalTokens: attempts.reduce(
        (sum, cell) => sum + (cell.totalTokens ?? 0),
        0,
      ),
      unknownUsageAttempts: attempts.filter((cell) => cell.totalTokens === null)
        .length,
      attempts,
      providerAttempts: attempts.length,
      monetaryCost: null,
      underlyingModelCalls: null,
      assessmentExecuted: false,
      promoted: false,
    };
    writeFileSync(
      join(stateDirectory, "report.json"),
      canonicalJson(body as unknown as JsonValue),
    );
    return body;
  };
  try {
    report({ status: "incomplete", reason: "discovery has started" });
    for (const [index, cell] of manifest.schedule.entries()) {
      if (controller.signal.aborted)
        return report({
          status: "stopped",
          reason: "interrupted; no automatic replay",
        });
      const entry = centralTasks.find((task) => task.task.ref === cell.taskRef);
      if (!entry) throw new Error("scheduled task is missing");
      const workspace = mkdtempSync(
        join(tmpdir(), "government-central-executor-"),
      );
      const gateway = new CodexCliGateway({
        workingDirectory: workspace,
        timeoutMs: 60_000,
      });
      const result = await runCentralWorkflow(
        store,
        gateway,
        {
          runId: `central/discovery/${index}`,
          modelRef: manifest.model,
          configurationFingerprint: hashCanonicalJson({
            model: manifest.model,
            profile: codexCliProfileRef,
            timeoutMs: 60_000,
            experiment: fingerprint,
          }),
          task: entry.task,
          hiddenFiles: entry.hiddenFiles,
          workflow: cell.workflow,
          occurredAt: () => new Date().toISOString(),
          runner: new CentralHypothesisRunner(),
          evaluationProfile: {
            ref: centralIsolationProfile.ref,
            fingerprint: hashCanonicalJson({
              profile: centralIsolationProfile,
              evaluator:
                manifest.implementation[
                  "src/runtime/typescript-refactor-evaluator.ts"
                ] ?? null,
              workflow:
                manifest.implementation[
                  "src/runtime/central-hypothesis-workflow.ts"
                ] ?? null,
            }),
          },
        },
        controller.signal,
      );
      results.push({ ...result, taskRef: cell.taskRef, ...entry.features });
      const progress = report({
        status: "incomplete",
        reason: `${results.length}/${manifest.schedule.length} workflow executions recorded`,
      });
      process.stdout.write(
        `${JSON.stringify({ completed: results.length, task: cell.taskRef, workflow: cell.workflow, outcome: result.outcome, tokens: result.totalTokens, stopReason: result.stopReason })}\n`,
      );
      if (result.stopReason !== null)
        return report({ status: "stopped", reason: result.stopReason });
      if (progress.providerAttempts > manifest.limits.providerAttempts)
        throw new Error("discovery provider attempt ceiling exceeded");
    }
    return report(discoveryDecision(results));
  } catch (error) {
    report({
      status: "stopped",
      reason: `infrastructure: ${String(error)}; durable attempts retained without replay`,
    });
    throw error;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await store.close();
  }
}

export async function qualifyCentralCorpus(stateDirectory: string) {
  mkdirSync(stateDirectory, { recursive: true });
  const runner = new CentralHypothesisRunner();
  const results = [];
  for (const entry of centralTasks) {
    const task = {
      ...entry.task,
      files: { ...entry.task.files, ...entry.hiddenFiles },
    };
    const reference = await evaluateTypescriptRefactorPatch(
      task,
      makeRestrictedPatch(task, entry.referenceSource),
      runner,
    );
    const original = task.files[task.sourcePath];
    if (original === undefined) throw new Error("missing original source");
    const buggy = await evaluateTypescriptRefactorPatch(
      task,
      makeRestrictedPatch(task, original),
      runner,
    );
    results.push({ taskRef: task.ref, reference, buggy });
  }
  const body = {
    corpusFingerprint: hashCanonicalJson(centralTasks as unknown as JsonValue),
    profile: centralIsolationProfile,
    qualified: results.every(
      (entry) =>
        entry.reference.outcome === "verified" &&
        entry.buggy.outcome === "failed",
    ),
    results,
  };
  writeFileSync(
    join(stateDirectory, "qualification.json"),
    canonicalJson(body),
  );
  return body;
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory)
    throw new Error(
      "usage: bun src/experiments/central-hypothesis-run.ts <new-state-directory>",
    );
  if (process.argv[3] === "--qualify") {
    const report = await qualifyCentralCorpus(resolve(directory));
    process.stdout.write(
      `${JSON.stringify({ qualified: report.qualified, tasks: report.results.length })}\n`,
    );
    if (!report.qualified) process.exitCode = 1;
  } else {
    const report = await executeCentralDiscovery(resolve(directory));
    process.stdout.write(`${JSON.stringify(report.decision)}\n`);
  }
}
