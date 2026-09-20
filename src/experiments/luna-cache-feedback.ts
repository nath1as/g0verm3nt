import { Database } from "bun:sqlite";
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
import { lunaStateTasks } from "../fixtures/luna-state-tasks.ts";
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
  parseRestrictedPatchArtifact,
  taskSourceFingerprint,
} from "../runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../storage/sqlite.ts";

const model = "gpt-5.6-luna";
const reasoningEffort = "low" as const;
const limits = { inputTokens: 30_000, outputTokens: 8_000, timeoutMs: 120_000 };
const sourceRunId = "luna/calibration/3";
const sourceEvaluationId = `${sourceRunId}/attempt/1/public`;
const json = (value: unknown) => value as JsonValue;

function save(directory: string, file: string, value: unknown) {
  const target = join(directory, file);
  writeFileSync(`${target}.tmp`, canonicalJson(json(value)));
  renameSync(`${target}.tmp`, target);
}

function cacheTask() {
  const entry = lunaStateTasks.find(
    (candidate) => candidate.task.ref === "central/luna-lru-ttl@1",
  );
  if (entry === undefined) throw new Error("cache feedback task is missing");
  return entry;
}

type RetainedSeed = Readonly<{
  artifact: string;
  publicDiagnostics: Readonly<{ stdout: string; stderr: string }>;
  sourceManifestFingerprint: string;
  patchFingerprint: string;
}>;

function retainedSeed(calibrationDirectory: string): RetainedSeed {
  const manifest = JSON.parse(
    readFileSync(join(calibrationDirectory, "manifest.json"), "utf8"),
  ) as {
    model?: string;
    reasoningEffort?: string;
    manifestFingerprint?: string;
  };
  if (manifest.model !== model || manifest.reasoningEffort !== reasoningEffort)
    throw new Error(
      "retained calibration used a different model configuration",
    );
  if (typeof manifest.manifestFingerprint !== "string")
    throw new Error("retained calibration manifest fingerprint is missing");
  const db = new Database(join(calibrationDirectory, "government.sqlite"), {
    readonly: true,
  });
  try {
    const row = db
      .query(
        "SELECT patch_json, command_json FROM m3_task_evaluations WHERE evaluation_id = ? AND run_id = ?",
      )
      .get(sourceEvaluationId, sourceRunId) as {
      patch_json: string;
      command_json: string | null;
    } | null;
    if (row === null) throw new Error("retained public evaluation is missing");
    const patch = JSON.parse(row.patch_json);
    const parsed = parseRestrictedPatchArtifact(canonicalJson(json(patch)));
    const entry = cacheTask();
    if (
      parsed.patch === null ||
      parsed.patch.taskRef !== entry.task.ref ||
      parsed.patch.baseSourceFingerprint !== taskSourceFingerprint(entry.task)
    )
      throw new Error("retained artifact does not bind the frozen cache task");
    const command =
      row.command_json === null ? null : JSON.parse(row.command_json);
    if (command?.exitCode !== 1)
      throw new Error("retained artifact did not fail public verification");
    return {
      artifact: canonicalJson(json(patch)),
      publicDiagnostics: {
        stdout:
          typeof command?.stdout === "string"
            ? command.stdout.slice(0, 4096)
            : "",
        stderr:
          typeof command?.stderr === "string"
            ? command.stderr.slice(0, 4096)
            : "",
      },
      sourceManifestFingerprint: manifest.manifestFingerprint,
      patchFingerprint: hashCanonicalJson(json(patch)),
    };
  } finally {
    db.close();
  }
}

function implementation() {
  return Object.fromEntries(
    [
      "src/experiments/luna-cache-feedback.ts",
      "src/runtime/central-hypothesis-workflow.ts",
      "src/runtime/central-hypothesis-isolation.ts",
      "src/runtime/typescript-refactor-evaluator.ts",
      "src/runtime/provider-attempt.ts",
      "src/adapters/models/codex-cli.ts",
      "src/storage/sqlite.ts",
      "src/fixtures/luna-state-tasks.ts",
    ].map((path) => [path, hashCanonicalJson(readFileSync(path, "utf8"))]),
  );
}

export async function qualifyLunaCacheFeedback(
  directory: string,
  calibrationDirectory: string,
) {
  mkdirSync(directory, { recursive: true });
  if (existsSync(join(directory, "manifest.json")))
    throw new Error("cannot requalify a launched experiment");
  const entry = cacheTask();
  const seed = retainedSeed(calibrationDirectory);
  const publicPrompt = `${centralWorkflowPrompt(entry.task)}\n${seed.artifact}\n${canonicalJson(seed.publicDiagnostics)}`;
  if (
    publicPrompt.includes(entry.referenceSource) ||
    Object.values(entry.hiddenFiles).some((source) =>
      publicPrompt.includes(source),
    )
  )
    throw new Error("private oracle leaked into repair prompt");
  const runner = new CentralHypothesisRunner();
  const referencePublic = await evaluateTypescriptRefactorPatch(
    entry.task,
    makeRestrictedPatch(entry.task, entry.referenceSource),
    runner,
  );
  const hiddenTask = {
    ...entry.task,
    files: { ...entry.task.files, ...entry.hiddenFiles },
  };
  const referenceHidden = await evaluateTypescriptRefactorPatch(
    hiddenTask,
    makeRestrictedPatch(hiddenTask, entry.referenceSource),
    runner,
  );
  const originalPublic = await evaluateTypescriptRefactorPatch(
    entry.task,
    makeRestrictedPatch(
      entry.task,
      entry.task.files[entry.task.sourcePath] ?? "",
    ),
    runner,
  );
  const qualification = {
    qualified:
      referencePublic.outcome === "verified" &&
      referenceHidden.outcome === "verified" &&
      originalPublic.outcome === "failed",
    sourceManifestFingerprint: seed.sourceManifestFingerprint,
    seedPatchFingerprint: seed.patchFingerprint,
    profile: centralIsolationProfile,
    checks: { referencePublic, referenceHidden, originalPublic },
    identity: hashCanonicalJson({
      task: json(entry),
      seedPatchFingerprint: seed.patchFingerprint,
      sourceManifestFingerprint: seed.sourceManifestFingerprint,
      profile: centralIsolationProfile,
      implementation: implementation(),
    }),
  };
  save(directory, "qualification.json", qualification);
  return qualification;
}

export async function runLunaCacheFeedback(
  directory: string,
  calibrationDirectory: string,
) {
  const qualification = JSON.parse(
    readFileSync(join(directory, "qualification.json"), "utf8"),
  ) as { qualified?: boolean; identity?: string };
  const entry = cacheTask();
  const seed = retainedSeed(calibrationDirectory);
  const identity = hashCanonicalJson({
    task: json(entry),
    seedPatchFingerprint: seed.patchFingerprint,
    sourceManifestFingerprint: seed.sourceManifestFingerprint,
    profile: centralIsolationProfile,
    implementation: implementation(),
  });
  if (qualification.qualified !== true || qualification.identity !== identity)
    throw new Error(
      "exact task, retained failure, and implementation must qualify",
    );
  const manifest = {
    ref: "luna/cache-feedback@1",
    model,
    reasoningEffort,
    limits,
    maxProviderAttempts: 1,
    profile: codexCliProfileRef,
    isolation: centralIsolationProfile,
    qualification: identity,
    source: {
      calibrationRunId: sourceRunId,
      publicEvaluationId: sourceEvaluationId,
      calibrationManifestFingerprint: seed.sourceManifestFingerprint,
      retainedPatchFingerprint: seed.patchFingerprint,
    },
    implementation: implementation(),
  };
  const manifestFingerprint = hashCanonicalJson(manifest);
  writeFileSync(
    join(directory, "manifest.json"),
    canonicalJson({ ...manifest, manifestFingerprint }),
    { flag: "wx" },
  );
  save(directory, "corpus.json", entry);
  const store = await SqliteRunStore.open(directory);
  const controller = new AbortController();
  try {
    const gateway = new CodexCliGateway({
      workingDirectory: mkdtempSync(
        join(tmpdir(), "luna-cache-feedback-executor-"),
      ),
      reasoningEffort,
      timeoutMs: limits.timeoutMs,
    });
    const result = await runCentralWorkflow(
      store,
      gateway,
      {
        runId: "luna/cache-feedback/0",
        modelRef: model,
        configurationFingerprint: hashCanonicalJson({
          model,
          reasoningEffort,
          limits,
          manifestFingerprint,
        }),
        task: entry.task,
        hiddenFiles: entry.hiddenFiles,
        workflow: "feedback",
        feedbackSeed: {
          artifact: seed.artifact,
          publicDiagnostics: seed.publicDiagnostics,
        },
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
    const report = {
      manifestFingerprint,
      status: result.outcome,
      source: manifest.source,
      result,
      monetaryCost: null,
      assessmentExecuted: false,
      promoted: false,
    };
    save(directory, "report.json", report);
    return report;
  } finally {
    await store.close();
  }
}

if (import.meta.main) {
  const [directory, calibrationDirectory, mode] = process.argv.slice(2);
  if (
    !directory ||
    !calibrationDirectory ||
    (mode !== "--qualify" && mode !== "--run")
  )
    throw new Error(
      "usage: bun src/experiments/luna-cache-feedback.ts <state-directory> <calibration-state-directory> --qualify|--run",
    );
  const result =
    mode === "--qualify"
      ? await qualifyLunaCacheFeedback(
          resolve(directory),
          resolve(calibrationDirectory),
        )
      : await runLunaCacheFeedback(
          resolve(directory),
          resolve(calibrationDirectory),
        );
  process.stdout.write(
    `${canonicalJson(json({ status: "status" in result ? result.status : result.qualified, result }))}\n`,
  );
}
