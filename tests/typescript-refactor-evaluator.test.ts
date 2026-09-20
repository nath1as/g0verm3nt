import { expect, test } from "bun:test";
import { canonicalJson } from "../src/codecs/canonical.ts";
import {
  heldOutTypescriptRefactorTask,
  typescriptRefactorTask,
} from "../src/fixtures/typescript-refactor.ts";
import {
  evaluateTypescriptRefactorPatch,
  evaluatorFingerprint,
  type IsolatedCommandRunner,
  isolatedBunProfile,
  makeRestrictedPatch,
  parseRestrictedPatchArtifact,
  type RestrictedPatchArtifact,
} from "../src/runtime/typescript-refactor-evaluator.ts";

const fixedSource = `export function trimPrefix(input: string, prefix: string): string {
  return input.startsWith(prefix) ? input.slice(prefix.length) : input;
}
`;

function runner(
  result: Readonly<{
    exitCode?: number;
    timedOut?: boolean;
  }> = {},
): IsolatedCommandRunner {
  return {
    run: async () => ({
      exitCode: result.exitCode ?? 0,
      stdout: "trusted evaluator output",
      stderr: "",
      timedOut: result.timedOut ?? false,
    }),
  };
}

test("isolated evaluator accepts an allowed patch with pinned evidence", async () => {
  const evaluation = await evaluateTypescriptRefactorPatch(
    typescriptRefactorTask,
    makeRestrictedPatch(typescriptRefactorTask, fixedSource),
    runner(),
  );
  expect(evaluation).toMatchObject({
    taskRef: "m3/typescript-refactor/trim-prefix@1",
    evaluatorRef: "m3/typescript-refactor-evaluator@1",
    profileRef: isolatedBunProfile.ref,
    outcome: "verified",
    command: { exitCode: 0 },
  });
  expect(evaluation.patchFingerprint).not.toBeNull();
  expect(evaluation.candidateSourceFingerprint).not.toBeNull();
  expect(evaluation.evaluatorFingerprint).not.toBeNull();
});

test("the held-out fixture is independently evaluable without changing the runner", async () => {
  const source = `export function stripSuffix(input: string, suffix: string): string {
  return input.endsWith(suffix) ? input.slice(0, -suffix.length) : input;
}
`;
  const evaluation = await evaluateTypescriptRefactorPatch(
    heldOutTypescriptRefactorTask,
    makeRestrictedPatch(heldOutTypescriptRefactorTask, source),
    runner(),
  );
  expect(evaluation).toMatchObject({
    taskRef: heldOutTypescriptRefactorTask.ref,
    outcome: "verified",
  });
});

test("strictly parses only canonical restricted patch artifacts", () => {
  const patch = makeRestrictedPatch(typescriptRefactorTask, fixedSource);
  const text = canonicalJson({
    baseSourceFingerprint: patch.baseSourceFingerprint,
    changes: patch.changes.map((change) => ({
      after: change.after,
      beforeFingerprint: change.beforeFingerprint,
      path: change.path,
    })),
    taskRef: patch.taskRef,
  });
  expect(parseRestrictedPatchArtifact(text)).toEqual({ patch, error: null });
  for (const invalid of [
    `Here is the patch:\n${text}`,
    `\`\`\`json\n${text}\n\`\`\``,
    canonicalJson({
      baseSourceFingerprint: patch.baseSourceFingerprint,
      changes: patch.changes.map((change) => ({
        after: change.after,
        beforeFingerprint: change.beforeFingerprint,
        path: change.path,
      })),
      taskRef: patch.taskRef,
      extra: true,
    }),
    `{"taskRef":"${patch.taskRef}","taskRef":"changed","baseSourceFingerprint":"${patch.baseSourceFingerprint}","changes":[]}`,
  ])
    expect(parseRestrictedPatchArtifact(invalid).patch).toBeNull();
  expect(evaluatorFingerprint()).toHaveLength(64);
});

test("isolated evaluator rejects stale, malformed, and non-editable patches before execution", async () => {
  const valid = makeRestrictedPatch(typescriptRefactorTask, fixedSource);
  const change = valid.changes[0];
  if (change === undefined)
    throw new Error("valid fixture patch has no change");
  const cases: readonly RestrictedPatchArtifact[] = [
    {
      ...valid,
      baseSourceFingerprint: "stale" as typeof valid.baseSourceFingerprint,
    },
    { ...valid, changes: [] },
    {
      ...valid,
      changes: [{ ...change, path: "../test/trim-prefix.test.ts" }],
    },
    {
      ...valid,
      changes: [{ ...change, path: "test/trim-prefix.test.ts" }],
    },
  ];
  let calls = 0;
  const neverRun: IsolatedCommandRunner = {
    run: async () => {
      calls += 1;
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  };
  for (const patch of cases) {
    const evaluation = await evaluateTypescriptRefactorPatch(
      typescriptRefactorTask,
      patch,
      neverRun,
    );
    expect(evaluation.outcome).toBe("rejected");
    expect(evaluation.command).toBeNull();
  }
  expect(calls).toBe(0);
});

test("isolated evaluator retains failed and timed-out execution evidence", async () => {
  const patch = makeRestrictedPatch(typescriptRefactorTask, fixedSource);
  const failed = await evaluateTypescriptRefactorPatch(
    typescriptRefactorTask,
    patch,
    runner({ exitCode: 1 }),
  );
  expect(failed).toMatchObject({
    outcome: "failed",
    reason: "isolated evaluator rejected the candidate",
    command: { exitCode: 1 },
  });
  const timedOut = await evaluateTypescriptRefactorPatch(
    typescriptRefactorTask,
    patch,
    runner({ exitCode: 137, timedOut: true }),
  );
  expect(timedOut).toMatchObject({
    outcome: "indeterminate",
    reason: "isolated evaluator timed out",
    command: { timedOut: true },
  });
});
