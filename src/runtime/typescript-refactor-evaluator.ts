import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  type ContentHash,
  canonicalJson,
  hashCanonicalJson,
} from "../codecs/canonical.ts";
import type { JsonValue } from "../core/graph.ts";
import type { TypescriptRefactorTask } from "../fixtures/typescript-refactor.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";

export const isolatedBunProfile = Object.freeze({
  ref: "m3/linux-bwrap-bun@1",
  bubblewrapPath: "/usr/bin/bwrap",
  bunPath: "/usr/bin/bun",
  cpuSeconds: 5,
  memoryBytes: 1_073_741_824,
  maxProcesses: null,
  maxWallTimeMs: 10_000,
  network: "disabled" as const,
  workspace: "read-only" as const,
});

export type RestrictedFilePatch = Readonly<{
  path: string;
  beforeFingerprint: ContentHash;
  after: string;
}>;

export type RestrictedPatchArtifact = Readonly<{
  taskRef: string;
  baseSourceFingerprint: ContentHash;
  changes: readonly RestrictedFilePatch[];
}>;

export type RestrictedPatchParseResult = Readonly<{
  patch: RestrictedPatchArtifact | null;
  error: string | null;
}>;

export type IsolatedCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

export interface IsolatedCommandRunner {
  run(workspace: string): Promise<IsolatedCommandResult>;
}

export type TypescriptRefactorEvaluation = Readonly<{
  taskRef: string;
  evaluatorRef: string;
  evaluatorFingerprint: ContentHash;
  profileRef: string;
  baseSourceFingerprint: ContentHash;
  patchFingerprint: ContentHash | null;
  candidateSourceFingerprint: ContentHash | null;
  outcome: "verified" | "rejected" | "failed" | "indeterminate";
  reason: string;
  command: IsolatedCommandResult | null;
}>;

export function evaluatorFingerprint(): ContentHash {
  return hashCanonicalJson({
    ref: "m3/typescript-refactor-evaluator@1",
    profile: isolatedBunProfile,
    patchFormat: "restricted-full-file@1",
  });
}

export function makeRestrictedPatch(
  task: TypescriptRefactorTask,
  after: string,
): RestrictedPatchArtifact {
  const before = task.files[task.sourcePath];
  if (before === undefined) throw new Error("task source file is missing");
  return {
    taskRef: task.ref,
    baseSourceFingerprint: taskSourceFingerprint(task),
    changes: [
      {
        path: task.sourcePath,
        beforeFingerprint: hashCanonicalJson(before),
        after,
      },
    ],
  };
}

/**
 * Accept only a canonical JSON artifact. Model prose, Markdown fences and
 * duplicate/unknown fields are therefore not silently interpreted as a patch.
 */
export function parseRestrictedPatchArtifact(
  text: string,
): RestrictedPatchParseResult {
  if (Buffer.byteLength(text, "utf8") > 48 * 1024)
    return { patch: null, error: "patch artifact exceeds 48 KiB" };
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch {
    return { patch: null, error: "patch artifact is not valid JSON" };
  }
  if (text.trim() !== canonicalJson(value))
    return { patch: null, error: "patch artifact is not canonical JSON" };
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["baseSourceFingerprint", "changes", "taskRef"])
  )
    return { patch: null, error: "patch artifact has an invalid shape" };
  const taskRef = value.taskRef;
  const baseSourceFingerprint = value.baseSourceFingerprint;
  const changes = value.changes;
  if (typeof taskRef !== "string" || typeof baseSourceFingerprint !== "string")
    return { patch: null, error: "patch artifact has invalid references" };
  if (!Array.isArray(changes))
    return { patch: null, error: "patch artifact changes must be an array" };
  const parsedChanges: RestrictedFilePatch[] = [];
  for (const change of changes) {
    if (
      !isObject(change) ||
      !hasExactKeys(change, ["after", "beforeFingerprint", "path"])
    )
      return {
        patch: null,
        error: "patch artifact change has an invalid shape",
      };
    if (
      typeof change.path !== "string" ||
      typeof change.beforeFingerprint !== "string" ||
      typeof change.after !== "string"
    )
      return { patch: null, error: "patch artifact change has invalid fields" };
    parsedChanges.push({
      path: change.path,
      beforeFingerprint: change.beforeFingerprint as ContentHash,
      after: change.after,
    });
  }
  return {
    patch: {
      taskRef,
      baseSourceFingerprint: baseSourceFingerprint as ContentHash,
      changes: parsedChanges,
    },
    error: null,
  };
}

export function taskSourceFingerprint(
  task: TypescriptRefactorTask,
): ContentHash {
  return hashCanonicalJson({ ref: task.ref, files: task.files });
}

function isObject(
  value: JsonValue,
): value is Readonly<Record<string, JsonValue>> {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function hasExactKeys(
  value: Readonly<Record<string, JsonValue>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function result(
  task: TypescriptRefactorTask,
  patch: RestrictedPatchArtifact,
  outcome: TypescriptRefactorEvaluation["outcome"],
  reason: string,
  candidateSourceFingerprint: ContentHash | null,
  command: IsolatedCommandResult | null,
): TypescriptRefactorEvaluation {
  return {
    taskRef: task.ref,
    evaluatorRef: task.evaluatorRef,
    evaluatorFingerprint: evaluatorFingerprint(),
    profileRef: isolatedBunProfile.ref,
    baseSourceFingerprint: taskSourceFingerprint(task),
    patchFingerprint: hashCanonicalJson(patch),
    candidateSourceFingerprint,
    outcome,
    reason,
    command,
  };
}

export type DurableTypescriptRefactorEvaluation = Readonly<{
  evaluationId: string;
  runId: string;
  providerAttemptId?: string;
  variantRef: string;
  task: TypescriptRefactorTask;
  patch: RestrictedPatchArtifact;
  occurredAt: string;
  runner?: IsolatedCommandRunner;
}>;

function patchJson(patch: RestrictedPatchArtifact): JsonValue {
  return {
    taskRef: patch.taskRef,
    baseSourceFingerprint: patch.baseSourceFingerprint,
    changes: patch.changes.map((change) => ({
      path: change.path,
      beforeFingerprint: change.beforeFingerprint,
      after: change.after,
    })),
  };
}

function sourceJson(task: TypescriptRefactorTask): JsonValue {
  return { ref: task.ref, files: { ...task.files } };
}

function commandJson(command: IsolatedCommandResult | null): JsonValue | null {
  if (command === null) return null;
  return {
    exitCode: command.exitCode,
    stdout: command.stdout,
    stderr: command.stderr,
    timedOut: command.timedOut,
  };
}

/** Evaluate a frozen patch, then retain the evaluator-owned terminal evidence. */
export async function evaluateAndRecordTypescriptRefactorPatch(
  store: SqliteRunStore,
  input: DurableTypescriptRefactorEvaluation,
): Promise<TypescriptRefactorEvaluation> {
  const evaluation = await evaluateTypescriptRefactorPatch(
    input.task,
    input.patch,
    input.runner,
  );
  const source = sourceJson(input.task);
  const patch = patchJson(input.patch);
  store.recordM3TaskEvaluation({
    evaluationId: input.evaluationId,
    runId: input.runId,
    providerAttemptId: input.providerAttemptId ?? null,
    taskRef: evaluation.taskRef,
    split: input.task.split,
    variantRef: input.variantRef,
    source,
    sourceFingerprint: evaluation.baseSourceFingerprint,
    patch,
    patchFingerprint: hashCanonicalJson(patch),
    evaluatorRef: evaluation.evaluatorRef,
    evaluatorFingerprint: evaluation.evaluatorFingerprint,
    profileRef: evaluation.profileRef,
    candidateSourceFingerprint: evaluation.candidateSourceFingerprint,
    outcome: evaluation.outcome,
    reason: evaluation.reason,
    command: commandJson(evaluation.command),
    recordedAt: input.occurredAt,
  });
  return evaluation;
}

function patchError(
  task: TypescriptRefactorTask,
  patch: RestrictedPatchArtifact,
): string | null {
  if (patch.taskRef !== task.ref) return "patch task reference does not match";
  if (patch.baseSourceFingerprint !== taskSourceFingerprint(task))
    return "patch base source fingerprint does not match";
  if (patch.changes.length !== 1)
    return "patch must contain exactly one change";
  const change = patch.changes[0];
  if (change === undefined) return "patch has no change";
  if (!isSafeRelativePath(change.path)) return "patch path is unsafe";
  if (!task.editablePaths.includes(change.path))
    return "patch changes a non-editable path";
  if (Buffer.byteLength(change.after, "utf8") > 32_768)
    return "patch replacement exceeds 32 KiB";
  const before = task.files[change.path];
  if (
    before === undefined ||
    hashCanonicalJson(before) !== change.beforeFingerprint
  )
    return "patch base file fingerprint does not match";
  return null;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}

function materialize(
  task: TypescriptRefactorTask,
  patch: RestrictedPatchArtifact,
): string {
  const workspace = mkdtempSync(join(tmpdir(), "government-m3-task-"));
  try {
    const change = patch.changes[0];
    if (change === undefined) throw new Error("patch has no change");
    for (const [path, content] of Object.entries(task.files)) {
      const destination = resolve(workspace, path);
      if (relative(workspace, destination).startsWith(".."))
        throw new Error("task fixture path escapes workspace");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, path === change.path ? change.after : content);
    }
    return workspace;
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

export class BubblewrapBunRunner implements IsolatedCommandRunner {
  async run(workspace: string): Promise<IsolatedCommandResult> {
    const command = [
      "/usr/bin/prlimit",
      `--as=${isolatedBunProfile.memoryBytes}`,
      `--cpu=${isolatedBunProfile.cpuSeconds}`,
      "--",
      isolatedBunProfile.bubblewrapPath,
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      workspace,
      "/workspace",
      "--tmpfs",
      "/tmp",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--setenv",
      "HOME",
      "/tmp",
      "--chdir",
      "/workspace",
      isolatedBunProfile.bunPath,
      "test",
    ];
    const child = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, isolatedBunProfile.maxWallTimeMs);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return {
        exitCode,
        stdout: stdout.slice(0, 32_768),
        stderr: stderr.slice(0, 32_768),
        timedOut,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function evaluateTypescriptRefactorPatch(
  task: TypescriptRefactorTask,
  patch: RestrictedPatchArtifact,
  runner: IsolatedCommandRunner = new BubblewrapBunRunner(),
): Promise<TypescriptRefactorEvaluation> {
  if (task.profileRef !== isolatedBunProfile.ref)
    throw new Error("task does not use the pinned isolated profile");
  const invalid = patchError(task, patch);
  if (invalid !== null)
    return result(task, patch, "rejected", invalid, null, null);
  const change = patch.changes[0];
  if (change === undefined) throw new Error("valid patch has no change");
  const candidateSourceFingerprint = hashCanonicalJson(change.after);
  const workspace = materialize(task, patch);
  try {
    const command = await runner.run(workspace);
    if (command.timedOut)
      return result(
        task,
        patch,
        "indeterminate",
        "isolated evaluator timed out",
        candidateSourceFingerprint,
        command,
      );
    if (command.exitCode !== 0)
      return result(
        task,
        patch,
        "failed",
        "isolated evaluator rejected the candidate",
        candidateSourceFingerprint,
        command,
      );
    return result(
      task,
      patch,
      "verified",
      "isolated evaluator accepted the candidate",
      candidateSourceFingerprint,
      command,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return result(
      task,
      patch,
      "indeterminate",
      `isolated evaluator failed to start: ${detail}`,
      candidateSourceFingerprint,
      null,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
