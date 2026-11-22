import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TypedModelGateway } from "../src/adapters/models/typed.ts";
import { runSemanticDecision } from "../src/runtime/semantic-decision.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";
import {
  calibration,
  eligibility,
  input,
  manifest,
  policy,
  required,
  tokenizer,
} from "./fixtures/semantic-decision.ts";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), "government-decision-"));
  paths.push(path);
  return path;
}
function request(runId = "decision-one") {
  return {
    runId,
    manifest,
    calibration: calibration(),
    input,
    policy,
    eligibility,
    tokenizer,
    catalogueManifestRef: "catalogue/fake@1",
    limits: {
      maxObservedTokens: 2000,
      inferenceTokenAllowance: 1500,
      timeoutMs: 1000,
    },
    occurredAt: () => "1970-01-01T00:00:01.000Z",
  };
}
function gateway(
  text = '{"ready":0.99,"missing":0.01}',
  totalTokens: number | null = 10,
): TypedModelGateway {
  return {
    complete: async (r) => ({
      requestId: r.requestId,
      modelRef: r.modelRef,
      text,
      toolCalls: [],
      finish: "stop",
      accounting: {
        executorAttempts: 1,
        modelCalls: 1,
        commandExecutions: 0,
        toolCalls: 0,
      },
      usage: {
        known: totalTokens !== null,
        totalTokens,
        inputTokens: totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
      },
    }),
  };
}

test("durable decision retains full provenance and survives restart without replay", async () => {
  const path = directory();
  let store = await SqliteRunStore.open(path);
  let calls = 0;
  const fake = gateway();
  try {
    const result = await runSemanticDecision(
      store,
      {
        complete: async (r, s) => {
          calls++;
          expect(
            store
              .getRun(r.runId)
              ?.events.some((e) => e.kind === "SemanticDecisionPlanned"),
          ).toBe(true);
          return fake.complete(r, s);
        },
      },
      request(),
      new AbortController().signal,
    );
    expect(result.selection.actionRef).toBe("action/quick@1");
    expect(result.observedTokens).toBe(10);
    const detail = required(store.getRun("decision-one"));
    expect(detail.events.map((e) => e.kind)).toEqual([
      "RunRequested",
      "SemanticDecisionPlanned",
      "ProviderAttemptPlanned",
      "ProviderAttemptDispatched",
      "ProviderAttemptCompleted",
      "SemanticObservationRecorded",
      "SemanticActionSelected",
      "RunCompleted",
    ]);
    expect(detail.run.outcome).toBe(JSON.stringify(result));
    const planned = JSON.parse(
      required(required(detail.events[1]).payload.record),
    );
    expect(planned.input).toEqual(input);
    expect(planned.calibration).toEqual(calibration());
    await store.close();
    store = await SqliteRunStore.open(path);
    expect(required(store.getRun("decision-one")).run.outcome).toBe(
      JSON.stringify(result),
    );
    await expect(
      runSemanticDecision(
        store,
        {
          complete: async (r, signal) => {
            calls++;
            return fake.complete(r, signal);
          },
        },
        request(),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    await store.close();
  }
});

test("unsupported input, missing calibration and insufficient inference allocation never call estimator", async () => {
  const store = await SqliteRunStore.open(directory());
  let calls = 0;
  const fake: TypedModelGateway = {
    complete: async () => {
      calls++;
      throw new Error("must not dispatch");
    },
  };
  try {
    for (const [index, changes] of [
      { input: { ...input, language: "ja" } },
      { calibration: null },
      { limits: { ...request().limits, inferenceTokenAllowance: 10 } },
    ].entries()) {
      const result = await runSemanticDecision(
        store,
        fake,
        { ...request(`skip-${index}`), ...changes },
        new AbortController().signal,
      );
      expect(result.observation.kind).toBe("Unknown");
      expect(result.attemptId).toBeNull();
    }
    expect(calls).toBe(0);
  } finally {
    await store.close();
  }
});

test("malformed probability output retains usage; consumed and unknown budgets stop selection", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    const malformed = await runSemanticDecision(
      store,
      gateway("not JSON"),
      request("malformed"),
      new AbortController().signal,
    );
    expect(malformed.observation).toEqual({
      kind: "Unknown",
      reason: "MalformedDistribution",
    });
    expect(malformed.observedTokens).toBe(10);
    expect(malformed.selection.actionRef).toBe(policy.fallbackRef);
    for (const [index, tokens] of [1990, null, 2001].entries()) {
      const result = await runSemanticDecision(
        store,
        gateway(undefined, tokens),
        request(`budget-${index}`),
        new AbortController().signal,
      );
      expect(result.selection.kind).toBe("Stop");
      expect(result.observedTokens).toBe(tokens);
    }
  } finally {
    await store.close();
  }
});

test("cancelled and uncertain inference never fall back, including adapters ignoring abort", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const never: TypedModelGateway = {
      complete: async () => {
        calls++;
        return new Promise(() => {});
      },
    };
    const cancelled = await runSemanticDecision(
      store,
      never,
      request("cancelled"),
      controller.signal,
    );
    expect(cancelled.selection.reason).toBe("Cancelled");
    expect(calls).toBe(0);
    const timed = await runSemanticDecision(
      store,
      never,
      { ...request("timeout"), limits: { ...request().limits, timeoutMs: 10 } },
      new AbortController().signal,
    );
    expect(timed.selection.reason).toBe("IndeterminateInference");
    expect(store.getProviderAttempt("timeout/inference")?.lifecycle).toBe(
      "indeterminate",
    );
    expect(calls).toBe(1);
    await expect(
      runSemanticDecision(
        store,
        never,
        request("timeout"),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    await store.close();
  }
});

test("post-inference remaining budget is checked even without an inference overshoot", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    const result = await runSemanticDecision(
      store,
      gateway(undefined, 990),
      {
        ...request(),
        limits: {
          maxObservedTokens: 1000,
          inferenceTokenAllowance: 1000,
          timeoutMs: 1000,
        },
      },
      new AbortController().signal,
    );
    expect(result.selection).toMatchObject({
      kind: "Stop",
      reason: "FallbackUnavailable",
    });
    expect(result.observedTokens).toBe(990);
  } finally {
    await store.close();
  }
});

test("caller mutation cannot alter the recorded policy while inference is pending", async () => {
  const store = await SqliteRunStore.open(directory());
  const original = request();
  const mutable = {
    ...original,
    policy: structuredClone(policy),
    manifest: structuredClone(manifest),
  };
  const fake = gateway();
  try {
    const result = await runSemanticDecision(
      store,
      {
        complete: async (r, s) => {
          Object.assign(mutable.policy, {
            fallbackRef: "action/injected@1",
            actions: [],
          });
          Object.assign(mutable.manifest, {
            modelArtifactHash: "changed-while-running",
          });
          return fake.complete(r, s);
        },
      },
      mutable,
      new AbortController().signal,
    );
    expect(result.selection.actionRef).toBe("action/quick@1");
    expect(result.observation).toMatchObject({ calibrationReason: null });
  } finally {
    await store.close();
  }
});

test("calibration is checked again after inference and expired evidence only permits fixed fallback", async () => {
  const store = await SqliteRunStore.open(directory());
  let timestamp = "1970-01-01T00:00:01.000Z";
  const fake = gateway();
  try {
    const result = await runSemanticDecision(
      store,
      {
        complete: async (r, s) => {
          timestamp = "1970-01-01T00:00:03.000Z";
          return fake.complete(r, s);
        },
      },
      { ...request(), occurredAt: () => timestamp },
      new AbortController().signal,
    );
    expect(result.observation).toMatchObject({
      calibrationReason: "ExpiredCalibration",
    });
    expect(result.selection.actionRef).toBe(policy.fallbackRef);
  } finally {
    await store.close();
  }
});
