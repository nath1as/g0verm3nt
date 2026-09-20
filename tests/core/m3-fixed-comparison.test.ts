import { expect, test } from "bun:test";
import { assembleM3ComparisonReport } from "../../src/experiments/m3-comparison-protocol.ts";
import {
  m3DevelopmentComparisonProtocol,
  m3HeldOutComparisonProtocol,
  selectM3DevelopmentVariant,
} from "../../src/experiments/m3-fixed-comparison.ts";

function report(
  outcomes: readonly ["success" | "failure", "success" | "failure"],
  totals: readonly [number, number] = [100, 100],
) {
  return assembleM3ComparisonReport(
    m3DevelopmentComparisonProtocol,
    m3DevelopmentComparisonProtocol.cells.map((cell, index) => ({
      ...cell,
      modelRef: m3DevelopmentComparisonProtocol.modelRef,
      executorRef: m3DevelopmentComparisonProtocol.executorRef,
      configurationFingerprint:
        m3DevelopmentComparisonProtocol.configurationFingerprint,
      evaluatorRef: m3DevelopmentComparisonProtocol.evaluatorRef,
      evaluatorFingerprint:
        m3DevelopmentComparisonProtocol.evaluatorFingerprint,
      profileRef: m3DevelopmentComparisonProtocol.profileRef,
      outcome: outcomes[index] ?? "failure",
      usage: {
        inputTokens: totals[index] ?? 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: totals[index] ?? 0,
        known: true,
      },
      commandExecutions: 0,
      toolCalls: 0,
    })),
  );
}

test("M3 development protocol freezes only the paired development task", () => {
  expect(m3DevelopmentComparisonProtocol.cells).toHaveLength(2);
  expect(
    m3DevelopmentComparisonProtocol.cells.map((cell) => cell.split),
  ).toEqual(["development", "development"]);
  expect(m3DevelopmentComparisonProtocol.maxObservedCommands).toBe(0);
  expect(m3DevelopmentComparisonProtocol.maxObservedTools).toBe(0);
});

test("M3 selection is deterministic and does not inspect the held-out task", () => {
  expect(selectM3DevelopmentVariant(report(["failure", "success"]))).toEqual({
    selectedVariantRef: "m3/harness-planning-checklist@1",
    reason: "candidate-verified-while-baseline-failed",
  });
  expect(
    selectM3DevelopmentVariant(report(["success", "success"], [100, 99])),
  ).toEqual({
    selectedVariantRef: "m3/harness-planning-checklist@1",
    reason: "candidate-verified-with-lower-token-total",
  });
  expect(selectM3DevelopmentVariant(report(["success", "success"]))).toEqual({
    selectedVariantRef: "m3/harness-default@1",
    reason: "baseline-retained",
  });
});

test("held-out protocol is created only for a selected intervention", () => {
  expect(
    m3HeldOutComparisonProtocol({
      selectedVariantRef: "m3/harness-default@1",
      reason: "baseline-retained",
    }),
  ).toBeNull();
  expect(
    m3HeldOutComparisonProtocol({
      selectedVariantRef: "m3/harness-planning-checklist@1",
      reason: "candidate-verified-while-baseline-failed",
    })?.cells,
  ).toMatchObject([
    { split: "held-out", variantRef: "m3/harness-default@1" },
    { split: "held-out", variantRef: "m3/harness-planning-checklist@1" },
  ]);
});
