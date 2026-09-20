import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeOperationReconciliationAdapter } from "../src/adapters/graph/fake-reconciliation.ts";
import { canonicalJson, hashCanonicalJson } from "../src/codecs/canonical.ts";
import {
  type Contract,
  isVerifierRef,
  parseVerifierRef,
} from "../src/core/contracts.ts";
import {
  type AbstractionRef,
  type CallableAbstraction,
  type EffectBound,
  type GraphCatalogue,
  isAbstractionRef,
  isSchemaRef,
  type JsonValue,
  parseAbstractionRef,
  parseSchemaRef,
  type SchemaRef,
} from "../src/core/graph.ts";
import {
  createCatalogueManifest,
  defineGraph,
  isCatalogueManifestRef,
  parseCatalogueManifestRef,
} from "../src/core/graph-definition.ts";
import {
  advanceGraphFrame,
  isAttemptId,
  isGraphRef,
  isOperationId,
  observeGraphOperation,
  parseAttemptId,
  parseGraphRef,
  parseOperationId,
  startGraphFrame,
} from "../src/core/graph-frame.ts";
import {
  createNormalizationEvidence,
  createPersistedNormalizationDomainEvidence,
  createPersistedNormalizationEvidence,
  evaluateNormalization,
  normalizationBaseline,
  normalizationFiniteDomain,
  normalizationRefs,
  normalizationRevised,
} from "../src/fixtures/normalization.ts";
import { reconcileIndeterminateGraphOperation } from "../src/runtime/graph-reconciliation.ts";
import { executePersistedNormalization } from "../src/runtime/normalization-execution.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const number = requiredSchema("example/number@1");
const increment = requiredAbstraction("example/increment@1");
const flaky = requiredAbstraction("example/flaky@1");
const verifier = requiredVerifier("example/storage-verifier@1");

describe("M2 atomic graph execution persistence", () => {
  test("cannot issue a receipt against previously suspended support", async () => {
    const directory = mkdtempSync(join(tmpdir(), "government-revoked-"));
    const store = await SqliteRunStore.open(directory);
    try {
      const definition = fixtureDefinition();
      const time = "2026-09-20T00:00:00.000Z";
      store.registerGraphDefinition(definition);
      store.createGraphHead("test", definition.ref, time);
      store.setGraphDependencyStatus(
        "support",
        "suspended",
        "revoked",
        "v2",
        time,
      );
      store.createGraphProposal({
        proposalId: "late",
        headKey: "test",
        baseGraphRef: definition.ref,
        candidateGraphRef: definition.ref,
        baseVersion: 0,
        createdAt: time,
        dependencies: [
          { dependencyKind: "evidence", dependencyRef: "support" },
        ],
      });
      expect(() =>
        store.createGraphProposalReceipt({
          receiptId: "receipt",
          proposalId: "late",
          checkedFingerprint: "unchecked",
          checkedAt: time,
        }),
      ).toThrow("proposal dependency is not active");
      expect(store.getGraphHead("test")?.version).toBe(0);
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test("canonical JSON has stable key order and content hashes", () => {
    const left = { b: [2, { z: true, a: null }], a: "value" } as const;
    const right = { a: "value", b: [2, { a: null, z: true }] } as const;
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right));
  });

  test("commits graph heads with an expected version across restart", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-head-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.persistGraphFrame({
        executionId: "head-definition",
        definition,
        frame: startGraphFrame(definition.ref, definition.checked, 1),
        expectedRevision: null,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      store.createGraphHead(
        "normalization",
        definition.ref,
        "2026-09-19T00:00:01.000Z",
      );
      expect(store.getGraphHead("normalization")).toEqual({
        headKey: "normalization",
        graphRef: definition.ref,
        version: 0,
        updatedAt: "2026-09-19T00:00:01.000Z",
      });
      store.commitGraphHead(
        "normalization",
        0,
        definition.ref,
        "2026-09-19T00:00:02.000Z",
      );
      expect(() =>
        store.commitGraphHead(
          "normalization",
          0,
          definition.ref,
          "2026-09-19T00:00:03.000Z",
        ),
      ).toThrow("does not have expected version 0");
      expect(store.getGraphHead("normalization")?.version).toBe(1);
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getGraphHead("normalization")).toEqual({
        headKey: "normalization",
        graphRef: definition.ref,
        version: 1,
        updatedAt: "2026-09-19T00:00:02.000Z",
      });
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("commits one checked proposal and leaves a competing proposal stale", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-proposal-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.persistGraphFrame({
        executionId: "proposal-definition",
        definition,
        frame: startGraphFrame(definition.ref, definition.checked, 1),
        expectedRevision: null,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      store.createGraphHead(
        "normalization",
        definition.ref,
        "2026-09-19T00:00:01.000Z",
      );
      for (const proposalId of ["proposal-a", "proposal-b"]) {
        store.createGraphProposal({
          proposalId,
          headKey: "normalization",
          baseGraphRef: definition.ref,
          candidateGraphRef: definition.ref,
          baseVersion: 0,
          ...(proposalId === "proposal-a" || proposalId === "proposal-b"
            ? {
                dependencies: [
                  {
                    dependencyKind: "manifest",
                    dependencyRef: "dependency/example@1",
                  },
                ],
              }
            : {}),
          createdAt: "2026-09-19T00:00:02.000Z",
        });
        store.createGraphProposalReceipt({
          receiptId: `receipt-${proposalId}`,
          proposalId,
          checkedFingerprint: "fingerprint-v0",
          checkedAt: "2026-09-19T00:00:03.000Z",
        });
      }
      expect(store.listGraphProposalDependencies("proposal-a")).toEqual([
        {
          proposalId: "proposal-a",
          dependencyKind: "manifest",
          dependencyRef: "dependency/example@1",
        },
      ]);
      expect(
        store.listGraphProposalsDependingOn("dependency/example@1"),
      ).toHaveLength(2);
      store.commitGraphProposal(
        "proposal-a",
        "receipt-proposal-a",
        "2026-09-19T00:00:04.000Z",
      );
      store.setGraphDependencyStatus(
        "dependency/example@1",
        "suspended",
        "support revoked",
        "status-v2",
        "2026-09-19T00:00:05.000Z",
      );
      expect(
        store.getGraphDependencyStatus("dependency/example@1")?.status,
      ).toBe("suspended");
      expect(() =>
        store.commitGraphProposal(
          "proposal-b",
          "receipt-proposal-b",
          "2026-09-19T00:00:06.000Z",
        ),
      ).toThrow("proposal receipt is invalid");
      expect(store.getGraphHead("normalization")?.version).toBe(1);
      expect(store.getGraphProposal("proposal-a")?.status).toBe("committed");
      expect(store.getGraphProposal("proposal-b")?.status).toBe("suspended");
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getGraphHead("normalization")?.version).toBe(1);
      expect(reopened.getGraphProposal("proposal-b")?.status).toBe("suspended");
      expect(
        reopened.getGraphDependencyStatus("dependency/example@1")?.status,
      ).toBe("suspended");
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("registers the normalization fixture definitions across restart", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-normalization-"),
    );
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.registerGraphDefinition(normalizationBaseline);
      store.registerGraphDefinition(normalizationRevised);
      expect(store.hasGraphDefinition(normalizationBaseline.ref)).toBe(true);
      expect(store.hasGraphDefinition(normalizationRevised.ref)).toBe(true);
      await store.close();
      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.hasGraphDefinition(normalizationBaseline.ref)).toBe(true);
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("commits a typed normalization revision proposal", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-normalization-proposal-"),
    );
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.registerGraphDefinition(normalizationBaseline);
      store.registerGraphDefinition(normalizationRevised);
      store.createGraphHead(
        "normalization",
        normalizationBaseline.ref,
        "2026-09-19T00:03:00.000Z",
      );
      store.createRunWithOperationAllocation(
        runningRun("governor", "2026-09-19T00:02:00.000Z"),
        normalizationFiniteDomain.length,
      );
      store.createOwnedChildRunWithOperationAllocation(
        "governor",
        runningRun("child", "2026-09-19T00:02:30.000Z"),
        normalizationFiniteDomain.length,
      );
      const source = [{ id: "input-1", value: "a" }];
      const executions = normalizationFiniteDomain.map((records, index) =>
        executePersistedNormalization({
          store,
          executionId: `child-normalization-execution-${index}`,
          childRunId: "child",
          candidateRef: normalizationRevised.ref,
          batchId: `batch-${index}`,
          records,
          occurredAt: "2026-09-19T00:02:40.000Z",
        }),
      );
      store.completeRun(
        "child",
        "succeeded",
        "normalization evidence produced",
        "2026-09-19T00:02:45.000Z",
      );
      const validEvidence = createNormalizationEvidence(
        "rejected",
        evaluateNormalization("batch", source),
        "2026-09-19T00:03:00.500Z",
        source,
        normalizationRevised.ref,
      );
      expect(() =>
        store.createGraphEvidence({
          ...validEvidence,
          fingerprint: "fabricated",
        }),
      ).toThrow("evidence fingerprint mismatch");
      const fakePayload = { complete: true, audit: ["input-1"] };
      expect(() =>
        store.createGraphEvidence({
          ...validEvidence,
          payload: fakePayload,
          fingerprint: hashCanonicalJson(fakePayload),
        }),
      ).toThrow("invalid normalization evidence");
      expect(store.getGraphEvidence("rejected")).toBeNull();
      expect(() =>
        createNormalizationEvidence(
          "omitted",
          evaluateNormalization("batch", []),
          validEvidence.admittedAt,
          source,
          normalizationRevised.ref,
        ),
      ).toThrow("invalid normalization evidence");
      expect(() =>
        createNormalizationEvidence(
          "changed",
          evaluateNormalization("batch", [{ id: "input-1", value: "changed" }]),
          validEvidence.admittedAt,
          source,
          normalizationRevised.ref,
        ),
      ).toThrow("invalid normalization evidence");
      store.createGraphEvidence(
        createNormalizationEvidence(
          "wrong-candidate",
          evaluateNormalization("batch", source),
          validEvidence.admittedAt,
          source,
          normalizationBaseline.ref,
        ),
      );
      store.createGraphProposal({
        proposalId: "wrong-evidence",
        headKey: "normalization",
        baseGraphRef: normalizationBaseline.ref,
        candidateGraphRef: normalizationRevised.ref,
        baseVersion: 0,
        originRunId: "child",
        evidenceIds: ["wrong-candidate"],
        createdAt: validEvidence.admittedAt,
      });
      expect(() =>
        store.admitNormalizationProposal({
          receiptId: "wrong-receipt",
          proposalId: "wrong-evidence",
          governorRunId: "governor",
          policyRef: "normalization/policy@1",
          checkedAt: validEvidence.admittedAt,
        }),
      ).toThrow("normalization evidence binding mismatch");
      expect(store.getGraphHead("normalization")?.version).toBe(0);
      store.createGraphEvidence(
        createPersistedNormalizationEvidence(
          "missing-execution",
          {
            executionId: "invented-execution",
            candidateRef: normalizationRevised.ref,
            result: evaluateNormalization("batch", source),
            calls: [normalizationRefs.fastCapability],
          },
          validEvidence.admittedAt,
          source,
        ),
      );
      store.createGraphProposal({
        proposalId: "missing-execution-proposal",
        headKey: "normalization",
        baseGraphRef: normalizationBaseline.ref,
        candidateGraphRef: normalizationRevised.ref,
        baseVersion: 0,
        originRunId: "child",
        evidenceIds: ["missing-execution"],
        createdAt: validEvidence.admittedAt,
      });
      expect(() =>
        store.admitNormalizationProposal({
          receiptId: "missing-execution-receipt",
          proposalId: "missing-execution-proposal",
          governorRunId: "governor",
          policyRef: "normalization/policy@1",
          checkedAt: validEvidence.admittedAt,
        }),
      ).toThrow("normalization evidence requires a persisted domain");
      store.createGraphEvidence(
        createPersistedNormalizationDomainEvidence(
          "normalization-evidence",
          executions,
          "2026-09-19T00:03:00.500Z",
        ),
      );
      store.createGraphProposal({
        proposalId: "normalization-revision",
        headKey: "normalization",
        baseGraphRef: normalizationBaseline.ref,
        candidateGraphRef: normalizationRevised.ref,
        baseVersion: 0,
        originRunId: "child",
        evidenceIds: ["normalization-evidence"],
        dependencies: [
          {
            dependencyKind: "manifest",
            dependencyRef: normalizationBaseline.manifest.ref,
          },
        ],
        createdAt: "2026-09-19T00:03:01.000Z",
      });
      const receipt = store.admitNormalizationProposal({
        receiptId: "normalization-receipt",
        proposalId: "normalization-revision",
        governorRunId: "governor",
        policyRef: "normalization/policy@1",
        checkedAt: "2026-09-19T00:03:02.000Z",
      });
      expect(receipt.admittedOriginRunId).toBe("child");
      expect(receipt.admittedGovernorRunId).toBe("governor");
      store.commitGraphProposal(
        "normalization-revision",
        "normalization-receipt",
        "2026-09-19T00:03:03.000Z",
      );
      expect(store.getGraphHead("normalization")?.graphRef).toBe(
        normalizationRevised.ref,
      );
      expect(
        store.getCompositionRelation(
          "normalization-relation/normalization-revision",
        ),
      ).toMatchObject({
        relationKind: "normalization-revision",
        leftRef: `graph:${normalizationBaseline.ref}`,
        rightRef: `graph:${normalizationRevised.ref}`,
        status: "active",
        scope: {
          proposalId: "normalization-revision",
          receiptId: "normalization-receipt",
          evidenceIds: ["normalization-evidence"],
          policyRef: "normalization/policy@1",
        },
      });
      store.createGraphProposal({
        proposalId: "unowned-child",
        headKey: "normalization",
        baseGraphRef: normalizationRevised.ref,
        candidateGraphRef: normalizationBaseline.ref,
        baseVersion: 1,
        originRunId: "governor",
        evidenceIds: ["normalization-evidence"],
        createdAt: "2026-09-19T00:03:04.000Z",
      });
      expect(() =>
        store.admitNormalizationProposal({
          receiptId: "unowned-receipt",
          proposalId: "unowned-child",
          governorRunId: "governor",
          policyRef: "normalization/policy@1",
          checkedAt: "2026-09-19T00:03:05.000Z",
        }),
      ).toThrow("originating run is not owned by the governor");
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("pins baseline and revised normalization executions independently", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-normalization-execution-"),
    );
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      for (const [executionId, definition] of [
        ["normalization-baseline-run", normalizationBaseline],
        ["normalization-revised-run", normalizationRevised],
      ] as const) {
        store.persistGraphFrame({
          executionId,
          definition,
          frame: startGraphFrame(definition.ref, definition.checked, {
            batchId: "fixture-1",
          }),
          expectedRevision: null,
          occurredAt: "2026-09-19T00:04:00.000Z",
        });
      }
      expect(
        store.getRunnableGraphDefinition("normalization-baseline-run")?.ref,
      ).toBe(normalizationBaseline.ref);
      expect(
        store.getRunnableGraphDefinition("normalization-revised-run")?.ref,
      ).toBe(normalizationRevised.ref);
      await store.close();
      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(
        reopened.getRunnableGraphDefinition("normalization-baseline-run")?.ref,
      ).toBe(normalizationBaseline.ref);
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("persists M3 cohort observations across restart", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-cohort-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.recordM3CohortObservation({
        observationId: "obs-1",
        taskRef: "m3/heldout/trim",
        split: "held-out",
        candidateRef: "m3/harness-default@1",
        outcome: "success",
        costUnits: 14646,
        recordedAt: "2026-09-20T00:00:00.000Z",
      });
      expect(store.listM3CohortObservations()).toHaveLength(1);
      await store.close();
      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.listM3CohortObservations()[0]?.taskRef).toBe(
        "m3/heldout/trim",
      );
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("persists authoritative composition relations across restart", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-relation-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createCompositionRelation({
        relationId: "relation-1",
        relationKind: "supports",
        leftRef: "abstraction:child@1",
        rightRef: "graph:normalization@1",
        scope: { taskType: "normalization" },
        createdAt: "2026-09-19T00:02:00.000Z",
      });
      expect(
        store.listCompositionRelations(
          "abstraction:child@1",
          "graph:normalization@1",
        ),
      ).toHaveLength(1);
      await store.close();
      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getCompositionRelation("relation-1")?.status).toBe(
        "active",
      );
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("pages the shared composition view within its UTF-8 budget", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-composition-view-"),
    );
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const relationIds = Array.from(
        { length: 12 },
        (_, index) =>
          `relation/${String(index).padStart(2, "0")}/${"x".repeat(1700)}`,
      );
      for (const relationId of relationIds) {
        store.createCompositionRelation({
          relationId,
          relationKind: "supports",
          leftRef: "abstraction:child@1",
          rightRef: "graph:normalization@1",
          scope: {},
          createdAt: "2026-09-20T00:00:00.000Z",
        });
      }
      const first = store.getSharedCompositionView();
      expect(
        Buffer.byteLength(
          canonicalJson({
            cursor: first.cursor,
            items: first.items.map((item) => ({
              kind: item.kind,
              ref: item.ref,
              status: item.status,
            })),
            nextCursor: first.nextCursor,
            omitted: first.omitted,
            revision: first.revision,
          }),
          "utf8",
        ),
      ).toBeLessThanOrEqual(16 * 1024);
      expect(first.items.length).toBeLessThan(relationIds.length);
      expect(first.omitted).toBeGreaterThan(0);
      expect(first.nextCursor).not.toBeNull();

      const second = store.getSharedCompositionView(Number(first.nextCursor));
      expect(second.nextCursor).toBeNull();
      expect([...first.items, ...second.items].map((item) => item.ref)).toEqual(
        [...relationIds].sort(),
      );
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rejects an oversized shared composition summary", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-composition-view-oversized-"),
    );
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createCompositionRelation({
        relationId: `relation/oversized/${"x".repeat(17 * 1024)}`,
        relationKind: "supports",
        leftRef: "abstraction:child@1",
        rightRef: "graph:normalization@1",
        scope: {},
        createdAt: "2026-09-20T00:00:00.000Z",
      });
      expect(() => store.getSharedCompositionView()).toThrow(
        "shared composition item exceeds 16 KiB",
      );
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("persists a bounded composition checkpoint across restart", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-checkpoint-"),
    );
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      expect(store.schemaVersion()).toBe(29);
      store.saveCompositionCheckpoint({
        checkpointId: "root",
        rootRef: "head:normalization@1",
        cursor: "proposal-b",
        refs: ["head:normalization@1", "proposal-b", "dependency/example@1"],
        updatedAt: "2026-09-19T00:01:00.000Z",
      });
      expect(store.getCompositionCheckpoint("root")).toEqual({
        checkpointId: "root",
        rootRef: "head:normalization@1",
        cursor: "proposal-b",
        refs: ["head:normalization@1", "proposal-b", "dependency/example@1"],
        updatedAt: "2026-09-19T00:01:00.000Z",
      });
      expect(store.getCompositionCheckpointView("root", 1, 1)).toEqual({
        checkpointId: "root",
        refs: ["proposal-b"],
        omitted: 1,
        nextCursor: "2",
      });
      expect(store.getCompositionCheckpointView("root", 2, 1)?.nextCursor).toBe(
        null,
      );
      expect(() =>
        store.saveCompositionCheckpoint({
          checkpointId: "too-many",
          rootRef: "root",
          cursor: null,
          refs: Array.from({ length: 33 }, (_, index) => `ref-${index}`),
          updatedAt: "2026-09-19T00:01:01.000Z",
        }),
      ).toThrow("32 references");
      expect(() =>
        store.saveCompositionCheckpoint({
          checkpointId: "oversized-descriptor",
          rootRef: "head:normalization@1",
          cursor: null,
          refs: ["ref-".repeat(1024)],
          updatedAt: "2026-09-19T00:01:02.000Z",
        }),
      ).toThrow("root descriptor exceeds 4 KiB");
      await store.close();
      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getCompositionCheckpoint("root")?.cursor).toBe(
        "proposal-b",
      );
      await reopened.close();
      const database = new Database(join(stateDirectory, "government.sqlite"));
      database
        .query(
          "INSERT INTO composition_checkpoints (checkpoint_id, root_ref, cursor, refs_json, updated_at) VALUES ($checkpointId, $rootRef, NULL, $refsJson, $updatedAt)",
        )
        .run({
          $checkpointId: "corrupt-oversized",
          $rootRef: "head:normalization@1",
          $refsJson: JSON.stringify(["ref-".repeat(1024)]),
          $updatedAt: "2026-09-19T00:01:03.000Z",
        });
      database.close();
      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() =>
        corrupted.getCompositionCheckpoint("corrupt-oversized"),
      ).toThrow("violates bounded descriptor");
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("commits a planned frame, operation, and outbox row together", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      expect(store.schemaVersion()).toBe(29);
      const definition = fixtureDefinition();
      const started = startGraphFrame(definition.ref, definition.checked, 1);
      const planned = advanceGraphFrame(
        started,
        requiredOperationId("operation-1"),
      );
      if (planned.kind !== "operationPlanned")
        throw new Error(`expected plan, got ${planned.kind}`);

      store.persistGraphOperationIntent({
        executionId: "execution-1",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      expect(store.getGraphExecution("execution-1")?.frame).toEqual(
        planned.frame,
      );
      expect(store.getGraphExecution("execution-1")?.revision).toBe(0);
      expect(store.listPendingGraphOutbox()).toEqual([
        {
          operationId: requiredOperationId("operation-1"),
          executionId: "execution-1",
          payload: {
            abstraction: increment,
            attempt: null,
            input: 1,
            operationId: requiredOperationId("operation-1"),
          },
        },
      ]);

      const completed = observeGraphOperation(planned.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-1"),
        output: 2,
      });
      if (completed.kind !== "terminal")
        throw new Error(`expected terminal, got ${completed.kind}`);
      expect(() =>
        store.persistGraphOperationObservation({
          executionId: "execution-1",
          operationId: "operation-1",
          observation: {
            kind: "succeeded",
            operationId: requiredOperationId("operation-1"),
            output: 2,
          },
          frame: completed.frame,
          expectedRevision: 0,
          occurredAt: "2026-09-19T00:00:01.000Z",
        }),
      ).toThrow("is not dispatched");
      store.markGraphOperationDispatched(
        "execution-1",
        "operation-1",
        "2026-09-19T00:00:01.000Z",
      );
      expect(store.listPendingGraphOutbox()).toEqual([]);
      store.persistGraphOperationObservation({
        executionId: "execution-1",
        operationId: "operation-1",
        observation: {
          kind: "succeeded",
          operationId: requiredOperationId("operation-1"),
          output: 2,
        },
        frame: completed.frame,
        expectedRevision: 0,
        occurredAt: "2026-09-19T00:00:01.000Z",
      });
      expect(store.getGraphExecution("execution-1")?.frame).toEqual(
        completed.frame,
      );
      expect(store.getGraphExecution("execution-1")?.revision).toBe(1);
      expect(store.listPendingGraphOutbox()).toEqual([]);
      expect(() =>
        store.persistGraphFrame({
          executionId: "execution-1",
          definition,
          frame: completed.frame,
          expectedRevision: 0,
          occurredAt: "2026-09-19T00:00:02.000Z",
        }),
      ).toThrow("expected frame revision 0");
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getGraphExecution("execution-1")?.frame).toEqual(
        completed.frame,
      );
      await reopened.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      database
        .query(
          "UPDATE graph_definitions SET canonical_json = '{\"invalid\":true}' WHERE ref = $ref",
        )
        .run({ $ref: definition.ref });
      database.close();
      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() => corrupted.getGraphExecution("execution-1")).toThrow(
        "failed canonical hash verification",
      );
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("atomically attaches a fresh graph intent to one live run", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-run-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.createRunWithOperationAllocation(
        {
          id: "graph-run",
          taskType: "graph-owner",
          status: "running",
          createdAt: "2026-09-19T00:00:00.000Z",
          completedAt: null,
          outcome: null,
        },
        1,
      );
      const planned = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 1),
        requiredOperationId("operation-run-bound"),
      );
      if (planned.kind !== "operationPlanned")
        throw new Error("expected planned operation");
      store.persistRunGraphOperationIntent({
        runId: "graph-run",
        executionId: "execution-run-bound",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:01.000Z",
      });
      expect(store.getGraphExecutionForRun("graph-run")?.frame).toEqual(
        planned.frame,
      );
      expect(
        store.getRun("graph-run")?.events.map((event) => event.kind),
      ).toEqual([
        "RunRequested",
        "RunOperationAllocationCreated",
        "GraphExecutionAttached",
        "OperationReserved",
      ]);

      store.createRun({
        id: "other-run",
        taskType: "graph-owner",
        status: "running",
        createdAt: "2026-09-19T00:00:02.000Z",
        completedAt: null,
        outcome: null,
      });
      const other = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 1),
        requiredOperationId("operation-other-run"),
      );
      if (other.kind !== "operationPlanned")
        throw new Error("expected second planned operation");
      expect(() =>
        store.persistRunGraphOperationIntent({
          runId: "graph-run",
          executionId: "execution-other-run",
          definition,
          frame: other.frame,
          expectedRevision: null,
          operation: other.operation,
          occurredAt: "2026-09-19T00:00:03.000Z",
        }),
      ).toThrow("run graph-run operation allocation exceeded");
      expect(store.getGraphExecution("execution-other-run")).toBeNull();
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getGraphExecutionForRun("graph-run")?.revision).toBe(0);
      expect(reopened.getGraphExecutionForRun("other-run")).toBeNull();
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("reserves each child operation against immutable inclusive allocations", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-ledger-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.createRunWithOperationAllocation(
        runningRun("parent", "2026-09-19T00:00:00.000Z"),
        1,
      );
      store.createOwnedChildRunWithOperationAllocation(
        "parent",
        runningRun("child-a", "2026-09-19T00:00:01.000Z"),
        1,
      );
      store.createOwnedChildRunWithOperationAllocation(
        "parent",
        runningRun("child-b", "2026-09-19T00:00:02.000Z"),
        1,
      );

      const childA = plannedGraphOperation(definition, "operation-child-a");
      store.persistRunGraphOperationIntent({
        runId: "child-a",
        executionId: "execution-child-a",
        definition,
        frame: childA.frame,
        expectedRevision: null,
        operation: childA.operation,
        occurredAt: "2026-09-19T00:00:03.000Z",
      });
      expect(store.getRunOperationAllocation("child-a")).toEqual({
        runId: "child-a",
        maxOperations: 1,
        reservedOperations: 1,
        remainingOperations: 0,
      });
      expect(store.getRunOperationAllocation("parent")).toEqual({
        runId: "parent",
        maxOperations: 1,
        reservedOperations: 1,
        remainingOperations: 0,
      });

      const childB = plannedGraphOperation(definition, "operation-child-b");
      expect(() =>
        store.persistRunGraphOperationIntent({
          runId: "child-b",
          executionId: "execution-child-b",
          definition,
          frame: childB.frame,
          expectedRevision: null,
          operation: childB.operation,
          occurredAt: "2026-09-19T00:00:04.000Z",
        }),
      ).toThrow("run parent operation allocation exceeded");
      expect(store.getGraphExecution("execution-child-b")).toBeNull();
      expect(store.getGraphExecutionForRun("child-b")).toBeNull();
      expect(store.listPendingGraphOutbox()).toHaveLength(1);

      store.markGraphOperationDispatched(
        "execution-child-a",
        "operation-child-a",
        "2026-09-19T00:00:05.000Z",
      );
      store.markGraphOperationIndeterminate(
        "execution-child-a",
        "operation-child-a",
        "2026-09-19T00:00:06.000Z",
      );
      expect(
        store.getRunOperationAllocation("parent")?.reservedOperations,
      ).toBe(1);
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.schemaVersion()).toBe(29);
      expect(reopened.getRunOperationAllocation("parent")).toEqual({
        runId: "parent",
        maxOperations: 1,
        reservedOperations: 1,
        remainingOperations: 0,
      });
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("derives later operation reservations from the attached execution", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-ledger-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = retryFixtureDefinition();
      store.createRunWithOperationAllocation(
        runningRun("retry-owner", "2026-09-19T00:00:00.000Z"),
        1,
      );
      const entered = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 7),
      );
      if (entered.kind !== "advanced")
        throw new Error("expected entered retry frame");
      const first = advanceGraphFrame(
        entered.frame,
        requiredOperationId("operation-bound-retry-1"),
        requiredAttemptId("attempt-bound-1"),
      );
      if (first.kind !== "operationPlanned")
        throw new Error("expected first retry operation");
      store.persistRunGraphOperationIntent({
        runId: "retry-owner",
        executionId: "execution-bound-retry",
        definition,
        frame: first.frame,
        expectedRevision: null,
        operation: first.operation,
        occurredAt: "2026-09-19T00:00:01.000Z",
      });
      store.markGraphOperationDispatched(
        "execution-bound-retry",
        "operation-bound-retry-1",
        "2026-09-19T00:00:02.000Z",
      );
      const retrying = observeGraphOperation(first.frame, {
        kind: "failed",
        operationId: requiredOperationId("operation-bound-retry-1"),
        failure: "Transient",
      });
      if (retrying.kind !== "advanced")
        throw new Error("expected retry continuation");
      store.persistGraphOperationObservation({
        executionId: "execution-bound-retry",
        operationId: "operation-bound-retry-1",
        observation: {
          kind: "failed",
          operationId: requiredOperationId("operation-bound-retry-1"),
          failure: "Transient",
        },
        frame: retrying.frame,
        expectedRevision: 0,
        occurredAt: "2026-09-19T00:00:03.000Z",
      });
      const second = advanceGraphFrame(
        retrying.frame,
        requiredOperationId("operation-bound-retry-2"),
        requiredAttemptId("attempt-bound-2"),
      );
      if (second.kind !== "operationPlanned")
        throw new Error("expected second retry operation");
      expect(() =>
        store.persistGraphOperationIntent({
          executionId: "execution-bound-retry",
          definition,
          frame: second.frame,
          expectedRevision: 1,
          operation: second.operation,
          occurredAt: "2026-09-19T00:00:04.000Z",
        }),
      ).toThrow("run retry-owner operation allocation exceeded");
      expect(store.getGraphExecution("execution-bound-retry")?.frame).toEqual(
        retrying.frame,
      );
      expect(store.getRunOperationAllocation("retry-owner")).toEqual({
        runId: "retry-owner",
        maxOperations: 1,
        reservedOperations: 1,
        remainingOperations: 0,
      });
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rolls back a run-bound graph intent when an allocation is absent", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-ledger-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.createRun(runningRun("unallocated", "2026-09-19T00:00:00.000Z"));
      const planned = plannedGraphOperation(
        definition,
        "operation-unallocated",
      );
      expect(() =>
        store.persistRunGraphOperationIntent({
          runId: "unallocated",
          executionId: "execution-unallocated",
          definition,
          frame: planned.frame,
          expectedRevision: null,
          operation: planned.operation,
          occurredAt: "2026-09-19T00:00:01.000Z",
        }),
      ).toThrow("run unallocated has no operation allocation");
      expect(store.getGraphExecution("execution-unallocated")).toBeNull();
      expect(store.getGraphExecutionForRun("unallocated")).toBeNull();
      expect(store.listPendingGraphOutbox()).toEqual([]);
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("records one usage charge and keeps indeterminate usage explicit", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-usage-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.createRunWithOperationAllocation(
        runningRun("usage-parent", "2026-09-19T00:00:00.000Z"),
        2,
      );
      store.createOwnedChildRunWithOperationAllocation(
        "usage-parent",
        runningRun("usage-child", "2026-09-19T00:00:01.000Z"),
        1,
      );
      const planned = plannedGraphOperation(definition, "operation-usage");
      store.persistRunGraphOperationIntent({
        runId: "usage-child",
        executionId: "execution-usage",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:02.000Z",
      });
      store.markGraphOperationDispatched(
        "execution-usage",
        "operation-usage",
        "2026-09-19T00:00:03.000Z",
      );
      store.markGraphOperationIndeterminate(
        "execution-usage",
        "operation-usage",
        "2026-09-19T00:00:04.000Z",
      );
      store.recordGraphOperationUsage(
        "execution-usage",
        "operation-usage",
        null,
        "2026-09-19T00:00:05.000Z",
      );
      expect(store.getRunUsageTotals("usage-child")).toEqual({
        runId: "usage-child",
        knownUnits: 0,
        unknownOperations: 1,
      });
      expect(store.getRunUsageTotals("usage-parent")).toEqual({
        runId: "usage-parent",
        knownUnits: 0,
        unknownOperations: 1,
      });
      store.recordGraphOperationUsage(
        "execution-usage",
        "operation-usage",
        7,
        "2026-09-19T00:00:06.000Z",
      );
      expect(store.getRunUsageTotals("usage-parent")).toEqual({
        runId: "usage-parent",
        knownUnits: 7,
        unknownOperations: 0,
      });
      expect(() =>
        store.recordGraphOperationUsage(
          "execution-usage",
          "operation-usage",
          8,
          "2026-09-19T00:00:07.000Z",
        ),
      ).toThrow("conflicts with its recorded charge");
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getRunUsageTotals("usage-parent")).toEqual({
        runId: "usage-parent",
        knownUnits: 7,
        unknownOperations: 0,
      });
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rejects a pinned catalogue that cannot rebuild a runnable definition", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      const frame = startGraphFrame(definition.ref, definition.checked, 1);
      store.persistGraphFrame({
        executionId: "execution-invalid-catalogue",
        definition,
        frame,
        expectedRevision: null,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      expect(
        store.getRunnableGraphDefinition("execution-invalid-catalogue")
          ?.checked,
      ).toEqual(definition.checked);
      await store.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      const row = database
        .query<{ canonical_json: string }, { $ref: string }>(
          "SELECT canonical_json FROM graph_catalogues WHERE ref = $ref",
        )
        .get({ $ref: definition.manifest.ref });
      if (row === null) throw new Error("expected persisted catalogue");
      const catalogue = JSON.parse(row.canonical_json) as {
        abstractions: { contract: { effect: { maxOperations: number } } }[];
      };
      const abstraction = catalogue.abstractions[0];
      if (abstraction === undefined) throw new Error("expected abstraction");
      abstraction.contract.effect.maxOperations = -1;
      const canonical = canonicalJson(catalogue as JsonValue);
      database
        .query(
          "UPDATE graph_catalogues SET canonical_json = $canonical, content_hash = $hash WHERE ref = $ref",
        )
        .run({
          $canonical: canonical,
          $hash: hashCanonicalJson(catalogue as JsonValue),
          $ref: definition.manifest.ref,
        });
      database.close();

      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() =>
        corrupted.getGraphExecution("execution-invalid-catalogue"),
      ).toThrow("effect maxOperations must be nonnegative");
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rejects a hash-valid frame with an invalid state shape", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.persistGraphFrame({
        executionId: "execution-invalid-frame",
        definition,
        frame: startGraphFrame(definition.ref, definition.checked, 1),
        expectedRevision: null,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      await store.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      const row = database
        .query<{ frame_json: string }, { $executionId: string }>(
          "SELECT frame_json FROM graph_executions WHERE execution_id = $executionId",
        )
        .get({ $executionId: "execution-invalid-frame" });
      if (row === null) throw new Error("expected persisted frame");
      const frame = JSON.parse(row.frame_json) as {
        state: Record<string, unknown>;
      };
      frame.state.extra = true;
      const canonical = canonicalJson(frame as JsonValue);
      database
        .query(
          "UPDATE graph_executions SET frame_json = $frame, frame_hash = $hash WHERE execution_id = $executionId",
        )
        .run({
          $frame: canonical,
          $hash: hashCanonicalJson(frame as JsonValue),
          $executionId: "execution-invalid-frame",
        });
      database.close();

      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() =>
        corrupted.getGraphExecution("execution-invalid-frame"),
      ).toThrow("running frame has an invalid shape");
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rejects an awaiting frame whose operation record is altered", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      const planned = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 1),
        requiredOperationId("operation-bound"),
      );
      if (planned.kind !== "operationPlanned")
        throw new Error("expected planned operation");
      store.persistGraphOperationIntent({
        executionId: "execution-bound",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      await store.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      database
        .query(
          "UPDATE graph_operations SET abstraction_ref = $abstraction WHERE operation_id = $operationId",
        )
        .run({
          $abstraction: "example/altered@1",
          $operationId: "operation-bound",
        });
      database.close();

      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() => corrupted.getGraphExecution("execution-bound")).toThrow(
        "awaiting frame does not match its operation record",
      );
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rechecks a pinned graph against its reconstructed catalogue", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      store.persistGraphFrame({
        executionId: "execution-invalid-graph",
        definition,
        frame: startGraphFrame(definition.ref, definition.checked, 1),
        expectedRevision: null,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      await store.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      const row = database
        .query<{ canonical_json: string }, { $ref: string }>(
          "SELECT canonical_json FROM graph_definitions WHERE ref = $ref",
        )
        .get({ $ref: definition.ref });
      if (row === null) throw new Error("expected persisted definition");
      const persisted = JSON.parse(row.canonical_json) as {
        graph: { abstraction: string; kind: string };
      };
      persisted.graph.abstraction = "example/missing@1";
      const canonical = canonicalJson(persisted as JsonValue);
      database
        .query(
          "UPDATE graph_definitions SET canonical_json = $canonical, content_hash = $hash WHERE ref = $ref",
        )
        .run({
          $canonical: canonical,
          $hash: hashCanonicalJson(persisted as JsonValue),
          $ref: definition.ref,
        });
      database.close();

      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() =>
        corrupted.getGraphExecution("execution-invalid-graph"),
      ).toThrow("definition graph is not runnable: UnknownAbstraction");
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("classifies planned work and preserves dispatched ambiguity", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      const planned = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 1),
        requiredOperationId("operation-reconcile"),
      );
      if (planned.kind !== "operationPlanned")
        throw new Error("expected planned operation");
      store.persistGraphOperationIntent({
        executionId: "execution-reconcile",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      expect(
        store.reconcileGraphExecution(
          "execution-reconcile",
          "2026-09-19T00:00:01.000Z",
        ),
      ).toEqual({
        executionId: "execution-reconcile",
        operations: [
          { operationId: "operation-reconcile", action: "dispatchable" },
        ],
      });
      store.markGraphOperationDispatched(
        "execution-reconcile",
        "operation-reconcile",
        "2026-09-19T00:00:02.000Z",
      );
      expect(
        store.reconcileGraphExecution(
          "execution-reconcile",
          "2026-09-19T00:00:03.000Z",
        ),
      ).toEqual({
        executionId: "execution-reconcile",
        operations: [
          { operationId: "operation-reconcile", action: "indeterminate" },
        ],
      });
      expect(store.listPendingGraphOutbox()).toEqual([]);
      expect(
        store.reconcileGraphExecution(
          "execution-reconcile",
          "2026-09-19T00:00:04.000Z",
        ),
      ).toEqual({
        executionId: "execution-reconcile",
        operations: [
          { operationId: "operation-reconcile", action: "indeterminate" },
        ],
      });
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("rolls back the frame update when an operation identity conflicts", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      const started = startGraphFrame(definition.ref, definition.checked, 1);
      const planned = advanceGraphFrame(
        started,
        requiredOperationId("operation-1"),
      );
      if (planned.kind !== "operationPlanned") throw new Error("expected plan");
      store.persistGraphOperationIntent({
        executionId: "execution-1",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });

      store.markGraphOperationDispatched(
        "execution-1",
        "operation-1",
        "2026-09-19T00:00:01.000Z",
      );
      store.markGraphOperationIndeterminate(
        "execution-1",
        "operation-1",
        "2026-09-19T00:00:02.000Z",
      );
      expect(store.listPendingGraphOutbox()).toEqual([]);
      expect(() =>
        store.markGraphOperationDispatched(
          "execution-1",
          "operation-1",
          "2026-09-19T00:00:03.000Z",
        ),
      ).toThrow("is not planned");

      const conflictingFrame = observeGraphOperation(planned.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-1"),
        output: 2,
      });
      if (conflictingFrame.kind !== "terminal")
        throw new Error("expected terminal");
      expect(() =>
        store.persistGraphOperationIntent({
          executionId: "execution-1",
          definition,
          frame: conflictingFrame.frame,
          expectedRevision: 0,
          operation: planned.operation,
          occurredAt: "2026-09-19T00:00:01.000Z",
        }),
      ).toThrow("UNIQUE constraint failed");
      expect(store.getGraphExecution("execution-1")?.frame).toEqual(
        planned.frame,
      );
      await store.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("restores a bounded retry chain across SQLite restart", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-retry-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = retryFixtureDefinition();
      const entered = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 7),
      );
      if (entered.kind !== "advanced")
        throw new Error("expected entered retry frame");
      const first = advanceGraphFrame(
        entered.frame,
        requiredOperationId("operation-retry-1"),
        requiredAttemptId("attempt-1"),
      );
      if (first.kind !== "operationPlanned")
        throw new Error("expected first retry operation");
      store.persistGraphOperationIntent({
        executionId: "execution-retry",
        definition,
        frame: first.frame,
        expectedRevision: null,
        operation: first.operation,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      store.markGraphOperationDispatched(
        "execution-retry",
        "operation-retry-1",
        "2026-09-19T00:00:01.000Z",
      );
      const retrying = observeGraphOperation(first.frame, {
        kind: "failed",
        operationId: requiredOperationId("operation-retry-1"),
        failure: "Transient",
      });
      if (retrying.kind !== "advanced")
        throw new Error("expected retry continuation");
      store.persistGraphOperationObservation({
        executionId: "execution-retry",
        operationId: "operation-retry-1",
        observation: {
          kind: "failed",
          operationId: requiredOperationId("operation-retry-1"),
          failure: "Transient",
        },
        frame: retrying.frame,
        expectedRevision: 0,
        occurredAt: "2026-09-19T00:00:02.000Z",
      });
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getGraphExecution("execution-retry")?.frame).toEqual(
        retrying.frame,
      );
      expect(reopened.getGraphExecution("execution-retry")?.revision).toBe(1);
      expect(
        reopened.reconcileGraphExecution(
          "execution-retry",
          "2026-09-19T00:00:03.000Z",
        ),
      ).toEqual({ executionId: "execution-retry", operations: [] });

      const duplicate = advanceGraphFrame(
        retrying.frame,
        requiredOperationId("operation-retry-1"),
        requiredAttemptId("attempt-2"),
      );
      expect(duplicate).toEqual({
        kind: "rejected",
        reason: {
          kind: "OperationIdReused",
          operationId: requiredOperationId("operation-retry-1"),
        },
      });
      const second = advanceGraphFrame(
        retrying.frame,
        requiredOperationId("operation-retry-2"),
        requiredAttemptId("attempt-2"),
      );
      if (second.kind !== "operationPlanned")
        throw new Error("expected second retry operation");
      expect(second.operation).toEqual({
        operationId: requiredOperationId("operation-retry-2"),
        abstraction: flaky,
        input: 7,
        attempt: { id: requiredAttemptId("attempt-2"), ordinal: 2 },
      });
      reopened.persistGraphOperationIntent({
        executionId: "execution-retry",
        definition,
        frame: second.frame,
        expectedRevision: 1,
        operation: second.operation,
        occurredAt: "2026-09-19T00:00:04.000Z",
      });
      await reopened.close();

      const restored = await SqliteRunStore.open(stateDirectory);
      expect(restored.getGraphExecution("execution-retry")?.frame).toEqual(
        second.frame,
      );
      expect(restored.getGraphExecution("execution-retry")?.revision).toBe(2);
      expect(restored.listPendingGraphOutbox()).toEqual([
        {
          operationId: requiredOperationId("operation-retry-2"),
          executionId: "execution-retry",
          payload: {
            abstraction: flaky,
            attempt: { id: requiredAttemptId("attempt-2"), ordinal: 2 },
            input: 7,
            operationId: requiredOperationId("operation-retry-2"),
          },
        },
      ]);
      await restored.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      database
        .query(
          "UPDATE graph_operations SET attempt_id = $attemptId WHERE operation_id = $operationId",
        )
        .run({
          $attemptId: "attempt-other",
          $operationId: "operation-retry-1",
        });
      database.close();

      const historyCorrupted = await SqliteRunStore.open(stateDirectory);
      expect(() =>
        historyCorrupted.getGraphExecution("execution-retry"),
      ).toThrow("retry frame operation history is incomplete");
      await historyCorrupted.close();

      const repaired = new Database(join(stateDirectory, "government.sqlite"));
      repaired
        .query(
          "UPDATE graph_operations SET attempt_id = $attemptId WHERE operation_id = $operationId",
        )
        .run({
          $attemptId: "attempt-1",
          $operationId: "operation-retry-1",
        });
      const row = repaired
        .query<{ frame_json: string }, { $executionId: string }>(
          "SELECT frame_json FROM graph_executions WHERE execution_id = $executionId",
        )
        .get({ $executionId: "execution-retry" });
      if (row === null) throw new Error("expected retry frame");
      const forged = JSON.parse(row.frame_json) as {
        state: { attempt: unknown };
      };
      forged.state.attempt = null;
      const canonical = canonicalJson(forged as JsonValue);
      repaired
        .query(
          "UPDATE graph_executions SET frame_json = $frame, frame_hash = $hash WHERE execution_id = $executionId",
        )
        .run({
          $frame: canonical,
          $hash: hashCanonicalJson(forged as JsonValue),
          $executionId: "execution-retry",
        });
      repaired.close();

      const corrupted = await SqliteRunStore.open(stateDirectory);
      expect(() => corrupted.getGraphExecution("execution-retry")).toThrow(
        "awaiting retry frame does not match its active continuation",
      );
      await corrupted.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("settles indeterminate work only from attributable adapter evidence", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-graph-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      const definition = fixtureDefinition();
      const planned = advanceGraphFrame(
        startGraphFrame(definition.ref, definition.checked, 1),
        requiredOperationId("operation-attributed"),
      );
      if (planned.kind !== "operationPlanned")
        throw new Error("expected planned operation");
      store.persistGraphOperationIntent({
        executionId: "execution-attributed",
        definition,
        frame: planned.frame,
        expectedRevision: null,
        operation: planned.operation,
        occurredAt: "2026-09-19T00:00:00.000Z",
      });
      store.markGraphOperationDispatched(
        "execution-attributed",
        "operation-attributed",
        "2026-09-19T00:00:01.000Z",
      );
      expect(
        store.reconcileGraphExecution(
          "execution-attributed",
          "2026-09-19T00:00:02.000Z",
        ),
      ).toEqual({
        executionId: "execution-attributed",
        operations: [
          { operationId: "operation-attributed", action: "indeterminate" },
        ],
      });

      const unknownAdapter = new FakeOperationReconciliationAdapter(
        increment,
        "example/reconciler@1",
        [],
      );
      const unknown = await reconcileIndeterminateGraphOperation(
        store,
        "execution-attributed",
        unknownAdapter,
        "2026-09-19T00:00:03.000Z",
      );
      expect(unknown).toEqual({ kind: "unknown" });
      expect(unknownAdapter.requests).toEqual([
        {
          executionId: "execution-attributed",
          operationId: requiredOperationId("operation-attributed"),
          abstraction: increment,
          input: 1,
          attempt: null,
        },
      ]);
      expect(
        store.graphOperationLifecycle(
          "execution-attributed",
          "operation-attributed",
        ),
      ).toBe("indeterminate");
      expect(store.getGraphExecution("execution-attributed")?.revision).toBe(0);
      expect(store.listPendingGraphOutbox()).toEqual([]);

      await expect(
        reconcileIndeterminateGraphOperation(
          store,
          "execution-attributed",
          {
            abstraction: increment,
            reconcile: async () => ({
              kind: "observed",
              observation: {
                kind: "succeeded",
                operationId: requiredOperationId("other-operation"),
                output: 2,
              },
              attribution: {
                adapterRef: "example/reconciler@1",
                externalOperationId: "external-other",
                evidence: { source: "lookup" },
              },
            }),
          },
          "2026-09-19T00:00:04.000Z",
        ),
      ).rejects.toThrow("does not match the operation");
      expect(
        store.graphOperationLifecycle(
          "execution-attributed",
          "operation-attributed",
        ),
      ).toBe("indeterminate");

      const observed = await reconcileIndeterminateGraphOperation(
        store,
        "execution-attributed",
        new FakeOperationReconciliationAdapter(
          increment,
          "example/reconciler@1",
          [
            {
              operationId: requiredOperationId("operation-attributed"),
              externalOperationId: "external-attributed",
              evidence: { receipt: "remote-42", source: "lookup" },
              outcome: { kind: "succeeded", output: 2 },
            },
          ],
        ),
        "2026-09-19T00:00:05.000Z",
      );
      expect(observed.kind).toBe("observed");
      expect(store.getGraphExecution("execution-attributed")?.frame).toEqual({
        schemaVersion: 1,
        graphRef: definition.ref,
        state: { kind: "succeeded", output: 2 },
      });
      expect(store.getGraphExecution("execution-attributed")?.revision).toBe(1);
      expect(
        store.graphOperationLifecycle(
          "execution-attributed",
          "operation-attributed",
        ),
      ).toBeNull();
      await store.close();

      const database = new Database(join(stateDirectory, "government.sqlite"));
      expect(
        database
          .query<
            {
              adapter_ref: string;
              external_operation_id: string;
              evidence_json: string;
              occurred_at: string;
            },
            []
          >(
            "SELECT adapter_ref, external_operation_id, evidence_json, occurred_at FROM graph_operation_reconciliations",
          )
          .all(),
      ).toEqual([
        {
          adapter_ref: "example/reconciler@1",
          external_operation_id: "external-attributed",
          evidence_json: '{"receipt":"remote-42","source":"lookup"}',
          occurred_at: "2026-09-19T00:00:05.000Z",
        },
      ]);
      database.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
});

function retryFixtureDefinition() {
  const effect: EffectBound = {
    capabilities: ["math"],
    reads: ["input"],
    writes: [],
    maxOperations: 1,
  };
  const catalogue: GraphCatalogue = {
    abstractions: new Map([
      [
        flaky,
        {
          ref: flaky,
          contract: {
            input: number,
            output: number,
            effect,
            failures: ["Transient"],
            verifier,
            assumptions: [],
            assurance: "authored",
          },
        },
      ],
    ]),
    schemas: new Map([[number, { kind: "atomic", ref: number }]]),
  };
  const definition = defineGraph(
    requiredGraphRef("example/retry-graph@1"),
    {
      kind: "retry",
      maxAttempts: 2,
      witness: {
        precondition: number,
        maxAttempts: 2,
        retryableFailures: ["Transient"],
        restoration: "sameInput",
        idempotency: "required",
        effectCeiling: { ...effect, maxOperations: 2 },
      },
      body: { kind: "call", abstraction: flaky },
    },
    createCatalogueManifest(
      requiredManifestRef("example/retry-catalogue@1"),
      catalogue,
    ),
    catalogue,
  );
  if ("kind" in definition)
    throw new Error(`retry definition failed: ${definition.kind}`);
  return definition;
}

function fixtureDefinition() {
  const catalogue = fixtureCatalogue();
  const definition = defineGraph(
    requiredGraphRef("example/increment-graph@1"),
    { kind: "call", abstraction: increment },
    createCatalogueManifest(
      requiredManifestRef("example/catalogue@1"),
      catalogue,
    ),
    catalogue,
  );
  if ("kind" in definition)
    throw new Error(`definition failed: ${definition.kind}`);
  return definition;
}

function fixtureCatalogue(): GraphCatalogue {
  const effect: EffectBound = {
    capabilities: ["math"],
    reads: ["input"],
    writes: [],
    maxOperations: 1,
  };
  const contract: Contract = {
    input: number,
    output: number,
    effect,
    failures: [],
    verifier,
    assumptions: [],
    assurance: "authored",
  };
  const abstraction: CallableAbstraction = { ref: increment, contract };
  return {
    abstractions: new Map([[increment, abstraction]]),
    schemas: new Map([[number, { kind: "atomic", ref: number }]]),
  };
}

function runningRun(id: string, createdAt: string) {
  return {
    id,
    taskType: "graph-owner",
    status: "running" as const,
    createdAt,
    completedAt: null,
    outcome: null,
  };
}

function plannedGraphOperation(
  definition: ReturnType<typeof fixtureDefinition>,
  operationId: string,
) {
  const planned = advanceGraphFrame(
    startGraphFrame(definition.ref, definition.checked, 1),
    requiredOperationId(operationId),
  );
  if (planned.kind !== "operationPlanned")
    throw new Error("expected planned operation");
  return planned;
}

function requiredSchema(value: string): SchemaRef {
  const parsed = parseSchemaRef(value);
  if (!isSchemaRef(parsed)) throw new Error(`invalid schema: ${value}`);
  return parsed;
}

function requiredAbstraction(value: string): AbstractionRef {
  const parsed = parseAbstractionRef(value);
  if (!isAbstractionRef(parsed))
    throw new Error(`invalid abstraction: ${value}`);
  return parsed;
}

function requiredGraphRef(value: string) {
  const parsed = parseGraphRef(value);
  if (!isGraphRef(parsed)) throw new Error(`invalid graph ref: ${value}`);
  return parsed;
}

function requiredManifestRef(value: string) {
  const parsed = parseCatalogueManifestRef(value);
  if (!isCatalogueManifestRef(parsed))
    throw new Error(`invalid manifest ref: ${value}`);
  return parsed;
}

function requiredAttemptId(value: string) {
  const parsed = parseAttemptId(value);
  if (!isAttemptId(parsed)) throw new Error(`invalid attempt ID: ${value}`);
  return parsed;
}

function requiredOperationId(value: string) {
  const parsed = parseOperationId(value);
  if (!isOperationId(parsed)) throw new Error(`invalid operation ID: ${value}`);
  return parsed;
}

function requiredVerifier(value: string) {
  const parsed = parseVerifierRef(value);
  if (!isVerifierRef(parsed)) throw new Error(`invalid verifier: ${value}`);
  return parsed;
}
