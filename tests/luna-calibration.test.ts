import { expect, test } from "bun:test";
import { calibrationDecision } from "../src/experiments/luna-calibration.ts";
import { lunaCalibrationV2Tasks } from "../src/fixtures/luna-calibration-v2.ts";

test("calibration identifies a middle band without turning format failures into reasoning failures", () => {
  expect(calibrationDecision([])).toBe("incomplete");
  expect(calibrationDecision(Array(6).fill("verified"))).toBe("too-easy");
  expect(calibrationDecision(Array(6).fill("failed"))).toBe("too-hard");
  expect(
    calibrationDecision([
      "verified",
      "verified",
      "verified",
      "failed",
      "failed",
      "failed",
    ]),
  ).toBe("ready-for-workflow-comparison");
  expect(
    calibrationDecision([
      "verified",
      "verified",
      "failed",
      "failed",
      "failed",
      "invalid-artifact",
    ]),
  ).toBe("inconclusive-format-or-infrastructure");
});

test("v2 is a distinct six-task development corpus with extra defects", () => {
  expect(lunaCalibrationV2Tasks).toHaveLength(6);
  expect(
    new Set(lunaCalibrationV2Tasks.map((entry) => entry.task.ref)).size,
  ).toBe(6);
  for (const entry of lunaCalibrationV2Tasks) {
    expect(entry.task.ref).toStartWith("luna-v2/");
    expect(entry.task.files[entry.task.sourcePath]).not.toBe(
      entry.referenceSource,
    );
  }
});
