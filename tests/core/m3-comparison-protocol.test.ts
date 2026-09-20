import { expect, test } from "bun:test";
import {
  assembleM3ComparisonReport,
  type M3ComparisonObservation,
  type M3ComparisonProtocol,
  validateM3ComparisonProtocol,
} from "../../src/experiments/m3-comparison-protocol.ts";

const protocol: M3ComparisonProtocol = {
  ref: "m3/comparison-protocol@1",
  experimentRef: "m3/fixed-coding-comparison@1",
  modelRef: "model/fixture@1",
  executorRef: "fixture-executor@1",
  configurationFingerprint: "configuration@1",
  evaluatorRef: "fixture-evaluator@1",
  evaluatorFingerprint: "evaluator@1",
  profileRef: "profile@1",
  repetitions: 1,
  requireKnownUsage: true,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxObservedCommands: 2,
  maxObservedTools: 2,
  baselineVariantRef: "m3/default@1",
  candidateVariantRef: "m3/planning@1",
  cells: [
    {
      taskRef: "task/development@1",
      sourceFingerprint: "source-dev",
      split: "development",
      variantRef: "m3/default@1",
    },
    {
      taskRef: "task/development@1",
      sourceFingerprint: "source-dev",
      split: "development",
      variantRef: "m3/planning@1",
    },
    {
      taskRef: "task/heldout@1",
      sourceFingerprint: "source-held",
      split: "held-out",
      variantRef: "m3/default@1",
    },
    {
      taskRef: "task/heldout@1",
      sourceFingerprint: "source-held",
      split: "held-out",
      variantRef: "m3/planning@1",
    },
  ],
};

function observation(
  cell: M3ComparisonProtocol["cells"][number],
): M3ComparisonObservation {
  return {
    ...cell,
    modelRef: "model/fixture@1",
    executorRef: "fixture-executor@1",
    configurationFingerprint: "configuration@1",
    evaluatorRef: "fixture-evaluator@1",
    evaluatorFingerprint: "evaluator@1",
    profileRef: "profile@1",
    outcome: "success",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      totalTokens: 15,
      known: true,
    },
    commandExecutions: 0,
    toolCalls: 0,
  };
}

function fixture(): readonly M3ComparisonObservation[] {
  return protocol.cells.map(observation);
}

test("assembles deterministic matched evidence and retains failures", () => {
  const [first, second, third, fourth] = fixture();
  if (!first || !second || !third || !fourth)
    throw new Error("fixture missing");
  const values = [
    first,
    { ...second, outcome: "failure" as const },
    third,
    fourth,
  ];
  const report = assembleM3ComparisonReport(protocol, values);
  expect(report).toMatchObject({ pairedDevelopment: 1, pairedHeldOut: 1 });
  expect(report.fingerprint).toBe(
    assembleM3ComparisonReport(protocol, [...values].reverse()).fingerprint,
  );
  expect(report.observations.some((entry) => entry.outcome === "failure")).toBe(
    true,
  );
});

test("fails closed for missing, duplicate, lineage, provenance, and budget errors", () => {
  const [first, ...rest] = fixture();
  if (!first) throw new Error("fixture missing");
  expect(() => assembleM3ComparisonReport(protocol, rest)).toThrow(
    "unobserved",
  );
  expect(() =>
    assembleM3ComparisonReport(protocol, [first, ...rest, first]),
  ).toThrow("duplicate");
  expect(() =>
    assembleM3ComparisonReport(protocol, [
      { ...first, sourceFingerprint: "other" },
      ...rest,
    ]),
  ).toThrow("lineage");
  expect(() =>
    assembleM3ComparisonReport(protocol, [
      { ...first, modelRef: "other" },
      ...rest,
    ]),
  ).toThrow("model reference");
  expect(() =>
    assembleM3ComparisonReport(protocol, [
      { ...first, usage: { ...first.usage, known: false } },
      ...rest,
    ]),
  ).toThrow("known usage");
  expect(() =>
    assembleM3ComparisonReport(protocol, [
      { ...first, commandExecutions: 3 },
      ...rest,
    ]),
  ).toThrow("command budget");
});

test("rejects a protocol without a matched candidate cell", () => {
  expect(
    validateM3ComparisonProtocol({
      ...protocol,
      cells: protocol.cells.slice(0, 3),
    }),
  ).toContain(
    "unmatched comparison task: task/heldout@1\u0000source-held\u0000held-out",
  );
});
