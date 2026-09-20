import { expect, test } from "bun:test";
import { FakeTypedModelGateway } from "../../src/adapters/models/fake-typed.ts";
import {
  m3BudgetWithinLimit,
  runM3Variant,
  validateM3RunRecord,
} from "../../src/experiments/m3-runner.ts";

test("M3 runner records deterministic outcome, usage, latency, and fingerprint", async () => {
  let time = 100;
  const record = await runM3Variant(new FakeTypedModelGateway("offline"), {
    runId: "m3-run-1",
    taskRef: "task/typescript-1",
    taskPrompt: "rename a function",
    variantRef: "m3/harness-default@1",
    now: () => (time += 7),
  });
  expect(record).toMatchObject({
    outcome: "unevaluated",
    success: false,
    executorAttempts: 1,
    modelCalls: 1,
    commandExecutions: 0,
    toolCalls: 0,
    latencyMs: 7,
    usageKnown: true,
  });
  expect(record.totalTokens).toBeGreaterThan(0);
  expect(record.responseFingerprint).toHaveLength(8);
  expect(validateM3RunRecord(record)).toEqual([]);
  expect(m3BudgetWithinLimit(record)).toBe(true);
});

test("M3 runner keeps provider failure distinct from zero usage", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const record = await runM3Variant(new FakeTypedModelGateway(), {
    runId: "m3-run-2",
    taskRef: "task/typescript-1",
    taskPrompt: "rename",
    variantRef: "m3/harness-planning@1",
    signal: controller.signal,
  });
  expect(record.outcome).toBe("cancelled");
  expect(record.success).toBe(false);
  expect(record.usageKnown).toBe(false);
  expect(record.executorAttempts).toBe(0);
  expect(record.modelCalls).toBeNull();
  expect(record.totalTokens).toBeNull();
  expect(validateM3RunRecord(record)).toEqual([]);
});
