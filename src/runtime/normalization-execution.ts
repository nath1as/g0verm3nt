import type { AbstractionRef, JsonValue } from "../core/graph.ts";
import {
  advanceGraphFrame,
  isOperationId,
  observeGraphOperation,
  parseOperationId,
  startGraphFrame,
} from "../core/graph-frame.ts";
import {
  executeNormalizationCapability,
  type NormalizationRecord,
  type NormalizationResult,
  normalizationBaseline,
  normalizationRefs,
  normalizationRevised,
} from "../fixtures/normalization.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";

export type PersistedNormalizationExecution = Readonly<{
  executionId: string;
  candidateRef: string;
  result: NormalizationResult;
  calls: readonly string[];
}>;

export type NormalizationCapabilityDispatcher = (
  capability: AbstractionRef,
  batchId: string,
  records: readonly NormalizationRecord[],
) => NormalizationResult;

/**
 * Executes one finite-domain candidate through the durable frame/outbox path.
 * The child must own both the run and its bounded operation allocation.
 */
export function executePersistedNormalization(input: {
  store: SqliteRunStore;
  executionId: string;
  childRunId?: string;
  candidateRef: string;
  headKey?: string;
  batchId: string;
  records: readonly NormalizationRecord[];
  occurredAt: string;
  dispatch?: NormalizationCapabilityDispatcher;
}): PersistedNormalizationExecution {
  if (input.headKey !== undefined) {
    const head = input.store.requireActiveGraphHead(input.headKey);
    if (head.graphRef !== input.candidateRef)
      throw new Error("normalization candidate does not match the active head");
  }
  const definition = definitionFor(input.candidateRef);
  const operationId = parseOperationId(`${input.executionId}-normalization-1`);
  if (!isOperationId(operationId))
    throw new Error("normalization execution ID cannot form an operation ID");
  let frame = startGraphFrame(
    definition.ref,
    definition.checked,
    graphInput(input),
  );
  let revision: number | null = null;
  const calls: string[] = [];

  for (let steps = 0; steps < 4; steps += 1) {
    const step = advanceGraphFrame(frame, operationId);
    if (step.kind === "advanced") {
      frame = step.frame;
      if (revision !== null) {
        input.store.persistGraphFrame({
          executionId: input.executionId,
          definition,
          frame,
          expectedRevision: revision,
          occurredAt: input.occurredAt,
        });
        revision += 1;
      }
      continue;
    }
    if (step.kind === "operationPlanned") {
      if (revision === null && input.childRunId !== undefined) {
        input.store.persistRunGraphOperationIntent({
          runId: input.childRunId,
          executionId: input.executionId,
          definition,
          frame: step.frame,
          expectedRevision: null,
          operation: step.operation,
          occurredAt: input.occurredAt,
        });
        revision = 0;
      } else if (revision === null) {
        input.store.persistGraphOperationIntent({
          executionId: input.executionId,
          definition,
          frame: step.frame,
          expectedRevision: null,
          operation: step.operation,
          occurredAt: input.occurredAt,
        });
        revision = 0;
      } else {
        input.store.persistGraphOperationIntent({
          executionId: input.executionId,
          definition,
          frame: step.frame,
          expectedRevision: revision,
          operation: step.operation,
          occurredAt: input.occurredAt,
        });
        revision += 1;
      }
      calls.push(step.operation.abstraction);
      input.store.markGraphOperationDispatched(
        input.executionId,
        operationId,
        input.occurredAt,
      );
      const result = (input.dispatch ?? executeNormalizationCapability)(
        step.operation.abstraction,
        input.batchId,
        input.records,
      );
      const observed = observeGraphOperation(step.frame, {
        kind: "succeeded",
        operationId,
        output: result as JsonValue,
      });
      if (observed.kind === "rejected")
        throw new Error("normalization observation cannot advance its frame");
      input.store.persistGraphOperationObservation({
        executionId: input.executionId,
        operationId,
        observation: { kind: "succeeded", operationId, output: result },
        frame: observed.frame,
        expectedRevision: revision,
        occurredAt: input.occurredAt,
      });
      revision += 1;
      frame = observed.frame;
      if (frame.state.kind === "succeeded")
        return {
          executionId: input.executionId,
          candidateRef: definition.ref,
          result,
          calls,
        };
      continue;
    }
    if (step.kind === "terminal") {
      if (frame.state.kind !== "succeeded")
        throw new Error("normalization candidate did not produce an output");
      return {
        executionId: input.executionId,
        candidateRef: definition.ref,
        result: frame.state.output as NormalizationResult,
        calls,
      };
    }
    throw new Error(`normalization graph frame rejected: ${step.reason.kind}`);
  }
  throw new Error(
    "normalization graph did not terminate within its operation bound",
  );
}

function definitionFor(candidateRef: string) {
  if (candidateRef === normalizationRefs.baseline) return normalizationBaseline;
  if (candidateRef === normalizationRefs.revised) return normalizationRevised;
  throw new Error("unknown normalization candidate");
}

function graphInput(input: {
  batchId: string;
  records: readonly NormalizationRecord[];
}): JsonValue {
  return {
    batch_id: input.batchId,
    records: input.records.map((record) => ({ ...record })),
    record_count: input.records.length,
  };
}
