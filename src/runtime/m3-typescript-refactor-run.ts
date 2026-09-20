import type {
  TypedModelGateway,
  TypedModelResponse,
} from "../adapters/models/typed.ts";
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import { getM3Variant, type M3Variant } from "../experiments/m3.ts";
import type { TypescriptRefactorTask } from "../fixtures/typescript-refactor.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";
import { executeDurableProviderAttempt } from "./provider-attempt.ts";
import {
  evaluateAndRecordTypescriptRefactorPatch,
  type IsolatedCommandRunner,
  parseRestrictedPatchArtifact,
  type TypescriptRefactorEvaluation,
  taskSourceFingerprint,
} from "./typescript-refactor-evaluator.ts";

export type M3TypescriptRefactorRun = Readonly<{
  runId: string;
  attemptId: string;
  evaluationId: string;
  variantRef: string;
  modelRef: string;
  executorRef: string;
  configurationFingerprint: string;
  task: TypescriptRefactorTask;
  occurredAt: () => string;
  runner?: IsolatedCommandRunner;
}>;

export type M3TypescriptRefactorResult = Readonly<{
  runId: string;
  attemptId: string;
  evaluationId: string | null;
  outcome:
    | TypescriptRefactorEvaluation["outcome"]
    | "invalid-artifact"
    | "provider-failure";
  reason: string;
  evaluation: TypescriptRefactorEvaluation | null;
}>;

function planningScaffold(
  variant: M3Variant,
  task: TypescriptRefactorTask,
  source: string,
): string {
  if (variant.planningScaffoldRef !== "m3/restricted-patch-checklist@1")
    return "";
  return `\n\nPlanning checklist (derive the final artifact from these frozen facts):\n1. Task ref: ${task.ref}\n2. Editable path: ${task.sourcePath}\n3. Base source fingerprint: ${hashCanonicalJson(source)}\n4. Preserve the module export and TypeScript return type.\n5. Emit one full-file replacement for the editable path, then return only the canonical JSON artifact.`;
}

export function m3RefactorPrompt(
  variant: M3Variant,
  task: TypescriptRefactorTask,
): string {
  const planning =
    variant.planning === "explicit"
      ? "plan internally, then execute"
      : "execute directly";
  const context =
    variant.context === "elision-summary"
      ? "summarize only unnecessary context internally"
      : "do not add context beyond the task";
  const source = task.files[task.sourcePath];
  if (source === undefined) throw new Error("M3 task source file is missing");
  return `${task.prompt}\n\nFrozen baseline at ${task.sourcePath}:\n${source}\nStrategy: ${planning}; ${context}.${planningScaffold(variant, task, source)}\nReturn exactly one canonical JSON object and no Markdown or prose. It must have lexicographically ordered keys and this exact shape:\n${canonicalJson(
    {
      baseSourceFingerprint: taskSourceFingerprint(task),
      changes: [
        {
          after: "the complete replacement source",
          beforeFingerprint: hashCanonicalJson(source),
          path: task.sourcePath,
        },
      ],
      taskRef: task.ref,
    },
  )}`;
}

/**
 * One bounded coding attempt: retain provider evidence before interpreting the
 * response, then accept only a restricted patch into the independent evaluator.
 */
export async function runM3TypescriptRefactor(
  store: SqliteRunStore,
  gateway: TypedModelGateway,
  input: M3TypescriptRefactorRun,
  signal: AbortSignal,
): Promise<M3TypescriptRefactorResult> {
  const variant = getM3Variant(input.variantRef);
  if (variant === undefined)
    throw new Error(`unknown M3 variant: ${input.variantRef}`);
  store.createRun({
    id: input.runId,
    taskType: input.task.ref,
    status: "running",
    createdAt: input.occurredAt(),
    completedAt: null,
    outcome: null,
  });
  let response: TypedModelResponse;
  try {
    response = await executeDurableProviderAttempt(
      store,
      gateway,
      {
        attemptId: input.attemptId,
        runId: input.runId,
        executorRef: input.executorRef,
        configurationFingerprint: input.configurationFingerprint,
        request: {
          requestId: `${input.attemptId}/request/1`,
          runId: input.runId,
          modelRef: input.modelRef,
          prompt: m3RefactorPrompt(variant, input.task),
        },
        occurredAt: input.occurredAt,
      },
      signal,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    store.completeRun(input.runId, "failed", reason, input.occurredAt());
    return {
      runId: input.runId,
      attemptId: input.attemptId,
      evaluationId: null,
      outcome: "provider-failure",
      reason,
      evaluation: null,
    };
  }
  const parsed = parseRestrictedPatchArtifact(response.text);
  if (parsed.patch === null) {
    const reason = parsed.error ?? "model response did not contain a patch";
    store.completeRun(input.runId, "failed", reason, input.occurredAt());
    return {
      runId: input.runId,
      attemptId: input.attemptId,
      evaluationId: null,
      outcome: "invalid-artifact",
      reason,
      evaluation: null,
    };
  }
  const evaluation = await evaluateAndRecordTypescriptRefactorPatch(store, {
    evaluationId: input.evaluationId,
    runId: input.runId,
    providerAttemptId: input.attemptId,
    variantRef: variant.ref,
    task: input.task,
    patch: parsed.patch,
    occurredAt: input.occurredAt(),
    ...(input.runner === undefined ? {} : { runner: input.runner }),
  });
  store.completeRun(
    input.runId,
    evaluation.outcome === "verified" ? "succeeded" : "failed",
    evaluation.reason,
    input.occurredAt(),
  );
  return {
    runId: input.runId,
    attemptId: input.attemptId,
    evaluationId: input.evaluationId,
    outcome: evaluation.outcome,
    reason: evaluation.reason,
    evaluation,
  };
}
