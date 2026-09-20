import type {
  TypedModelGateway,
  TypedModelRequest,
  TypedModelResponse,
} from "./typed.ts";

/** Deterministic offline provider used to exercise the M3 boundary. */
export class FakeTypedModelGateway implements TypedModelGateway {
  constructor(private readonly responseText = "fake completion") {}

  async complete(
    request: TypedModelRequest,
    signal: AbortSignal,
  ): Promise<TypedModelResponse> {
    if (signal.aborted) throw signal.reason;
    const text = `${this.responseText}: ${request.prompt}`;
    return {
      requestId: request.requestId,
      modelRef: request.modelRef,
      text,
      toolCalls: [],
      usage: {
        inputTokens: request.prompt.length,
        cachedInputTokens: 0,
        outputTokens: text.length,
        totalTokens: request.prompt.length + text.length,
        known: true,
      },
      accounting: {
        executorAttempts: 1,
        modelCalls: 1,
        commandExecutions: 0,
        toolCalls: 0,
      },
      finish: "stop",
    };
  }
}
