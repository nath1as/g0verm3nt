import { codexCliProfileRef } from "../adapters/models/codex-cli.ts";
import {
  heldOutTypescriptRefactorTask,
  taskSourceFingerprint,
  typescriptRefactorTask,
} from "../fixtures/typescript-refactor.ts";
import { evaluatorFingerprint } from "../runtime/typescript-refactor-evaluator.ts";
import { m3ExperimentManifest } from "./m3.ts";
import type {
  M3ComparisonProtocol,
  M3ComparisonReport,
} from "./m3-comparison-protocol.ts";

const baselineVariantRef = "m3/harness-default@1";
const candidateVariantRef = "m3/harness-planning-checklist@1";

function cellsFor(
  task: typeof typescriptRefactorTask | typeof heldOutTypescriptRefactorTask,
): readonly M3ComparisonProtocol["cells"][number][] {
  return Object.freeze(
    [baselineVariantRef, candidateVariantRef].map((variantRef) =>
      Object.freeze({
        taskRef: task.ref,
        sourceFingerprint: taskSourceFingerprint(task),
        split: task.split,
        variantRef,
      }),
    ),
  );
}

function protocol(
  ref: string,
  cells: readonly M3ComparisonProtocol["cells"][number][],
): M3ComparisonProtocol {
  return Object.freeze({
    ref,
    experimentRef: m3ExperimentManifest.ref,
    modelRef: "gpt-6-astra",
    executorRef: "codex-cli@1",
    configurationFingerprint: codexCliProfileRef,
    evaluatorRef: typescriptRefactorTask.evaluatorRef,
    evaluatorFingerprint: evaluatorFingerprint(),
    profileRef: typescriptRefactorTask.profileRef,
    repetitions: 1,
    requireKnownUsage: true,
    maxInputTokens: 20_000,
    maxOutputTokens: 2_000,
    maxObservedCommands: 0,
    maxObservedTools: 0,
    baselineVariantRef,
    candidateVariantRef,
    cells,
  });
}

/** First paid cohort: one development task, paired under both frozen variants. */
export const m3DevelopmentComparisonProtocol = protocol(
  "m3/development-comparison@1",
  cellsFor(typescriptRefactorTask),
);

export type M3DevelopmentSelection = Readonly<{
  selectedVariantRef: string;
  reason:
    | "candidate-verified-while-baseline-failed"
    | "candidate-verified-with-lower-token-total"
    | "baseline-retained";
}>;

/**
 * A deterministic selection rule prevents looking at the held-out task while
 * choosing a development winner. The checklist must either recover a failed
 * baseline or retain verified behavior with a lower known total-token count.
 */
export function selectM3DevelopmentVariant(
  report: M3ComparisonReport,
): M3DevelopmentSelection {
  if (report.protocolRef !== m3DevelopmentComparisonProtocol.ref)
    throw new Error(
      "development selection requires the frozen development report",
    );
  const baseline = report.observations.find(
    (entry) => entry.variantRef === baselineVariantRef,
  );
  const candidate = report.observations.find(
    (entry) => entry.variantRef === candidateVariantRef,
  );
  if (baseline === undefined || candidate === undefined)
    throw new Error("development report is missing a paired variant");
  if (candidate.outcome === "success" && baseline.outcome === "failure")
    return Object.freeze({
      selectedVariantRef: candidateVariantRef,
      reason: "candidate-verified-while-baseline-failed",
    });
  if (
    candidate.outcome === "success" &&
    baseline.outcome === "success" &&
    candidate.usage.totalTokens !== null &&
    baseline.usage.totalTokens !== null &&
    candidate.usage.totalTokens < baseline.usage.totalTokens
  )
    return Object.freeze({
      selectedVariantRef: candidateVariantRef,
      reason: "candidate-verified-with-lower-token-total",
    });
  return Object.freeze({
    selectedVariantRef: baselineVariantRef,
    reason: "baseline-retained",
  });
}

/**
 * Held-out work exists only if development selected the intervention. It is
 * then paired against the default with the same model, executor and ceilings.
 */
export function m3HeldOutComparisonProtocol(
  selection: M3DevelopmentSelection,
): M3ComparisonProtocol | null {
  if (selection.selectedVariantRef === baselineVariantRef) return null;
  if (selection.selectedVariantRef !== candidateVariantRef)
    throw new Error("development selection names an unknown M3 variant");
  return protocol(
    "m3/held-out-comparison@1",
    cellsFor(heldOutTypescriptRefactorTask),
  );
}
