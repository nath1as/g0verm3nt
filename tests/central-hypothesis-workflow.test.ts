import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TypedModelGateway,
  TypedModelResponse,
} from "../src/adapters/models/typed.ts";
import { canonicalJson, hashCanonicalJson } from "../src/codecs/canonical.ts";
import { typescriptRefactorTask as task } from "../src/fixtures/typescript-refactor.ts";
import { runCentralWorkflow } from "../src/runtime/central-hypothesis-workflow.ts";
import {
  type IsolatedCommandRunner,
  makeRestrictedPatch,
} from "../src/runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const directories: string[] = [];
const source =
  "export function trimPrefix(input: string, prefix: string): string { return input.startsWith(prefix) ? input.slice(prefix.length) : input; }\n";

test("explicit larger output budget permits a completed attempt above the legacy ceiling", async () => {
  const { store, gateway, input } = await setup({
    usage: {
      known: true,
      inputTokens: 100,
      outputTokens: 2500,
      totalTokens: 2600,
      cachedInputTokens: 0,
    },
  });
  try {
    const result = await runCentralWorkflow(
      store,
      gateway,
      {
        ...input,
        workflow: "direct",
        limits: { inputTokens: 30000, outputTokens: 8000, timeoutMs: 120000 },
        runner: {
          run: async () => ({
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
          }),
        },
      },
      new AbortController().signal,
    );
    expect(result.outcome).toBe("verified");
    expect(result.totalTokens).toBe(2600);
    expect(result.attemptIds).toHaveLength(1);
  } finally {
    await store.close();
  }
});
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function setup(overrides: Partial<TypedModelResponse> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "central-workflow-"));
  directories.push(directory);
  const store = await SqliteRunStore.open(directory);
  const prompts: string[] = [];
  const gateway: TypedModelGateway = {
    complete: async (request) => {
      prompts.push(request.prompt);
      return {
        requestId: request.requestId,
        modelRef: request.modelRef,
        text: canonicalJson(makeRestrictedPatch(task, source)),
        toolCalls: [],
        usage: {
          known: true,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cachedInputTokens: 20,
        },
        accounting: {
          executorAttempts: 1,
          modelCalls: 1,
          commandExecutions: 0,
          toolCalls: 0,
        },
        finish: "stop",
        ...overrides,
      };
    },
  };
  const input = {
    runId: "central-test",
    modelRef: "fake@1",
    executorRef: "fake@1",
    configurationFingerprint: "fake-config@1",
    task,
    hiddenFiles: { "test/hidden.test.ts": "SECRET HIDDEN ASSERTIONS" },
    workflow: "feedback" as const,
    occurredAt: () => "2026-09-20T00:00:00Z",
  };
  return { store, gateway, input, prompts };
}

test("feedback retries only public failure and evaluates exact terminal bytes against hidden tests", async () => {
  const { store, gateway, input, prompts } = await setup();
  let calls = 0;
  const runner: IsolatedCommandRunner = {
    run: async (workspace) => {
      calls++;
      expect(readFileSync(join(workspace, task.sourcePath), "utf8")).toBe(
        source,
      );
      expect(existsSync(join(workspace, "test/hidden.test.ts"))).toBe(
        calls === 3,
      );
      return {
        exitCode: calls === 1 ? 1 : 0,
        stdout: "",
        stderr: calls === 1 ? "PUBLIC ASSERTION FAILED" : "",
        timedOut: false,
      };
    },
  };
  try {
    const result = await runCentralWorkflow(
      store,
      gateway,
      { ...input, runner },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      outcome: "verified",
      publicPassed: true,
      totalTokens: 300,
      cachedInputTokens: 40,
      stopReason: null,
    });
    expect(result.attemptIds).toHaveLength(2);
    expect(result.evaluationIds).toHaveLength(3);
    expect(prompts[1]).toContain("PUBLIC ASSERTION FAILED");
    expect(prompts.join("\n")).not.toContain("SECRET HIDDEN ASSERTIONS");
    expect(
      store.getM3TaskEvaluation("central-test/attempt/2/hidden")?.outcome,
    ).toBe("verified");
  } finally {
    await store.close();
  }
});

test("a retained public failure seeds exactly one fresh repair attempt", async () => {
  const { store, gateway, input, prompts } = await setup();
  try {
    const result = await runCentralWorkflow(
      store,
      gateway,
      {
        ...input,
        feedbackSeed: {
          artifact: canonicalJson(makeRestrictedPatch(task, source)),
          publicDiagnostics: { stdout: "", stderr: "PUBLIC FAILURE" },
        },
        runner: {
          run: async () => ({
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
          }),
        },
      },
      new AbortController().signal,
    );
    expect(result.outcome).toBe("verified");
    expect(result.attemptIds).toHaveLength(1);
    expect(result.evaluationIds).toHaveLength(2);
    expect(prompts[0]).toContain("Retained prior artifact");
    expect(prompts[0]).toContain("PUBLIC FAILURE");
    expect(prompts.join("\n")).not.toContain("SECRET HIDDEN ASSERTIONS");
  } finally {
    await store.close();
  }
});

test("direct and feedback share initial prompt and direct never retries public failure", async () => {
  const a = await setup();
  const b = await setup();
  const runner: IsolatedCommandRunner = {
    run: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "fail",
      timedOut: false,
    }),
  };
  try {
    const direct = await runCentralWorkflow(
      a.store,
      a.gateway,
      { ...a.input, workflow: "direct", runner },
      new AbortController().signal,
    );
    const feedback = await runCentralWorkflow(
      b.store,
      b.gateway,
      { ...b.input, runner },
      new AbortController().signal,
    );
    expect(a.prompts[0]).toBe(b.prompts[0]);
    expect(direct.attemptIds).toHaveLength(1);
    expect(direct.evaluationIds).toHaveLength(2);
    expect(feedback.attemptIds).toHaveLength(2);
  } finally {
    await a.store.close();
    await b.store.close();
  }
});

test("public evaluator timeout is indeterminate with no retry or hidden evaluation", async () => {
  const { store, gateway, input, prompts } = await setup();
  try {
    const result = await runCentralWorkflow(
      store,
      gateway,
      {
        ...input,
        runner: {
          run: async () => ({
            exitCode: 1,
            stdout: "",
            stderr: "",
            timedOut: true,
          }),
        },
      },
      new AbortController().signal,
    );
    expect(result.outcome).toBe("indeterminate");
    expect(result.evaluationIds).toHaveLength(1);
    expect(prompts).toHaveLength(1);
    expect(result.stopReason).toContain("infrastructure");
  } finally {
    await store.close();
  }
});

test("unknown usage and observed ceilings stop further scheduling while retaining attempt evidence", async () => {
  for (const inputTokens of [null, 20_001]) {
    const { store, gateway, input, prompts } = await setup({
      usage: {
        known: inputTokens !== null,
        inputTokens,
        outputTokens: 1,
        totalTokens: inputTokens === null ? null : inputTokens + 1,
        cachedInputTokens: 0,
      },
    });
    try {
      const result = await runCentralWorkflow(
        store,
        gateway,
        input,
        new AbortController().signal,
      );
      expect(result.outcome).toBe("indeterminate");
      expect(prompts).toHaveLength(1);
      expect(result.evaluationIds).toHaveLength(0);
      expect(
        store.getProviderAttempt(result.attemptIds[0] ?? "")?.lifecycle,
      ).toBe("completed");
    } finally {
      await store.close();
    }
  }
});

test("provider interruption preserves indeterminate attempt and unknown cost", async () => {
  const { store, input } = await setup();
  try {
    const result = await runCentralWorkflow(
      store,
      {
        complete: async () => {
          throw new Error("connection lost");
        },
      },
      input,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      outcome: "indeterminate",
      totalTokens: null,
    });
    expect(result.attemptIds).toHaveLength(1);
    expect(
      store.getProviderAttempt(result.attemptIds[0] ?? "")?.lifecycle,
    ).toBe("indeterminate");
  } finally {
    await store.close();
  }
});

test("durable evaluations bind the actual custom isolation profile", async () => {
  const { store, gateway, input } = await setup();
  const evaluationProfile = {
    ref: "central/test-isolation@1",
    fingerprint: hashCanonicalJson({ runner: "fake-runner@1" }),
  };
  try {
    const result = await runCentralWorkflow(
      store,
      gateway,
      {
        ...input,
        evaluationProfile,
        runner: {
          run: async () => ({
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
          }),
        },
      },
      new AbortController().signal,
    );
    expect(result.outcome).toBe("verified");
    for (const id of result.evaluationIds)
      expect(store.getM3TaskEvaluation(id)).toMatchObject({
        profileRef: evaluationProfile.ref,
        evaluatorFingerprint: evaluationProfile.fingerprint,
      });
  } finally {
    await store.close();
  }
});

test("invalid artifacts cannot trigger feedback retries", async () => {
  const { store, gateway, input, prompts } = await setup({
    text: "not a patch",
  });
  try {
    const result = await runCentralWorkflow(
      store,
      gateway,
      input,
      new AbortController().signal,
    );
    expect(result.outcome).toBe("invalid-artifact");
    expect(prompts).toHaveLength(1);
    expect(result.evaluationIds).toHaveLength(0);
  } finally {
    await store.close();
  }
});

test("hidden evaluators cannot replace public dependencies", async () => {
  const { store, gateway, input, prompts } = await setup();
  try {
    await expect(
      runCentralWorkflow(
        store,
        gateway,
        { ...input, hiddenFiles: { "package.json": "{}" } },
        new AbortController().signal,
      ),
    ).rejects.toThrow("cannot replace public files");
    expect(prompts).toHaveLength(0);
  } finally {
    await store.close();
  }
});
