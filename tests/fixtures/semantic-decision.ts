import type {
  ActionPolicy,
  Calibration,
  DecisionInput,
  DecisionManifest,
} from "../../src/core/semantic-decision.ts";
import { estimatorFingerprint } from "../../src/core/semantic-decision.ts";

export const manifest: DecisionManifest = {
  estimatorRef: "estimator/fake@1",
  modelRef: "model/fake@1",
  modelArtifactHash: "fixture-weights",
  tokenizerRef: "tokenizer/characters@1",
  inputProjectionRef: "projection/evidence@1",
  questionSchemaRef: "question/context@1",
  question: "Is more context needed?",
  options: [
    { tag: "ready", description: "Sufficient context" },
    { tag: "missing", description: "Context missing" },
  ],
  applicability: {
    ref: "scope/code@1",
    taskFamilies: ["repair"],
    languages: ["en"],
    repositoryLanguages: ["typescript"],
    environments: ["offline"],
    requiredEvidence: ["issue"],
    maxProjectedTokens: 2000,
  },
  probabilityTolerance: 0.000001,
};
export const input: DecisionInput = {
  inputRef: "input/one",
  taskFamily: "repair",
  language: "en",
  repositoryLanguage: "typescript",
  environment: "offline",
  evidence: { issue: { ref: "source/issue", text: "Repair the cache" } },
};
export function calibration(): Calibration {
  return {
    ref: "calibration/one@1",
    estimatorFingerprint: estimatorFingerprint(manifest),
    method: "temperature@1",
    temperature: 1,
    datasetRef: "dataset/calibration@1",
    labelSemanticsRef: "labels/context@1",
    evaluatorRef: "evaluator/context@1",
    lineage: ["calibration-issue"],
    validUntilMs: 2000,
  };
}
export const policy: ActionPolicy = {
  ref: "policy/one@1",
  unit: "loss-points@1",
  fallbackRef: "action/fixed@1",
  actions: [
    {
      ref: "action/quick@1",
      estimatedTokens: 20,
      utility: {
        unit: "loss-points@1",
        evidenceRef: "benefit/quick",
        losses: { ready: 0, missing: 10 },
        cost: 0,
      },
    },
    {
      ref: "action/fixed@1",
      estimatedTokens: 80,
      utility: {
        unit: "loss-points@1",
        evidenceRef: "benefit/fixed",
        losses: { ready: 1, missing: 1 },
        cost: 0,
      },
    },
  ],
};
export const eligibility = policy.actions.map((a) => ({
  actionRef: a.ref,
  evidenceRef: `eligibility/${a.ref}`,
}));
export const tokenizer = {
  ref: manifest.tokenizerRef,
  count: (text: string) => text.length,
};

export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("required fixture value missing");
  return value;
}
