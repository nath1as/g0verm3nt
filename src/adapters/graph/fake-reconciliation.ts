import type { AbstractionRef, JsonValue } from "../../core/graph.ts";
import type { OperationId } from "../../core/graph-frame.ts";
import type {
  OperationReconciliationAdapter,
  ReconciliationRequest,
  ReconciliationResult,
} from "../../runtime/graph-reconciliation.ts";

export type FakeReconciliationRecord = Readonly<{
  operationId: OperationId;
  externalOperationId: string;
  evidence: JsonValue;
  outcome:
    | Readonly<{ kind: "succeeded"; output: JsonValue }>
    | Readonly<{ kind: "failed"; failure: string }>;
}>;

/**
 * Deterministic provider fixture for reconciliation tests. Its public surface
 * is a lookup only: it has no dispatch or retry operation.
 */
export class FakeOperationReconciliationAdapter
  implements OperationReconciliationAdapter
{
  readonly #records: ReadonlyMap<OperationId, FakeReconciliationRecord>;
  readonly #requests: ReconciliationRequest[] = [];

  constructor(
    readonly abstraction: AbstractionRef,
    private readonly adapterRef: string,
    records: readonly FakeReconciliationRecord[],
  ) {
    const entries = new Map<OperationId, FakeReconciliationRecord>();
    for (const record of records) {
      if (entries.has(record.operationId))
        throw new Error(
          `duplicate fake reconciliation record: ${record.operationId}`,
        );
      entries.set(record.operationId, record);
    }
    this.#records = entries;
  }

  get requests(): readonly ReconciliationRequest[] {
    return this.#requests;
  }

  async reconcile(
    request: ReconciliationRequest,
  ): Promise<ReconciliationResult> {
    this.#requests.push(request);
    const record = this.#records.get(request.operationId);
    if (record === undefined) return { kind: "unknown" };
    const observation =
      record.outcome.kind === "succeeded"
        ? {
            kind: "succeeded" as const,
            operationId: request.operationId,
            output: record.outcome.output,
          }
        : {
            kind: "failed" as const,
            operationId: request.operationId,
            failure: record.outcome.failure,
          };
    return {
      kind: "observed",
      observation,
      attribution: {
        adapterRef: this.adapterRef,
        externalOperationId: record.externalOperationId,
        evidence: record.evidence,
      },
    };
  }
}
