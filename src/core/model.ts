export type RunStatus = "running" | "succeeded" | "cancelled" | "failed";

export type Run = Readonly<{
  id: string;
  taskType: string;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  outcome: string | null;
}>;

export type EventKind =
  | "RunRequested"
  | "RunChildSpawned"
  | "RunChildOutcomeObserved"
  | "RunChildOutcomePropagated"
  | "RunOperationAllocationCreated"
  | "RunnableOperationPermitAcquired"
  | "RunnableOperationPermitReleased"
  | "GraphExecutionAttached"
  | "OperationReserved"
  | "OperationUsageRecorded"
  | "OperationPlanned"
  | "OperationObserved"
  | "ProviderAttemptPlanned"
  | "ProviderAttemptDispatched"
  | "ProviderAttemptCompleted"
  | "ProviderAttemptIndeterminate"
  | "SemanticDecisionPlanned"
  | "SemanticObservationRecorded"
  | "SemanticActionSelected"
  | "M3TaskEvaluationRecorded"
  | "RunCompleted"
  | "RunCancelled"
  | "RunFailed";

export type RunEvent = Readonly<{
  sequence: number;
  runId: string;
  kind: EventKind;
  occurredAt: string;
  payload: Readonly<Record<string, string>>;
}>;

export type RunDetail = Readonly<{
  run: Run;
  events: readonly RunEvent[];
}>;

export type RunOutcome =
  | Readonly<{ kind: "succeeded"; text: string }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; text: string }>;

export interface ModelGateway {
  stream(
    input: Readonly<{ runId: string; taskType: string }>,
    signal: AbortSignal,
  ): AsyncIterable<string>;
}
