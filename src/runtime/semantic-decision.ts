import type {
  TypedModelGateway,
  TypedModelResponse,
} from "../adapters/models/typed.ts";
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import {
  type ActionEligibility,
  type ActionPolicy,
  type ActionSelection,
  type Calibration,
  calibrationStatus,
  checkApplicability,
  type DecisionInput,
  type DecisionManifest,
  type DecisionTokenizer,
  estimateObservation,
  type Observation,
  selectAction,
  validateActionPolicy,
  validateDecisionManifest,
} from "../core/semantic-decision.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";
import { executeDurableProviderAttempt } from "./provider-attempt.ts";

export type SemanticDecisionRequest = Readonly<{
  runId: string;
  manifest: DecisionManifest;
  calibration: Calibration | null;
  input: DecisionInput;
  policy: ActionPolicy;
  eligibility: ActionEligibility;
  catalogueManifestRef: string;
  tokenizer: DecisionTokenizer;
  limits: Readonly<{
    /** Observed input+output threshold, never a guaranteed provider billing cap. */
    maxObservedTokens: number;
    inferenceTokenAllowance: number;
    timeoutMs: number;
  }>;
  occurredAt: () => string;
}>;
export type SemanticDecisionResult = Readonly<{
  runId: string;
  manifestHash: string;
  attemptId: string | null;
  observation: Observation;
  selection: ActionSelection;
  observedTokens: number | null;
}>;

function stop(reason: string): ActionSelection {
  return { kind: "Stop", actionRef: null, reason, expectedLoss: null };
}

function observedTokens(response: TypedModelResponse): number | null {
  const { inputTokens, outputTokens, cachedInputTokens, totalTokens, known } =
    response.usage;
  if (
    !known ||
    inputTokens === null ||
    outputTokens === null ||
    cachedInputTokens === null ||
    totalTokens === null
  )
    return null;
  if (
    [inputTokens, outputTokens, cachedInputTokens, totalTokens].some(
      (v) => !Number.isSafeInteger(v) || v < 0,
    )
  )
    return null;
  if (
    inputTokens + outputTokens !== totalTokens ||
    cachedInputTokens > inputTokens
  )
    return null;
  return totalTokens;
}

/** Stop waiting on an uncooperative adapter; leave its dispatched effect indeterminate. */
function boundedGateway(gateway: TypedModelGateway): TypedModelGateway {
  return {
    async complete(request, signal) {
      if (signal.aborted) throw signal.reason;
      let abort: () => void = () => {};
      const interruption = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      });
      try {
        return await Promise.race([
          gateway.complete(request, signal),
          interruption,
        ]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}

/**
 * Offline-qualified decision recorder. It never executes the recommended action,
 * changes a graph, issues a receipt, or treats eligibility references as grants.
 */
export async function runSemanticDecision(
  store: SqliteRunStore,
  gateway: TypedModelGateway,
  request: SemanticDecisionRequest,
  signal: AbortSignal,
): Promise<SemanticDecisionResult> {
  const { tokenizer, occurredAt, ...data } = request;
  // Caller mutation during inference must not change the recorded policy or calibration.
  const frozen = structuredClone(data);
  const { manifest, calibration, input, policy, eligibility, limits, runId } =
    frozen;
  validateDecisionManifest(manifest);
  validateActionPolicy(policy);
  if (
    !runId.trim() ||
    !frozen.catalogueManifestRef.trim() ||
    Object.values(limits).some((v) => !Number.isSafeInteger(v) || v <= 0) ||
    limits.inferenceTokenAllowance > limits.maxObservedTokens ||
    limits.timeoutMs > 2147483647
  )
    throw new Error("invalid semantic decision limits or identity");
  const startedAt = occurredAt();
  if (!Number.isSafeInteger(Date.parse(startedAt)))
    throw new Error("invalid semantic decision clock");
  const manifestHash = hashCanonicalJson({ manifest, calibration });
  const applicability = signal.aborted
    ? { kind: "Unknown" as const, reason: "Cancelled" }
    : checkApplicability(manifest, input, tokenizer);
  const record = canonicalJson({ ...frozen, manifestHash, applicability });
  if (Buffer.byteLength(record) > 1048576)
    throw new Error("semantic decision record exceeds 1 MiB");
  // Unique run identity makes re-entry/restart fail closed before provider dispatch.
  store.createRun({
    id: runId,
    taskType: "semantic-decision@1",
    status: "running",
    createdAt: startedAt,
    completedAt: null,
    outcome: null,
  });
  store.appendEvent(runId, "SemanticDecisionPlanned", startedAt, { record });
  let attemptId: string | null = null;
  let tokens: number | null = 0;
  const finish = (
    observation: Observation,
    selection: ActionSelection,
    status: "succeeded" | "failed" | "cancelled" = "succeeded",
  ): SemanticDecisionResult => {
    const now = occurredAt();
    const result = {
      runId,
      manifestHash,
      attemptId,
      observation,
      selection,
      observedTokens: tokens,
    };
    store.appendEvent(runId, "SemanticObservationRecorded", now, {
      record: canonicalJson({
        manifestHash,
        attemptId,
        observation,
        observedTokens: tokens,
      }),
    });
    store.appendEvent(runId, "SemanticActionSelected", now, {
      record: canonicalJson({
        policyRef: policy.ref,
        policyHash: hashCanonicalJson(policy),
        catalogueManifestRef: frozen.catalogueManifestRef,
        eligibility,
        remainingObservedTokens:
          tokens === null
            ? null
            : Math.max(0, limits.maxObservedTokens - tokens),
        selection,
      }),
    });
    store.completeRun(runId, status, JSON.stringify(result), now);
    return result;
  };
  if (signal.aborted)
    return finish(
      { kind: "Unknown", reason: "Cancelled" },
      stop("Cancelled"),
      "cancelled",
    );
  const unavailable =
    applicability.kind === "Unknown"
      ? applicability.reason
      : (calibrationStatus(manifest, calibration, Date.parse(startedAt)) ??
        (applicability.tokenCount >= limits.inferenceTokenAllowance
          ? "InferenceBudgetUnavailable"
          : null));
  if (unavailable !== null) {
    const observation = { kind: "Unknown" as const, reason: unavailable };
    return finish(
      observation,
      selectAction(policy, observation, eligibility, limits.maxObservedTokens),
    );
  }
  if (applicability.kind !== "Applicable")
    throw new Error("unreachable applicability state");
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("semantic inference deadline")),
    limits.timeoutMs,
  );
  let response: TypedModelResponse;
  attemptId = `${runId}/inference`;
  tokens = null;
  try {
    response = await executeDurableProviderAttempt(
      store,
      boundedGateway(gateway),
      {
        attemptId,
        runId,
        executorRef: manifest.estimatorRef,
        configurationFingerprint: manifestHash,
        request: {
          requestId: `${runId}/request`,
          runId,
          modelRef: manifest.modelRef,
          prompt: applicability.prompt,
        },
        occurredAt,
      },
      controller.signal,
    );
  } catch {
    return finish(
      { kind: "Unknown", reason: "IndeterminateInference" },
      stop("IndeterminateInference"),
      signal.aborted ? "cancelled" : "failed",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
  tokens = observedTokens(response);
  if (signal.aborted || controller.signal.aborted)
    return finish(
      { kind: "Unknown", reason: "InterruptedInference" },
      stop("InterruptedInference"),
      signal.aborted ? "cancelled" : "failed",
    );
  if (
    response.modelRef !== manifest.modelRef ||
    response.finish !== "stop" ||
    response.toolCalls.length !== 0 ||
    response.accounting.commandExecutions !== 0 ||
    response.accounting.toolCalls !== 0
  )
    return finish(
      { kind: "Unknown", reason: "UnexpectedProviderActivity" },
      stop("UnexpectedProviderActivity"),
      "failed",
    );
  let value: unknown = null;
  if (Buffer.byteLength(response.text) <= 65536) {
    try {
      value = JSON.parse(response.text);
    } catch {
      /* Invalid output remains observable and charged. */
    }
  }
  const observation = estimateObservation(
    manifest,
    value,
    calibration,
    Date.parse(occurredAt()),
  );
  if (tokens === null) return finish(observation, stop("UnknownBudget"));
  if (tokens > limits.inferenceTokenAllowance)
    return finish(observation, stop("InferenceAllowanceExceeded"));
  return finish(
    observation,
    selectAction(
      policy,
      observation,
      eligibility,
      limits.maxObservedTokens - tokens,
    ),
  );
}
