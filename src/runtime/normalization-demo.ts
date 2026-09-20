import {
  createPersistedNormalizationDomainEvidence,
  normalizationBaseline,
  normalizationFiniteDomain,
  normalizationRefs,
  normalizationRevised,
} from "../fixtures/normalization.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";
import { executePersistedNormalization } from "./normalization-execution.ts";

export type NormalizationDemo = Readonly<{
  headBefore: string;
  evidenceExecutionId: string;
  evidenceExecutionIds: readonly string[];
  receiptFingerprint: string;
  headAfter: string;
  subsequentExecutionId: string;
  subsequentCandidateRef: string;
  revokedSupportRejection: string;
  revokedExecutionRejection: string;
}>;

/** One complete offline Gate A path. Use a fresh state directory for this demo. */
export function runNormalizationDemo(
  store: SqliteRunStore,
  occurredAt: string,
): NormalizationDemo {
  if (store.getGraphHead("normalization") !== null)
    throw new Error("normalization demo requires a fresh state directory");
  store.registerGraphDefinition(normalizationBaseline);
  store.registerGraphDefinition(normalizationRevised);
  store.createGraphHead("normalization", normalizationBaseline.ref, occurredAt);
  store.createRunWithOperationAllocation(
    run("normalization-governor", occurredAt),
    6,
  );
  store.createOwnedChildRunWithOperationAllocation(
    "normalization-governor",
    run("normalization-evidence-child", occurredAt),
    normalizationFiniteDomain.length,
  );
  const evaluations = normalizationFiniteDomain.map((records, index) =>
    executePersistedNormalization({
      store,
      executionId: `normalization-evidence-execution-${index}`,
      childRunId: "normalization-evidence-child",
      candidateRef: normalizationRevised.ref,
      batchId: `normalization-demo-${index}`,
      records,
      occurredAt,
    }),
  );
  store.completeRun(
    "normalization-evidence-child",
    "succeeded",
    "normalization evidence completed",
    occurredAt,
  );
  const evidence = createPersistedNormalizationDomainEvidence(
    "normalization-evidence",
    evaluations,
    occurredAt,
  );
  store.createGraphEvidence(evidence);
  store.createGraphProposal({
    proposalId: "normalization-revision",
    headKey: "normalization",
    baseGraphRef: normalizationBaseline.ref,
    candidateGraphRef: normalizationRevised.ref,
    baseVersion: 0,
    originRunId: "normalization-evidence-child",
    evidenceIds: [evidence.evidenceId],
    dependencies: [
      {
        dependencyKind: "manifest",
        dependencyRef: normalizationRefs.manifest,
      },
    ],
    createdAt: occurredAt,
  });
  const receipt = store.admitNormalizationProposal({
    receiptId: "normalization-receipt",
    proposalId: "normalization-revision",
    governorRunId: "normalization-governor",
    policyRef: "normalization/policy@1",
    checkedAt: occurredAt,
  });
  store.commitGraphProposal(
    "normalization-revision",
    "normalization-receipt",
    occurredAt,
  );
  const head = store.getGraphHead("normalization");
  if (head === null || head.graphRef !== normalizationRevised.ref)
    throw new Error("normalization demo did not commit the revised head");
  store.createOwnedChildRunWithOperationAllocation(
    "normalization-governor",
    run("normalization-future-child", occurredAt),
    1,
  );
  const subsequent = executePersistedNormalization({
    store,
    executionId: "normalization-future-execution",
    childRunId: "normalization-future-child",
    candidateRef: head.graphRef,
    headKey: "normalization",
    batchId: "normalization-future",
    records: [{ id: "a", value: "a" }],
    occurredAt,
  });
  store.completeRun(
    "normalization-future-child",
    "succeeded",
    "future execution completed",
    occurredAt,
  );
  store.setGraphDependencyStatus(
    normalizationRefs.manifest,
    "suspended",
    "demo revocation",
    "normalization-revoked@1",
    occurredAt,
  );
  store.createGraphProposal({
    proposalId: "normalization-revoked",
    headKey: "normalization",
    baseGraphRef: normalizationRevised.ref,
    candidateGraphRef: normalizationBaseline.ref,
    baseVersion: 1,
    originRunId: "normalization-evidence-child",
    evidenceIds: [evidence.evidenceId],
    dependencies: [
      {
        dependencyKind: "manifest",
        dependencyRef: normalizationRefs.manifest,
      },
    ],
    createdAt: occurredAt,
  });
  const revokedSupportRejection = capture(() =>
    store.admitNormalizationProposal({
      receiptId: "normalization-revoked-receipt",
      proposalId: "normalization-revoked",
      governorRunId: "normalization-governor",
      policyRef: "normalization/policy@1",
      checkedAt: occurredAt,
    }),
  );
  const revokedExecutionRejection = capture(() =>
    executePersistedNormalization({
      store,
      executionId: "normalization-blocked-execution",
      childRunId: "normalization-future-child",
      candidateRef: normalizationRevised.ref,
      headKey: "normalization",
      batchId: "normalization-blocked",
      records: [],
      occurredAt,
    }),
  );
  return {
    headBefore: normalizationBaseline.ref,
    evidenceExecutionId: evaluations[0]?.executionId ?? "",
    evidenceExecutionIds: evaluations.map(
      (evaluation) => evaluation.executionId,
    ),
    receiptFingerprint: receipt.checkedFingerprint,
    headAfter: head.graphRef,
    subsequentExecutionId: subsequent.executionId,
    subsequentCandidateRef: subsequent.candidateRef,
    revokedSupportRejection,
    revokedExecutionRejection,
  };
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

function capture(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("normalization demo expected revocation to reject admission");
}
