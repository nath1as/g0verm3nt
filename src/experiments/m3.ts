/**
 * Offline, provider-independent manifest for the first fixed coding experiment.
 * It names the variants and comparison policy without selecting a live model.
 */
export type M3Variant = Readonly<{
  ref: string;
  label: string;
  planning: "direct" | "explicit";
  planningScaffoldRef:
    | "m3/no-planning-scaffold@1"
    | "m3/prompt-only-planning@1"
    | "m3/restricted-patch-checklist@1";
  context: "elision" | "elision-summary";
  toolProfile: "typed-workspace-v1";
}>;

export type M3ExperimentManifest = Readonly<{
  ref: string;
  taskFamily: "typescript-refactor";
  acceptanceEvaluatorRef: string;
  budget: Readonly<{
    maxModelCalls: number;
    maxToolCalls: number;
    maxWallTimeMs: number;
  }>;
  variants: readonly M3Variant[];
  developmentVariantRefs: readonly string[];
  assessmentVariantRefs: readonly string[];
}>;

const variants: readonly M3Variant[] = Object.freeze([
  Object.freeze({
    ref: "m3/harness-default@1",
    label: "direct execution with deterministic context elision",
    planning: "direct",
    planningScaffoldRef: "m3/no-planning-scaffold@1",
    context: "elision",
    toolProfile: "typed-workspace-v1",
  }),
  Object.freeze({
    ref: "m3/harness-planning@1",
    label: "explicit planning with deterministic context elision",
    planning: "explicit",
    planningScaffoldRef: "m3/prompt-only-planning@1",
    context: "elision",
    toolProfile: "typed-workspace-v1",
  }),
  Object.freeze({
    ref: "m3/harness-summary@1",
    label: "direct execution with bounded summarization",
    planning: "direct",
    planningScaffoldRef: "m3/no-planning-scaffold@1",
    context: "elision-summary",
    toolProfile: "typed-workspace-v1",
  }),
  Object.freeze({
    ref: "m3/harness-planning-checklist@1",
    label: "task-derived restricted-patch planning checklist",
    planning: "explicit",
    planningScaffoldRef: "m3/restricted-patch-checklist@1",
    context: "elision",
    toolProfile: "typed-workspace-v1",
  }),
]);

export const m3ExperimentManifest: M3ExperimentManifest = Object.freeze({
  ref: "m3/fixed-coding-comparison@2",
  taskFamily: "typescript-refactor",
  acceptanceEvaluatorRef: "m3/typescript-refactor-evaluator@1",
  budget: Object.freeze({
    maxModelCalls: 12,
    maxToolCalls: 24,
    maxWallTimeMs: 300_000,
  }),
  variants,
  developmentVariantRefs: Object.freeze([
    "m3/harness-default@1",
    "m3/harness-planning-checklist@1",
  ]),
  assessmentVariantRefs: Object.freeze(["m3/harness-default@1"]),
});

export function getM3Variant(ref: string): M3Variant | undefined {
  return m3ExperimentManifest.variants.find((variant) => variant.ref === ref);
}

export function validateM3ExperimentManifest(
  manifest: M3ExperimentManifest,
): readonly string[] {
  const errors: string[] = [];
  const refs = new Set<string>();
  for (const variant of manifest.variants) {
    if (refs.has(variant.ref)) errors.push(`duplicate variant: ${variant.ref}`);
    refs.add(variant.ref);
  }
  for (const ref of manifest.developmentVariantRefs) {
    if (!refs.has(ref)) errors.push(`unknown development variant: ${ref}`);
  }
  for (const ref of manifest.assessmentVariantRefs) {
    if (!refs.has(ref)) errors.push(`unknown assessment variant: ${ref}`);
  }
  if (manifest.assessmentVariantRefs.length !== 1)
    errors.push("assessment must have exactly one frozen default variant");
  if (manifest.budget.maxModelCalls <= 0 || manifest.budget.maxToolCalls <= 0)
    errors.push("budgets must be positive");
  return errors;
}
