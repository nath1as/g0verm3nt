import { expect, test } from "bun:test";
import {
  getM3Variant,
  m3ExperimentManifest,
  validateM3ExperimentManifest,
} from "../../src/experiments/m3.ts";

test("M3 fixed comparison manifest is deterministic and valid", () => {
  expect(validateM3ExperimentManifest(m3ExperimentManifest)).toEqual([]);
  expect(m3ExperimentManifest.variants).toHaveLength(4);
  expect(m3ExperimentManifest.developmentVariantRefs).toEqual([
    "m3/harness-default@1",
    "m3/harness-planning-checklist@1",
  ]);
  expect(m3ExperimentManifest.assessmentVariantRefs).toEqual([
    "m3/harness-default@1",
  ]);
});

test("M3 manifest resolves registered variants only", () => {
  expect(getM3Variant("m3/harness-planning@1")?.planning).toBe("explicit");
  expect(
    getM3Variant("m3/harness-planning-checklist@1")?.planningScaffoldRef,
  ).toBe("m3/restricted-patch-checklist@1");
  expect(getM3Variant("m3/unknown@1")).toBeUndefined();
});

test("M3 validation rejects unknown and duplicate comparison entries", () => {
  const first = m3ExperimentManifest.variants.at(0);
  if (first === undefined) throw new Error("missing default variant");
  const invalid = {
    ...m3ExperimentManifest,
    variants: [first, first],
    developmentVariantRefs: ["m3/missing@1"],
    assessmentVariantRefs: ["m3/missing@1", "m3/other@1"],
  };
  expect(validateM3ExperimentManifest(invalid)).toEqual([
    "duplicate variant: m3/harness-default@1",
    "unknown development variant: m3/missing@1",
    "unknown assessment variant: m3/missing@1",
    "unknown assessment variant: m3/other@1",
    "assessment must have exactly one frozen default variant",
  ]);
});
