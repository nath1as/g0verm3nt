/** Provider-neutral M3 model boundary. Provider-native messages stay in adapters. */
export type ModelUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  known: boolean;
}>;

/** Counts observed at the provider boundary, not unobservable internal work. */
export type ModelExecutionAccounting = Readonly<{
  executorAttempts: number;
  modelCalls: number | null;
  commandExecutions: number;
  toolCalls: number;
}>;

/** Bounded provider output retained until durable artifact storage owns it. */
export type ModelRawArtifact = Readonly<{
  format: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}>;

export type ModelToolCall = Readonly<{
  id: string;
  name: string;
  argumentsJson: string;
}>;

export type TypedModelRequest = Readonly<{
  requestId: string;
  runId: string;
  modelRef: string;
  prompt: string;
  tools?: readonly Readonly<{ name: string; description: string }>[];
}>;

export type TypedModelResponse = Readonly<{
  requestId: string;
  modelRef: string;
  text: string;
  toolCalls: readonly ModelToolCall[];
  usage: ModelUsage;
  accounting: ModelExecutionAccounting;
  rawArtifact?: ModelRawArtifact;
  finish: "stop" | "tool-call";
}>;

export interface TypedModelGateway {
  complete(
    request: TypedModelRequest,
    signal: AbortSignal,
  ): Promise<TypedModelResponse>;
}
