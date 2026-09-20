import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashCanonicalJson } from "../src/codecs/canonical.ts";
import { typescriptRefactorTask } from "../src/fixtures/typescript-refactor.ts";
import {
  evaluateAndRecordTypescriptRefactorPatch,
  makeRestrictedPatch,
} from "../src/runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const directories: string[] = [];
const occurredAt = "2026-09-20T00:00:00.000Z";
const fixedSource = `export function trimPrefix(input: string, prefix: string): string {
  return input.startsWith(prefix) ? input.slice(prefix.length) : input;
}
`;

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "government-m3-evaluation-"));
  directories.push(value);
  return value;
}

function createRunningRun(store: SqliteRunStore, id: string): void {
  store.createRun({
    id,
    taskType: "m3-typescript-refactor",
    status: "running",
    createdAt: occurredAt,
    completedAt: null,
    outcome: null,
  });
}

function completeProviderAttempt(
  store: SqliteRunStore,
  attemptId: string,
  runId: string,
): void {
  store.createProviderAttempt({
    attemptId,
    runId,
    executorRef: "fixture-provider@1",
    requestId: `${runId}/request/1`,
    modelRef: "model/fixture@1",
    requestFingerprint: "request@1",
    configurationFingerprint: "configuration@1",
    createdAt: occurredAt,
  });
  store.markProviderAttemptDispatched(attemptId, occurredAt);
  store.completeProviderAttempt(attemptId, { patch: "available" }, occurredAt);
}

test("records frozen M3 evaluation evidence with its completed provider attempt", async () => {
  const stateDirectory = directory();
  const store = await SqliteRunStore.open(stateDirectory);
  createRunningRun(store, "m3-run-1");
  completeProviderAttempt(store, "provider-1", "m3-run-1");
  const patch = makeRestrictedPatch(typescriptRefactorTask, fixedSource);
  const evaluation = await evaluateAndRecordTypescriptRefactorPatch(store, {
    evaluationId: "evaluation-1",
    runId: "m3-run-1",
    providerAttemptId: "provider-1",
    variantRef: "m3/default@1",
    task: typescriptRefactorTask,
    patch,
    occurredAt,
    runner: {
      run: async () => ({
        exitCode: 0,
        stdout: "three trusted tests passed",
        stderr: "",
        timedOut: false,
      }),
    },
  });
  expect(evaluation.outcome).toBe("verified");
  expect(store.getM3TaskEvaluation("evaluation-1")).toMatchObject({
    runId: "m3-run-1",
    providerAttemptId: "provider-1",
    taskRef: typescriptRefactorTask.ref,
    variantRef: "m3/default@1",
    source: { ref: typescriptRefactorTask.ref },
    patch: { taskRef: typescriptRefactorTask.ref },
    evaluatorRef: typescriptRefactorTask.evaluatorRef,
    outcome: "verified",
    command: { stdout: "three trusted tests passed" },
  });
  expect(store.getRun("m3-run-1")?.events.at(-1)).toMatchObject({
    kind: "M3TaskEvaluationRecorded",
    payload: { evaluationId: "evaluation-1", outcome: "verified" },
  });
  await store.close();

  const reopened = await SqliteRunStore.open(stateDirectory);
  try {
    expect(reopened.getM3TaskEvaluation("evaluation-1")).toMatchObject({
      sourceFingerprint: evaluation.baseSourceFingerprint,
      patchFingerprint: evaluation.patchFingerprint,
      evaluatorFingerprint: evaluation.evaluatorFingerprint,
      candidateSourceFingerprint: evaluation.candidateSourceFingerprint,
    });
  } finally {
    await reopened.close();
  }
});

test("rejects tampered evidence and provider attempts from another run", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    createRunningRun(store, "m3-run-2");
    createRunningRun(store, "m3-run-3");
    completeProviderAttempt(store, "provider-2", "m3-run-3");
    const source = {
      ref: typescriptRefactorTask.ref,
      files: { ...typescriptRefactorTask.files },
    };
    const patch = { taskRef: typescriptRefactorTask.ref, changes: [] };
    const input = {
      evaluationId: "evaluation-2",
      runId: "m3-run-2",
      providerAttemptId: "provider-2",
      taskRef: typescriptRefactorTask.ref,
      split: "development" as const,
      variantRef: "m3/default@1",
      source,
      sourceFingerprint: hashCanonicalJson(source),
      patch,
      patchFingerprint: hashCanonicalJson(patch),
      evaluatorRef: typescriptRefactorTask.evaluatorRef,
      evaluatorFingerprint: "evaluator@1",
      profileRef: typescriptRefactorTask.profileRef,
      candidateSourceFingerprint: null,
      outcome: "rejected" as const,
      reason: "fixture",
      command: null,
      recordedAt: occurredAt,
    };
    expect(() =>
      store.recordM3TaskEvaluation({ ...input, sourceFingerprint: "tampered" }),
    ).toThrow("source fingerprint");
    expect(() => store.recordM3TaskEvaluation(input)).toThrow("another run");
  } finally {
    await store.close();
  }
});
