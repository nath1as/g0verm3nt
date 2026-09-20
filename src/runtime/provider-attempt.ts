import type {
  TypedModelGateway,
  TypedModelRequest,
  TypedModelResponse,
} from "../adapters/models/typed.ts";
import { hashCanonicalJson } from "../codecs/canonical.ts";
import type { JsonValue } from "../core/graph.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";

export type DurableProviderAttempt = Readonly<{
  attemptId: string;
  runId: string;
  executorRef: string;
  configurationFingerprint: string;
  request: TypedModelRequest;
  occurredAt: () => string;
}>;

function responseArtifact(response: TypedModelResponse): JsonValue {
  return {
    requestId: response.requestId,
    modelRef: response.modelRef,
    text: response.text,
    toolCalls: response.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      argumentsJson: call.argumentsJson,
    })),
    usage: {
      inputTokens: response.usage.inputTokens,
      cachedInputTokens: response.usage.cachedInputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      known: response.usage.known,
    },
    accounting: {
      executorAttempts: response.accounting.executorAttempts,
      modelCalls: response.accounting.modelCalls,
      commandExecutions: response.accounting.commandExecutions,
      toolCalls: response.accounting.toolCalls,
    },
    rawArtifact:
      response.rawArtifact === undefined
        ? null
        : {
            format: response.rawArtifact.format,
            stdout: response.rawArtifact.stdout,
            stderr: response.rawArtifact.stderr,
            truncated: response.rawArtifact.truncated,
          },
    finish: response.finish,
  };
}

function requestFingerprint(request: TypedModelRequest): string {
  return hashCanonicalJson({
    requestId: request.requestId,
    runId: request.runId,
    modelRef: request.modelRef,
    prompt: request.prompt,
    tools:
      request.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })) ?? [],
  });
}

/**
 * Persists intent before the provider boundary. A thrown completion is not
 * replayed: the dispatched record becomes indeterminate until new evidence
 * resolves it.
 */
export async function executeDurableProviderAttempt(
  store: SqliteRunStore,
  gateway: TypedModelGateway,
  input: DurableProviderAttempt,
  signal: AbortSignal,
): Promise<TypedModelResponse> {
  if (input.request.runId !== input.runId)
    throw new Error("provider attempt request does not belong to its run");
  store.createProviderAttempt({
    attemptId: input.attemptId,
    runId: input.runId,
    executorRef: input.executorRef,
    requestId: input.request.requestId,
    modelRef: input.request.modelRef,
    requestFingerprint: requestFingerprint(input.request),
    configurationFingerprint: input.configurationFingerprint,
    createdAt: input.occurredAt(),
  });
  store.markProviderAttemptDispatched(input.attemptId, input.occurredAt());
  try {
    const response = await gateway.complete(input.request, signal);
    if (response.requestId !== input.request.requestId)
      throw new Error("provider response does not match the planned request");
    store.completeProviderAttempt(
      input.attemptId,
      responseArtifact(response),
      input.occurredAt(),
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.markProviderAttemptIndeterminate(
      input.attemptId,
      message,
      input.occurredAt(),
    );
    throw error;
  }
}
