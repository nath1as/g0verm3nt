import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TypedModelGateway } from "../src/adapters/models/typed.ts";
import { canonicalJson, hashCanonicalJson } from "../src/codecs/canonical.ts";
import { getM3Variant } from "../src/experiments/m3.ts";
import { typescriptRefactorTask } from "../src/fixtures/typescript-refactor.ts";
import { m3ComparisonObservationsFromCohort } from "../src/runtime/m3-comparison-cohort.ts";
import {
  m3RefactorPrompt,
  runM3TypescriptRefactor,
} from "../src/runtime/m3-typescript-refactor-run.ts";
import { taskSourceFingerprint } from "../src/runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const directories: string[] = [];
const time = "2026-09-20T00:00:00.000Z";
const fixedSource = `export function trimPrefix(input: string, prefix: string): string {
  return input.startsWith(prefix) ? input.slice(prefix.length) : input;
}
`;

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "government-m3-run-"));
  directories.push(value);
  return value;
}

function gateway(text: string): TypedModelGateway {
  return {
    complete: async (request) => ({
      requestId: request.requestId,
      modelRef: request.modelRef,
      text,
      toolCalls: [],
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 20,
        totalTokens: 30,
        known: true,
      },
      accounting: {
        executorAttempts: 1,
        modelCalls: 1,
        commandExecutions: 0,
        toolCalls: 0,
      },
      finish: "stop",
    }),
  };
}

function validPatch(): string {
  const before =
    typescriptRefactorTask.files[typescriptRefactorTask.sourcePath];
  if (before === undefined) throw new Error("missing fixture source");
  return canonicalJson({
    baseSourceFingerprint: taskSourceFingerprint(typescriptRefactorTask),
    changes: [
      {
        after: fixedSource,
        beforeFingerprint: hashCanonicalJson(before),
        path: typescriptRefactorTask.sourcePath,
      },
    ],
    taskRef: typescriptRefactorTask.ref,
  });
}

test("checklist intervention adds only deterministic task-derived guidance", () => {
  const direct = getM3Variant("m3/harness-default@1");
  const checklist = getM3Variant("m3/harness-planning-checklist@1");
  if (direct === undefined || checklist === undefined)
    throw new Error("M3 variants are missing");
  const directPrompt = m3RefactorPrompt(direct, typescriptRefactorTask);
  const checklistPrompt = m3RefactorPrompt(checklist, typescriptRefactorTask);
  expect(directPrompt).not.toContain("Planning checklist");
  expect(checklistPrompt).toContain("Planning checklist");
  expect(checklistPrompt).toContain(typescriptRefactorTask.ref);
  expect(checklistPrompt).toContain(typescriptRefactorTask.sourcePath);
  expect(checklistPrompt).toContain("Preserve the module export");
});

test("M3 run retains provider, patch and evaluator evidence under one run", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    const result = await runM3TypescriptRefactor(
      store,
      gateway(validPatch()),
      {
        runId: "m3-refactor-1",
        attemptId: "m3-attempt-1",
        evaluationId: "m3-evaluation-1",
        variantRef: "m3/harness-default@1",
        modelRef: "model/fake@1",
        executorRef: "fake@1",
        configurationFingerprint: "fake-profile@1",
        task: typescriptRefactorTask,
        occurredAt: () => time,
        runner: {
          run: async () => ({
            exitCode: 0,
            stdout: "trusted tests passed",
            stderr: "",
            timedOut: false,
          }),
        },
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      outcome: "verified",
      evaluationId: "m3-evaluation-1",
    });
    expect(store.getProviderAttempt("m3-attempt-1")?.lifecycle).toBe(
      "completed",
    );
    expect(store.getM3TaskEvaluation("m3-evaluation-1")).toMatchObject({
      outcome: "verified",
      providerAttemptId: "m3-attempt-1",
    });
    expect(store.getRun("m3-refactor-1")?.run.status).toBe("succeeded");
    expect(
      store.recordM3EvaluationCohortObservation(
        "m3/development-pilot@1",
        "m3-evaluation-1",
        time,
      ),
    ).toMatchObject({
      cohortRef: "m3/development-pilot@1",
      taskRef: typescriptRefactorTask.ref,
      variantRef: "m3/harness-default@1",
      modelRef: "model/fake@1",
      outcome: "success",
      usage: { inputTokens: 10, totalTokens: 30 },
    });
    expect(() =>
      store.recordM3EvaluationCohortObservation(
        "m3/development-pilot@1",
        "m3-evaluation-1",
        time,
      ),
    ).toThrow();
    expect(
      store.listM3EvaluationCohortObservations("m3/development-pilot@1"),
    ).toHaveLength(1);
    expect(
      m3ComparisonObservationsFromCohort(store, "m3/development-pilot@1"),
    ).toMatchObject([
      {
        sourceFingerprint: taskSourceFingerprint(typescriptRefactorTask),
        executorRef: "fake@1",
        evaluatorRef: typescriptRefactorTask.evaluatorRef,
        profileRef: typescriptRefactorTask.profileRef,
        usage: { inputTokens: 10, totalTokens: 30, known: true },
        commandExecutions: 0,
        toolCalls: 0,
      },
    ]);
  } finally {
    await store.close();
  }
});

test("M3 run fails closed when provider output is not a strict patch", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    const result = await runM3TypescriptRefactor(
      store,
      gateway("Here is your patch: {}"),
      {
        runId: "m3-refactor-2",
        attemptId: "m3-attempt-2",
        evaluationId: "m3-evaluation-2",
        variantRef: "m3/harness-default@1",
        modelRef: "model/fake@1",
        executorRef: "fake@1",
        configurationFingerprint: "fake-profile@1",
        task: typescriptRefactorTask,
        occurredAt: () => time,
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      outcome: "invalid-artifact",
      evaluationId: null,
    });
    expect(store.getProviderAttempt("m3-attempt-2")?.lifecycle).toBe(
      "completed",
    );
    expect(store.getM3TaskEvaluation("m3-evaluation-2")).toBeNull();
    expect(store.getRun("m3-refactor-2")?.run.status).toBe("failed");
  } finally {
    await store.close();
  }
});
