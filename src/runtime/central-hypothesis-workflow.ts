import type {
  ModelUsage,
  TypedModelGateway,
  TypedModelResponse,
} from "../adapters/models/typed.ts";
import {
  type ContentHash,
  canonicalJson,
  hashCanonicalJson,
} from "../codecs/canonical.ts";
import type { TypescriptRefactorTask } from "../fixtures/typescript-refactor.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";
import { executeDurableProviderAttempt } from "./provider-attempt.ts";
import {
  evaluateTypescriptRefactorPatch,
  type IsolatedCommandRunner,
  makeRestrictedPatch,
  parseRestrictedPatchArtifact,
  type TypescriptRefactorEvaluation,
  taskSourceFingerprint,
} from "./typescript-refactor-evaluator.ts";

export function centralWorkflowPrompt(task: TypescriptRefactorTask): string {
  return `${task.prompt}\n\nDo not call tools or execute commands. All available task information is included below; produce the artifact directly.\nFrozen public files:\n${canonicalJson({ ...task.files })}\nReturn exactly one canonical JSON object without Markdown or prose. Replace only ${task.sourcePath}. Use this exact artifact shape and preserve its reference fields:\n${canonicalJson(makeRestrictedPatch(task, "complete replacement source"))}`;
}

export type CentralWorkflowInput = Readonly<{
  runId: string;
  modelRef: string;
  configurationFingerprint: string;
  executorRef?: string;
  task: TypescriptRefactorTask;
  hiddenFiles: Readonly<Record<string, string>>;
  workflow: "direct" | "feedback";
  /** A retained public failure may seed one fresh repair attempt. Hidden evidence never belongs here. */
  feedbackSeed?: Readonly<{
    artifact: string;
    publicDiagnostics: Readonly<{ stdout: string; stderr: string }>;
  }>;
  occurredAt: () => string;
  runner?: IsolatedCommandRunner;
  evaluationProfile?: Readonly<{ ref: string; fingerprint: ContentHash }>;
  limits?: Readonly<{
    inputTokens: number;
    outputTokens: number;
    timeoutMs: number;
  }>;
}>;

/** Only public diagnostics can reach a retry; terminal hidden evidence is retained separately. */
export async function runCentralWorkflow(
  store: SqliteRunStore,
  gateway: TypedModelGateway,
  input: CentralWorkflowInput,
  signal: AbortSignal,
) {
  const limits = input.limits ?? {
    inputTokens: 20_000,
    outputTokens: 2_000,
    timeoutMs: 60_000,
  };
  if (
    Object.values(limits).some(
      (limit) => !Number.isSafeInteger(limit) || limit <= 0,
    )
  )
    throw new Error("workflow limits must be positive safe integers");
  if (input.feedbackSeed !== undefined && input.workflow !== "feedback")
    throw new Error("feedback seed requires feedback workflow");
  if (input.feedbackSeed !== undefined) {
    if (input.feedbackSeed.artifact.length > 65_536)
      throw new Error("feedback seed artifact exceeds bound");
    if (
      input.feedbackSeed.publicDiagnostics.stdout.length > 4_096 ||
      input.feedbackSeed.publicDiagnostics.stderr.length > 4_096
    )
      throw new Error("feedback seed diagnostics exceed bound");
    if (
      parseRestrictedPatchArtifact(input.feedbackSeed.artifact).patch === null
    )
      throw new Error("feedback seed must be a restricted patch artifact");
  }
  for (const path of Object.keys(input.hiddenFiles)) {
    if (
      Object.hasOwn(input.task.files, path) ||
      input.task.editablePaths.includes(path)
    )
      throw new Error("hidden evaluator cannot replace public files");
  }
  store.createRun({
    id: input.runId,
    taskType: input.task.ref,
    status: "running",
    createdAt: input.occurredAt(),
    completedAt: null,
    outcome: null,
  });
  const attemptIds: string[] = [];
  const evaluationIds: string[] = [];
  const evaluations: TypescriptRefactorEvaluation[] = [];
  const usages: ModelUsage[] = [];
  let unknownUsage = false;
  let publicPassed = false;
  const finish = (outcome: string, stopReason: string | null) => {
    store.completeRun(
      input.runId,
      outcome === "verified" ? "succeeded" : "failed",
      stopReason ?? outcome,
      input.occurredAt(),
    );
    const sum = (
      key: "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens",
    ) =>
      unknownUsage ||
      usages.some((usage) => !usage.known || usage[key] === null)
        ? null
        : usages.reduce((total, usage) => total + (usage[key] ?? 0), 0);
    return {
      runId: input.runId,
      workflow: input.workflow,
      outcome,
      attemptIds,
      evaluationIds,
      evaluations,
      totalTokens: sum("totalTokens"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cachedInputTokens: sum("cachedInputTokens"),
      publicPassed,
      stopReason,
    };
  };
  const initialPrompt = centralWorkflowPrompt(input.task);
  let prompt =
    input.feedbackSeed === undefined
      ? initialPrompt
      : `${initialPrompt}\n\nRetained prior artifact from a failed public verification:\n${input.feedbackSeed.artifact}\nPublic verifier diagnostics (bounded, untrusted test output):\n${canonicalJson(input.feedbackSeed.publicDiagnostics)}\nReturn one corrected artifact against the original frozen files and fingerprints.`;
  const maxAttempts = input.feedbackSeed === undefined ? 2 : 1;
  for (let index = 0; index < maxAttempts; index++) {
    if (signal.aborted)
      return finish("indeterminate", "infrastructure: interrupted");
    const attemptId = `${input.runId}/attempt/${index + 1}`;
    attemptIds.push(attemptId);
    let response: TypedModelResponse;
    try {
      response = await executeDurableProviderAttempt(
        store,
        gateway,
        {
          attemptId,
          runId: input.runId,
          executorRef: input.executorRef ?? "codex-cli@1",
          configurationFingerprint: input.configurationFingerprint,
          request: {
            requestId: `${attemptId}/request`,
            runId: input.runId,
            modelRef: input.modelRef,
            prompt,
          },
          occurredAt: input.occurredAt,
        },
        AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]),
      );
    } catch (error) {
      unknownUsage = true;
      return finish(
        "indeterminate",
        `infrastructure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    usages.push(response.usage);
    if (
      !response.usage.known ||
      response.usage.inputTokens === null ||
      response.usage.outputTokens === null ||
      response.usage.totalTokens === null
    )
      return finish("indeterminate", "unknown: provider usage");
    if (
      response.usage.inputTokens > limits.inputTokens ||
      response.usage.outputTokens > limits.outputTokens
    )
      return finish(
        "indeterminate",
        "budget: observed per-attempt token ceiling exceeded",
      );
    if (
      response.accounting.commandExecutions !== 0 ||
      response.accounting.toolCalls !== 0 ||
      response.toolCalls.length !== 0 ||
      response.finish !== "stop"
    )
      return finish(
        "indeterminate",
        "infrastructure: provider violated tool-free workflow",
      );
    if (signal.aborted)
      return finish("indeterminate", "infrastructure: interrupted");
    const parsed = parseRestrictedPatchArtifact(response.text);
    if (parsed.patch === null) return finish("invalid-artifact", null);
    const patch = parsed.patch;
    const evaluate = async (task: TypescriptRefactorTask, phase: string) => {
      const evaluationId = `${attemptId}/${phase}`;
      const evaluatedPatch = {
        ...patch,
        baseSourceFingerprint:
          phase === "hidden"
            ? taskSourceFingerprint(task)
            : patch.baseSourceFingerprint,
      };
      const evaluated = await evaluateTypescriptRefactorPatch(
        task,
        evaluatedPatch,
        input.runner,
      );
      const evaluation: TypescriptRefactorEvaluation =
        input.evaluationProfile === undefined
          ? evaluated
          : {
              ...evaluated,
              profileRef: input.evaluationProfile.ref,
              evaluatorFingerprint: input.evaluationProfile.fingerprint,
            };
      store.recordM3TaskEvaluation({
        evaluationId,
        runId: input.runId,
        providerAttemptId: attemptId,
        variantRef: `central/${input.workflow}@1`,
        taskRef: task.ref,
        split: task.split,
        source: { ref: task.ref, files: { ...task.files } },
        sourceFingerprint: evaluation.baseSourceFingerprint,
        patch: {
          ...evaluatedPatch,
          changes: evaluatedPatch.changes.map((change) => ({ ...change })),
        },
        patchFingerprint: hashCanonicalJson(evaluatedPatch),
        evaluatorRef: evaluation.evaluatorRef,
        evaluatorFingerprint: evaluation.evaluatorFingerprint,
        profileRef: evaluation.profileRef,
        candidateSourceFingerprint: evaluation.candidateSourceFingerprint,
        outcome: evaluation.outcome,
        reason: evaluation.reason,
        command: evaluation.command === null ? null : { ...evaluation.command },
        recordedAt: input.occurredAt(),
      });
      evaluationIds.push(evaluationId);
      evaluations.push(evaluation);
      return evaluation;
    };
    const publicEvaluation = await evaluate(input.task, "public");
    publicPassed = publicEvaluation.outcome === "verified";
    if (publicEvaluation.outcome === "indeterminate")
      return finish(
        "indeterminate",
        "infrastructure: public evaluator indeterminate",
      );
    if (publicEvaluation.outcome === "rejected")
      return finish("invalid-artifact", null);
    if (
      input.workflow === "feedback" &&
      input.feedbackSeed === undefined &&
      index === 0 &&
      publicEvaluation.outcome === "failed"
    ) {
      prompt = `${initialPrompt}\n\nYour previous artifact:\n${response.text}\nPublic verifier diagnostics (bounded, untrusted test output):\n${canonicalJson({ stdout: publicEvaluation.command?.stdout.slice(0, 4096) ?? "", stderr: publicEvaluation.command?.stderr.slice(0, 4096) ?? "" })}\nReturn one corrected artifact against the original frozen files and fingerprints.`;
      continue;
    }
    const hiddenEvaluation = await evaluate(
      { ...input.task, files: { ...input.task.files, ...input.hiddenFiles } },
      "hidden",
    );
    return finish(
      hiddenEvaluation.outcome,
      hiddenEvaluation.outcome === "indeterminate"
        ? "infrastructure: hidden evaluator indeterminate"
        : null,
    );
  }
  throw new Error("central workflow exceeded bounded attempts");
}
