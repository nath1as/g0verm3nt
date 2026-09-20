import type {
  TypedModelGateway,
  TypedModelResponse,
} from "../adapters/models/typed.ts";
import { getM3Variant, type M3Variant, m3ExperimentManifest } from "./m3.ts";

export type M3RunRecord = Readonly<{
  runId: string;
  variantRef: string;
  modelRef: string;
  taskRef: string;
  outcome: "unevaluated" | "failure" | "cancelled";
  success: boolean;
  executorAttempts: number;
  /** Null when an external executor does not expose underlying model calls. */
  modelCalls: number | null;
  commandExecutions: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageKnown: boolean;
  toolCalls: number;
  latencyMs: number;
  error: string | null;
  responseFingerprint: string | null;
}>;

export type M3RunOptions = Readonly<{
  runId: string;
  taskRef: string;
  taskPrompt: string;
  variantRef: string;
  modelRef?: string;
  signal?: AbortSignal;
  now?: () => number;
}>;

function stableFingerprint(response: TypedModelResponse): string {
  const payload = JSON.stringify({
    modelRef: response.modelRef,
    text: response.text,
    toolCalls: response.toolCalls,
    usage: response.usage,
    finish: response.finish,
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function promptForVariant(variant: M3Variant, taskPrompt: string): string {
  const planning =
    variant.planning === "explicit" ? "plan then execute" : "execute directly";
  const context =
    variant.context === "elision-summary"
      ? "summarize context"
      : "elide context";
  return `[${planning}; ${context}] ${taskPrompt}`;
}

/** Runs one frozen M3 variant through the provider-neutral boundary. */
export async function runM3Variant(
  gateway: TypedModelGateway,
  options: M3RunOptions,
): Promise<M3RunRecord> {
  const variant = getM3Variant(options.variantRef);
  if (!variant) throw new Error(`unknown M3 variant: ${options.variantRef}`);
  if (!options.runId || !options.taskRef)
    throw new Error("run and task references are required");
  const modelRef = options.modelRef ?? "model/fake@1";
  const now = options.now ?? (() => Date.now());
  const started = now();
  const request = {
    requestId: `${options.runId}/model/1`,
    runId: options.runId,
    modelRef,
    prompt: promptForVariant(variant, options.taskPrompt),
    tools: [{ name: "workspace", description: "typed workspace inspection" }],
  } as const;
  try {
    const response = await gateway.complete(
      request,
      options.signal ?? new AbortController().signal,
    );
    const usage = response.usage;
    return {
      runId: options.runId,
      variantRef: variant.ref,
      modelRef: response.modelRef,
      taskRef: options.taskRef,
      outcome: "unevaluated",
      success: false,
      executorAttempts: response.accounting.executorAttempts,
      modelCalls: response.accounting.modelCalls,
      commandExecutions: response.accounting.commandExecutions,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      usageKnown: usage.known,
      toolCalls: response.accounting.toolCalls,
      latencyMs: Math.max(0, now() - started),
      error: null,
      responseFingerprint: stableFingerprint(response),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = options.signal?.aborted === true;
    return {
      runId: options.runId,
      variantRef: variant.ref,
      modelRef,
      taskRef: options.taskRef,
      outcome: cancelled ? "cancelled" : "failure",
      success: false,
      executorAttempts: cancelled ? 0 : 1,
      modelCalls: null,
      commandExecutions: 0,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageKnown: false,
      toolCalls: 0,
      latencyMs: Math.max(0, now() - started),
      error: message,
      responseFingerprint: null,
    };
  }
}

export function validateM3RunRecord(record: M3RunRecord): readonly string[] {
  const errors: string[] = [];
  if (!getM3Variant(record.variantRef)) errors.push("unknown variant");
  if (
    record.executorAttempts < 0 ||
    (record.modelCalls !== null && record.modelCalls < 0) ||
    record.commandExecutions < 0 ||
    record.toolCalls < 0
  )
    errors.push("negative call count");
  if (record.latencyMs < 0) errors.push("negative latency");
  if (
    record.usageKnown !==
    (record.inputTokens !== null &&
      record.cachedInputTokens !== null &&
      record.outputTokens !== null &&
      record.totalTokens !== null)
  )
    errors.push("usage state mismatch");
  if (record.success)
    errors.push("provider completion cannot establish task success");
  if (record.outcome === "unevaluated" && record.responseFingerprint === null)
    errors.push("completed response missing fingerprint");
  return errors;
}

export function m3BudgetWithinLimit(record: M3RunRecord): boolean {
  return (
    record.modelCalls !== null &&
    record.modelCalls <= m3ExperimentManifest.budget.maxModelCalls &&
    record.toolCalls <= m3ExperimentManifest.budget.maxToolCalls &&
    record.latencyMs <= m3ExperimentManifest.budget.maxWallTimeMs
  );
}
