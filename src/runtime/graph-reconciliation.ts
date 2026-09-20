import type { AbstractionRef, JsonValue } from "../core/graph.ts";
import {
  type OperationId,
  type OperationObservation,
  observeGraphOperation,
  type RetryAttempt,
} from "../core/graph-frame.ts";
import type {
  GraphOperationReconciliationAttribution,
  SqliteRunStore,
} from "../storage/sqlite.ts";

export type ReconciliationRequest = Readonly<{
  executionId: string;
  operationId: OperationId;
  abstraction: AbstractionRef;
  input: JsonValue;
  attempt: RetryAttempt | null;
}>;

export type ReconciliationResult =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{
      kind: "observed";
      observation: OperationObservation;
      attribution: GraphOperationReconciliationAttribution;
    }>;

export interface OperationReconciliationAdapter {
  readonly abstraction: AbstractionRef;
  reconcile(request: ReconciliationRequest): Promise<ReconciliationResult>;
}

/**
 * Performs an explicit, read-only adapter lookup for one indeterminate call.
 * It never dispatches or replays the call. Unknown results leave durable state
 * unchanged; an attributable observation settles the call exactly once.
 */
export async function reconcileIndeterminateGraphOperation(
  store: SqliteRunStore,
  executionId: string,
  adapter: OperationReconciliationAdapter,
  occurredAt: string,
): Promise<ReconciliationResult> {
  const execution = store.getGraphExecution(executionId);
  if (execution === null)
    throw new Error(`graph execution ${executionId} does not exist`);
  if (execution.frame.state.kind !== "awaitingCall")
    throw new Error(
      `graph execution ${executionId} is not awaiting an operation`,
    );
  const awaiting = execution.frame.state;
  if (adapter.abstraction !== awaiting.abstraction)
    throw new Error("reconciliation adapter does not match the operation");
  if (
    store.graphOperationLifecycle(executionId, awaiting.operationId) !==
    "indeterminate"
  )
    throw new Error(
      `graph operation ${awaiting.operationId} is not indeterminate`,
    );

  const result = await adapter.reconcile({
    executionId,
    operationId: awaiting.operationId,
    abstraction: awaiting.abstraction,
    input: awaiting.input,
    attempt: awaiting.attempt,
  });
  if (result.kind === "unknown") return result;
  if (result.observation.operationId !== awaiting.operationId)
    throw new Error("reconciliation observation does not match the operation");

  const step = observeGraphOperation(execution.frame, result.observation);
  if (step.kind === "rejected")
    throw new Error("reconciliation observation cannot advance the frame");
  store.persistReconciledGraphOperationObservation({
    executionId,
    operationId: awaiting.operationId,
    observation: result.observation,
    frame: step.frame,
    expectedRevision: execution.revision,
    occurredAt,
    attribution: result.attribution,
  });
  return result;
}
