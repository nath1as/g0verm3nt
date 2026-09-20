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
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import type { JsonValue } from "../core/graph.ts";
import { lunaCalibrationTasks } from "../fixtures/luna-calibration.ts";
import { lunaCalibrationV2Tasks } from "../fixtures/luna-calibration-v2.ts";
import {
  CentralHypothesisRunner,
  centralIsolationProfile,
} from "../runtime/central-hypothesis-isolation.ts";
import {
  centralWorkflowPrompt,
  runCentralWorkflow,
} from "../runtime/central-hypothesis-workflow.ts";
import {
  evaluateTypescriptRefactorPatch,
  makeRestrictedPatch,
} from "../runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../storage/sqlite.ts";

const limits = { inputTokens: 30_000, outputTokens: 8_000, timeoutMs: 120_000 };
const model = "gpt-5.6-luna";
const reasoningEffort = "low" as const;
const json = (value: unknown) => value as JsonValue;
const v2 = process.argv.includes("--v2");
const calibrationTasks = v2 ? lunaCalibrationV2Tasks : lunaCalibrationTasks;
const calibrationRef = v2 ? "luna/calibration-v2@1" : "luna/calibration@1";

function implementation() {
  return Object.fromEntries(
    [
      "src/experiments/luna-calibration.ts",
      "src/fixtures/luna-calibration.ts",
      "src/fixtures/luna-calibration-v2.ts",
      "src/fixtures/luna-logic-tasks.ts",
      "src/fixtures/luna-state-tasks.ts",
      "src/runtime/central-hypothesis-workflow.ts",
      "src/runtime/central-hypothesis-isolation.ts",
      "src/runtime/typescript-refactor-evaluator.ts",
      "src/runtime/provider-attempt.ts",
      "src/adapters/models/codex-cli.ts",
      "src/storage/sqlite.ts",
    ].map((path) => [path, hashCanonicalJson(readFileSync(path, "utf8"))]),
  );
}

function qualificationIdentity() {
  return hashCanonicalJson({
    corpus: json(calibrationTasks),
    profile: centralIsolationProfile,
    implementation: implementation(),
  });
}

function save(directory: string, file: string, body: unknown) {
  const path = join(directory, file);
  writeFileSync(`${path}.tmp`, canonicalJson(json(body)));
  renameSync(`${path}.tmp`, path);
}

export function calibrationDecision(outcomes: readonly string[]) {
  if (outcomes.length !== 6) return "incomplete";
  if (outcomes.some((outcome) => !["verified", "failed"].includes(outcome)))
    return "inconclusive-format-or-infrastructure";
  const successes = outcomes.filter((outcome) => outcome === "verified").length;
  return successes < 2
    ? "too-hard"
    : successes > 4
      ? "too-easy"
      : "ready-for-workflow-comparison";
}

export async function qualifyLuna(directory: string) {
  mkdirSync(directory, { recursive: true });
  if (existsSync(join(directory, "manifest.json")))
    throw new Error("cannot requalify a launched experiment");
  if (
    calibrationTasks.length !== 6 ||
    new Set(calibrationTasks.map((entry) => entry.task.ref)).size !== 6
  )
    throw new Error("calibration requires six unique tasks");
  const runner = new CentralHypothesisRunner();
  const checks = [];
  for (const entry of calibrationTasks) {
    const prompt = centralWorkflowPrompt(entry.task);
    if (
      prompt.includes(entry.referenceSource) ||
      Object.values(entry.hiddenFiles).some((source) => prompt.includes(source))
    )
      throw new Error("private oracle leaked into public prompt");
    const source = entry.task.files[entry.task.sourcePath];
    if (source === undefined) throw new Error("missing original source");
    for (const phase of ["public", "hidden"] as const) {
      const files =
        phase === "public"
          ? entry.task.files
          : {
              ...Object.fromEntries(
                Object.entries(entry.task.files).filter(
                  ([path]) => !path.startsWith("test/"),
                ),
              ),
              ...entry.hiddenFiles,
            };
      const task = { ...entry.task, files };
      const reference = await evaluateTypescriptRefactorPatch(
        task,
        makeRestrictedPatch(task, entry.referenceSource),
        runner,
      );
      const buggy = await evaluateTypescriptRefactorPatch(
        task,
        makeRestrictedPatch(task, source),
        runner,
      );
      checks.push({ task: task.ref, phase, reference, buggy });
      process.stdout.write(
        `${JSON.stringify({ task: task.ref, phase, reference: reference.outcome, buggy: buggy.outcome })}\n`,
      );
    }
  }
  const body = {
    identity: qualificationIdentity(),
    profile: centralIsolationProfile,
    qualified: checks.every(
      (check) =>
        check.reference.outcome === "verified" &&
        check.buggy.outcome === "failed",
    ),
    checks,
  };
  save(directory, "qualification.json", body);
  return body.qualified;
}

export async function runLunaCalibration(directory: string) {
  const qualification = JSON.parse(
    readFileSync(join(directory, "qualification.json"), "utf8"),
  );
  if (
    qualification.qualified !== true ||
    qualification.identity !== qualificationIdentity()
  )
    throw new Error(
      "exact corpus and implementation must qualify before launch",
    );
  const manifest = {
    ref: calibrationRef,
    model,
    reasoningEffort,
    limits,
    maxProviderAttempts: 6,
    profile: codexCliProfileRef,
    isolation: centralIsolationProfile,
    implementation: implementation(),
    qualification: qualification.identity,
    tasks: calibrationTasks.map((entry) => ({
      taskRef: entry.task.ref,
      promptHash: hashCanonicalJson(centralWorkflowPrompt(entry.task)),
      sourceHash: hashCanonicalJson(json(entry)),
    })),
    decision:
      "2–4 verified tasks permits development comparisons; 0–1 too hard; 5–6 too easy; invalid artifacts are inconclusive",
  };
  const manifestFingerprint = hashCanonicalJson(manifest);
  writeFileSync(
    join(directory, "manifest.json"),
    canonicalJson({ ...manifest, manifestFingerprint }),
    { flag: "wx" },
  );
  // Keep the frozen sources so later repository changes cannot erase the protocol.
  save(directory, "corpus.json", calibrationTasks);
  save(
    directory,
    "implementation.json",
    Object.fromEntries(
      Object.keys(manifest.implementation).map((path) => [
        path,
        readFileSync(path, "utf8"),
      ]),
    ),
  );
  const store = await SqliteRunStore.open(directory);
  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new Error("calibration interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const results: Array<
    Awaited<ReturnType<typeof runCentralWorkflow>> & {
      taskRef: string;
      elapsedMs: number;
    }
  > = [];
  const writeReport = (status: string, reason: string | null = null) => {
    const attempts = calibrationTasks.flatMap((_, index) => {
      const attempt = store.getProviderAttempt(
        `luna/calibration/${index}/attempt/1`,
      );
      if (attempt === null) return [];
      const terminal = attempt.terminal as {
        usage?: { totalTokens?: number };
      } | null;
      return [
        {
          attemptId: attempt.attemptId,
          lifecycle: attempt.lifecycle,
          totalTokens: terminal?.usage?.totalTokens ?? null,
        },
      ];
    });
    const report = {
      manifestFingerprint,
      status,
      reason,
      results,
      attempts,
      knownTotalTokens: attempts.reduce(
        (sum, attempt) => sum + (attempt.totalTokens ?? 0),
        0,
      ),
      unknownUsageAttempts: attempts.filter(
        (attempt) => attempt.totalTokens === null,
      ).length,
      monetaryCost: null,
      assessmentExecuted: false,
      promoted: false,
    };
    save(directory, "report.json", report);
    return report;
  };
  try {
    writeReport("incomplete");
    for (const [index, entry] of calibrationTasks.entries()) {
      if (controller.signal.aborted)
        return writeReport("stopped", "interrupted; no automatic replay");
      const cwd = mkdtempSync(join(tmpdir(), "luna-calibration-executor-"));
      const gateway = new CodexCliGateway({
        workingDirectory: cwd,
        reasoningEffort,
        timeoutMs: limits.timeoutMs,
      });
      const started = performance.now();
      const result = await runCentralWorkflow(
        store,
        gateway,
        {
          runId: `luna/calibration/${index}`,
          modelRef: model,
          configurationFingerprint: hashCanonicalJson({
            model,
            reasoningEffort,
            limits,
            profile: codexCliProfileRef,
            manifestFingerprint,
          }),
          task: entry.task,
          hiddenFiles: entry.hiddenFiles,
          workflow: "direct",
          limits,
          occurredAt: () => new Date().toISOString(),
          runner: new CentralHypothesisRunner(),
          evaluationProfile: {
            ref: centralIsolationProfile.ref,
            fingerprint: hashCanonicalJson({
              profile: centralIsolationProfile,
              implementation: manifest.implementation,
            }),
          },
        },
        controller.signal,
      );
      results.push({
        ...result,
        taskRef: entry.task.ref,
        elapsedMs: Math.round(performance.now() - started),
      });
      writeReport("incomplete");
      process.stdout.write(
        `${JSON.stringify({ completed: results.length, task: entry.task.ref, outcome: result.outcome, tokens: result.totalTokens, stop: result.stopReason })}\n`,
      );
      if (result.stopReason !== null)
        return writeReport("stopped", result.stopReason);
    }
    return writeReport(
      calibrationDecision(results.map((result) => result.outcome)),
    );
  } catch (error) {
    writeReport(
      "stopped",
      `infrastructure: ${String(error)}; durable attempts retained`,
    );
    throw error;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await store.close();
  }
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg)
    throw new Error(
      "usage: bun src/experiments/luna-calibration.ts <state-directory> --qualify|--run [--v2]",
    );
  const directory = resolve(arg);
  if (process.argv.includes("--qualify")) {
    if (!(await qualifyLuna(directory))) process.exitCode = 1;
  } else {
    const report = await runLunaCalibration(directory);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, tokens: report.knownTotalTokens })}\n`,
    );
  }
}
