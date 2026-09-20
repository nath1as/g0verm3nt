import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPersistedNormalizationDomainEvidence,
  evaluateNormalization,
  executeNormalizationCapability,
  normalizationFiniteDomain,
  normalizationRefs,
  validateNormalizationEvidence,
} from "../src/fixtures/normalization.ts";
import { executePersistedNormalization } from "../src/runtime/normalization-execution.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const time = "2026-09-20T00:00:00.000Z";

describe("P1 persisted normalization execution", () => {
  test("admission evidence rejects an incomplete or reordered finite domain", () => {
    const candidateRef = normalizationRefs.revised;
    const evidence = createPersistedNormalizationDomainEvidence(
      "fixture-domain",
      normalizationFiniteDomain.map((records, index) => ({
        executionId: `fixture-execution-${index}`,
        candidateRef,
        result: evaluateNormalization(`fixture-batch-${index}`, records),
        calls: [
          records.length <= 1
            ? normalizationRefs.fastCapability
            : normalizationRefs.slowCapability,
        ],
      })),
      time,
    );
    validateNormalizationEvidence(evidence.payload, candidateRef);
    const payload = evidence.payload as Record<string, unknown>;
    const cases = payload.cases as readonly unknown[];
    expect(() =>
      validateNormalizationEvidence(
        { ...payload, cases: cases.slice(1) },
        candidateRef,
      ),
    ).toThrow("invalid normalization domain evidence");
    expect(() =>
      validateNormalizationEvidence(
        { ...payload, cases: [cases[1], cases[0], ...cases.slice(2)] },
        candidateRef,
      ),
    ).toThrow("invalid normalization domain evidence");
  });

  test("fast capability rejects inputs outside the graph's declared route domain", () => {
    expect(() =>
      executeNormalizationCapability(
        normalizationRefs.fastCapability,
        "outside-fast-domain",
        [
          { id: "a", value: "a" },
          { id: "b", value: "b" },
        ],
      ),
    ).toThrow("fast normalization capability is ineligible");
  });

  test("runs each candidate through its owned outbox and pins the terminal result", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "government-normalization-runtime-"),
    );
    try {
      const store = await SqliteRunStore.open(directory);
      try {
        store.createRunWithOperationAllocation(run("governor", time), 2);
        for (const [childRunId, candidateRef, records] of [
          [
            "baseline-child",
            normalizationRefs.baseline,
            [{ id: "b", value: "b" }],
          ],
          [
            "revised-child",
            normalizationRefs.revised,
            [
              { id: "b", value: "b" },
              { id: "a", value: "a" },
            ],
          ],
        ] as const) {
          store.createOwnedChildRunWithOperationAllocation(
            "governor",
            run(childRunId, time),
            1,
          );
          const dispatched: string[] = [];
          const execution = executePersistedNormalization({
            store,
            executionId: `${childRunId}-execution`,
            childRunId,
            candidateRef,
            batchId: "batch",
            records,
            occurredAt: time,
            dispatch: (capability, batchId, input) => {
              dispatched.push(capability);
              return executeNormalizationCapability(capability, batchId, input);
            },
          });
          expect(execution.calls).toEqual(
            candidateRef === normalizationRefs.baseline
              ? [normalizationRefs.slowCapability]
              : [normalizationRefs.slowCapability],
          );
          expect(dispatched).toEqual([...execution.calls]);
          expect(execution.result.records.map((record) => record.id)).toEqual(
            [...records.map((record) => record.id)].sort(),
          );
          expect(
            store.getGraphExecution(execution.executionId)?.frame.state,
          ).toEqual({ kind: "succeeded", output: execution.result });
          expect(store.listPendingGraphOutbox()).toEqual([]);
          expect(store.getRunUsageTotals(childRunId)).toEqual({
            runId: childRunId,
            knownUnits: 0,
            unknownOperations: 0,
          });
        }
      } finally {
        await store.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("independently verifies every persisted baseline and revised result", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "government-normalization-domain-"),
    );
    try {
      const store = await SqliteRunStore.open(directory);
      try {
        store.createRunWithOperationAllocation(run("governor", time), 10);
        for (const [name, candidateRef] of [
          ["baseline", normalizationRefs.baseline],
          ["revised", normalizationRefs.revised],
        ] as const) {
          const childRunId = `${name}-child`;
          store.createOwnedChildRunWithOperationAllocation(
            "governor",
            run(childRunId, time),
            normalizationFiniteDomain.length,
          );
          for (const [index, records] of normalizationFiniteDomain.entries()) {
            const execution = executePersistedNormalization({
              store,
              executionId: `${name}-domain-${index}`,
              ...(index === 0 ? { childRunId } : {}),
              candidateRef,
              batchId: `domain-${index}`,
              records,
              occurredAt: time,
            });
            expect(execution.result.records).toEqual(
              independentCanonical(records),
            );
            expect(execution.calls).toEqual([
              candidateRef === normalizationRefs.baseline ||
              records.length === 2
                ? normalizationRefs.slowCapability
                : normalizationRefs.fastCapability,
            ]);
          }
        }
      } finally {
        await store.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function independentCanonical(
  records: readonly Readonly<{ id: string; value: string }>[],
) {
  return records
    .map((record) => ({ ...record }))
    .sort((left, right) =>
      left.value === right.value
        ? left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0
        : left.value < right.value
          ? -1
          : 1,
    );
}

function run(id: string, createdAt: string) {
  return {
    id,
    taskType: "normalization",
    status: "running" as const,
    createdAt,
    completedAt: null,
    outcome: null,
  };
}
