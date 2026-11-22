import { expect, test } from "bun:test";
import {
  checkApplicability,
  estimateObservation,
  selectAction,
  validateDecisionPartitions,
} from "../../src/core/semantic-decision.ts";
import {
  calibration,
  eligibility,
  input,
  manifest,
  policy,
  required,
  tokenizer,
} from "../fixtures/semantic-decision.ts";

function estimate(p = 0.99) {
  return estimateObservation(
    manifest,
    { ready: p, missing: 1 - p },
    calibration(),
    1000,
  );
}

test("applicability rejects unsupported, missing and oversized inputs before estimation", () => {
  expect(checkApplicability(manifest, input, tokenizer).kind).toBe(
    "Applicable",
  );
  for (const change of [
    { language: "ja" },
    { language: null },
    { taskFamily: "translate" },
    { repositoryLanguage: "python" },
    { environment: "live" },
    { evidence: {} },
  ]) {
    expect(
      checkApplicability(manifest, { ...input, ...change }, tokenizer).kind,
    ).toBe("Unknown");
  }
  const large = {
    ...input,
    evidence: { issue: { ref: "source/large", text: "a".repeat(2100) } },
  };
  expect(checkApplicability(manifest, large, tokenizer)).toMatchObject({
    kind: "Unknown",
    reason: "InputTooLong",
  });
  expect(
    checkApplicability(manifest, input, {
      ...tokenizer,
      ref: "tokenizer/other@1",
    }).kind,
  ).toBe("Unknown");
});

test("distribution boundary rejects malformed data without renormalizing", () => {
  for (const value of [
    null,
    [],
    { ready: 1 },
    { ready: 0.5, missing: 0.2 },
    { ready: NaN, missing: 0 },
    { ready: Infinity, missing: 0 },
    { ready: -0.1, missing: 1.1 },
    { ready: 1, missing: 0, extra: 0 },
  ]) {
    expect(
      estimateObservation(manifest, value, calibration(), 1000),
    ).toMatchObject({ kind: "Unknown", reason: "MalformedDistribution" });
  }
  expect(estimate(0.5)).toMatchObject({ kind: "Estimate", tag: "ready" });
});

test("calibration binds every estimator dependency and preserves raw probabilities", () => {
  const tuned = estimateObservation(
    manifest,
    { ready: 0.8, missing: 0.2 },
    { ...calibration(), temperature: 2 },
    1000,
  );
  expect(tuned).toMatchObject({
    rawProbabilities: { ready: 0.8, missing: 0.2 },
    calibratedProbabilities: { ready: 2 / 3, missing: 1 / 3 },
  });
  for (const changed of [
    { ...manifest, questionSchemaRef: "question/context@2" },
    { ...manifest, inputProjectionRef: "projection/evidence@2" },
    { ...manifest, modelArtifactHash: "new-weights" },
    { ...manifest, tokenizerRef: "tokenizer/other@1" },
    { ...manifest, options: [...manifest.options].reverse() },
    {
      ...manifest,
      applicability: { ...manifest.applicability, ref: "scope/code@2" },
    },
  ]) {
    const observation = estimateObservation(
      changed,
      { ready: 0.99, missing: 0.01 },
      calibration(),
      1000,
    );
    expect(observation).toMatchObject({
      calibratedProbabilities: null,
      calibrationReason: "CalibrationMismatch",
    });
    expect(selectAction(policy, observation, eligibility, 100).actionRef).toBe(
      policy.fallbackRef,
    );
  }
  for (const c of [
    null,
    { ...calibration(), validUntilMs: 1000 },
    { ...calibration(), temperature: 0 },
  ]) {
    expect(
      selectAction(
        policy,
        estimateObservation(manifest, { ready: 1, missing: 0 }, c, 1000),
        eligibility,
        100,
      ).actionRef,
    ).toBe(policy.fallbackRef);
  }
});

test("policy distinguishes predictions, independent eligibility, cost and budget", () => {
  expect(selectAction(policy, estimate(), eligibility, 100).actionRef).toBe(
    "action/quick@1",
  );
  expect(selectAction(policy, estimate(0.01), eligibility, 100).actionRef).toBe(
    "action/fixed@1",
  );
  expect(selectAction(policy, estimate(0.01), eligibility, 50).actionRef).toBe(
    "action/quick@1",
  );
  expect(
    selectAction(policy, estimate(), eligibility.slice(1), 100).actionRef,
  ).toBe(policy.fallbackRef);
  expect(selectAction(policy, estimate(), [], 100).kind).toBe("Stop");
  expect(selectAction(policy, estimate(), eligibility, 19).kind).toBe("Stop");
  expect(selectAction(policy, estimate(), eligibility, null).reason).toBe(
    "UnknownBudget",
  );
  for (const utility of [
    null,
    { ...required(required(policy.actions[0]).utility), unit: "dollars@1" },
    { ...required(required(policy.actions[0]).utility), losses: { ready: 0 } },
  ]) {
    expect(
      selectAction(
        {
          ...policy,
          actions: [
            { ...required(policy.actions[0]), utility },
            required(policy.actions[1]),
          ],
        },
        estimate(),
        eligibility,
        100,
      ).actionRef,
    ).toBe(policy.fallbackRef);
  }
  expect(
    selectAction(
      policy,
      { kind: "Unknown", reason: "UnsupportedScope" },
      eligibility,
      50,
    ).kind,
  ).toBe("Stop");
});

test("lineage leakage is rejected even under different trace identifiers", () => {
  expect(() =>
    validateDecisionPartitions({
      training: ["issue-a"],
      calibration: ["issue-b"],
      selection: ["issue-c"],
      assessment: ["issue-d"],
    }),
  ).not.toThrow();
  expect(() =>
    validateDecisionPartitions({
      training: ["issue-a"],
      calibration: ["issue-a"],
      selection: ["issue-c"],
      assessment: ["issue-d"],
    }),
  ).toThrow("lineage");
});
