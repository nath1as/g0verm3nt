import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type ContentHash,
  canonicalJson,
  hashCanonicalJson,
} from "../codecs/canonical.ts";
import { decodePinnedGraphDefinition } from "../codecs/persisted-graph-definition.ts";
import { decodePinnedGraphFrame } from "../codecs/persisted-graph-frame.ts";
import { decodeGraph, type JsonValue } from "../core/graph.ts";
import type { GraphDefinition } from "../core/graph-definition.ts";
import type {
  GraphFrame,
  OperationObservation,
  PlannedGraphOperation,
} from "../core/graph-frame.ts";
import type {
  EventKind,
  Run,
  RunDetail,
  RunEvent,
  RunStatus,
} from "../core/model.ts";
import {
  persistedNormalizationEvidenceExecutions,
  validateNormalizationEvidence,
} from "../fixtures/normalization.ts";
import { WorkspaceWriterLock } from "./writer-lock.ts";

type RunRow = {
  id: string;
  task_type: string;
  status: RunStatus;
  created_at: string;
  completed_at: string | null;
  outcome: string | null;
};

type EventRow = {
  sequence: number;
  run_id: string;
  kind: EventKind;
  occurred_at: string;
  payload_json: string;
};

type CommandReceiptRow = {
  command_id: string;
  payload_hash: string;
  run_id: string;
};

export type CommandReceipt = Readonly<{
  commandId: string;
  payloadHash: string;
  runId: string;
}>;

export const RUN_OWNERSHIP_LIMITS = Object.freeze({
  maxDepth: 4,
  maxChildren: 2,
});

export type OwnedRunChild = Readonly<{
  parentRunId: string;
  child: Run;
  spawnOrder: number;
}>;

export type ObservedOwnedChildOutcome = Readonly<{
  parentRunId: string;
  childRunId: string;
  status: Exclude<RunStatus, "running">;
  observedAt: string;
}>;

export type RunOperationAllocation = Readonly<{
  runId: string;
  maxOperations: number;
  reservedOperations: number;
  remainingOperations: number;
}>;

export type RunnableOperationPermit = Readonly<{
  rootRunId: string;
  holderRunId: string;
  operationId: string;
  acquiredAt: string;
}>;

export type RunUsageTotals = Readonly<{
  runId: string;
  knownUnits: number;
  unknownOperations: number;
}>;

export type M3CohortObservation = Readonly<{
  observationId: string;
  taskRef: string;
  split: "discovery" | "held-out";
  candidateRef: string;
  outcome: "success" | "failure";
  costUnits: number;
  recordedAt: string;
}>;

/** An M3 comparison row derived from durable provider and evaluator evidence. */
export type M3EvaluationCohortObservation = Readonly<{
  cohortRef: string;
  evaluationId: string;
  runId: string;
  providerAttemptId: string;
  taskRef: string;
  split: "development" | "held-out";
  variantRef: string;
  modelRef: string;
  configurationFingerprint: string;
  outcome: "success" | "failure";
  usage: JsonValue;
  terminalFingerprint: string;
  recordedAt: string;
}>;

export type ProviderAttemptLifecycle =
  | "planned"
  | "dispatched"
  | "completed"
  | "indeterminate";

export type ProviderAttempt = Readonly<{
  attemptId: string;
  runId: string;
  executorRef: string;
  requestId: string;
  modelRef: string;
  requestFingerprint: string;
  configurationFingerprint: string;
  lifecycle: ProviderAttemptLifecycle;
  terminal: JsonValue | null;
  failure: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
}>;

export type CreateProviderAttempt = Readonly<{
  attemptId: string;
  runId: string;
  executorRef: string;
  requestId: string;
  modelRef: string;
  requestFingerprint: string;
  configurationFingerprint: string;
  createdAt: string;
}>;

export type M3TaskEvaluation = Readonly<{
  evaluationId: string;
  runId: string;
  providerAttemptId: string | null;
  taskRef: string;
  split: "development" | "held-out";
  variantRef: string;
  source: JsonValue;
  sourceFingerprint: string;
  patch: JsonValue;
  patchFingerprint: string;
  evaluatorRef: string;
  evaluatorFingerprint: string;
  profileRef: string;
  candidateSourceFingerprint: string | null;
  outcome: "verified" | "rejected" | "failed" | "indeterminate";
  reason: string;
  command: JsonValue | null;
  recordedAt: string;
}>;

export type RecordM3TaskEvaluation = M3TaskEvaluation;

function providerUsage(terminal: JsonValue): JsonValue {
  if (
    terminal === null ||
    Array.isArray(terminal) ||
    typeof terminal !== "object"
  )
    throw new Error("M3 provider terminal artifact has an invalid shape");
  const usage = (terminal as Readonly<Record<string, JsonValue>>).usage;
  if (usage === undefined)
    throw new Error("M3 provider terminal artifact has no usage record");
  return usage;
}

export type GraphEvidence = Readonly<{
  evidenceId: string;
  evidenceKind: string;
  subjectRef: string;
  fingerprint: string;
  payload: JsonValue;
  admittedAt: string;
}>;

export type GraphDependency = Readonly<{
  proposalId: string;
  dependencyKind: string;
  dependencyRef: string;
}>;

export type GraphProposal = Readonly<{
  proposalId: string;
  headKey: string;
  baseGraphRef: string;
  candidateGraphRef: string;
  baseVersion: number;
  originRunId: string | null;
  status: "pending" | "committed" | "stale" | "suspended";
  createdAt: string;
  committedAt: string | null;
}>;

export type GraphProposalReceipt = Readonly<{
  receiptId: string;
  proposalId: string;
  headKey: string;
  baseVersion: number;
  candidateGraphRef: string;
  checkedFingerprint: string;
  dependencyStatusFingerprint: string;
  checkedAt: string;
  admissionPolicyRef: string | null;
  admittedOriginRunId: string | null;
  admittedGovernorRunId: string | null;
  admissionEvidenceFingerprint: string | null;
}>;

export type CompositionRelation = Readonly<{
  relationId: string;
  relationKind: string;
  leftRef: string;
  rightRef: string;
  status: "active" | "suspended" | "retired";
  scope: JsonValue;
  createdAt: string;
}>;

export type CompositionCheckpointView = Readonly<{
  checkpointId: string;
  refs: readonly string[];
  omitted: number;
  nextCursor: string | null;
}>;

export type CompositionCheckpoint = Readonly<{
  checkpointId: string;
  rootRef: string;
  cursor: string | null;
  refs: readonly string[];
  updatedAt: string;
}>;

export type GraphHead = Readonly<{
  headKey: string;
  graphRef: string;
  version: number;
  updatedAt: string;
}>;

export type GraphHeadStatus = Readonly<{
  headKey: string;
  status: "active" | "suspended";
  reason: string | null;
  changedAt: string;
}>;

export type SharedCompositionItem = Readonly<{
  kind: "head" | "proposal" | "relation";
  ref: string;
  status: string;
}>;

export type SharedCompositionView = Readonly<{
  revision: number;
  cursor: string | null;
  items: readonly SharedCompositionItem[];
  omitted: number;
  nextCursor: string | null;
}>;

export type PersistedGraphExecution = Readonly<{
  executionId: string;
  graphRef: string;
  revision: number;
  frame: GraphFrame;
  frameHash: ContentHash;
}>;

export type PersistGraphFrame = Readonly<{
  executionId: string;
  definition: GraphDefinition;
  frame: GraphFrame;
  expectedRevision: number | null;
  occurredAt: string;
}>;

export type PersistGraphOperationIntent = PersistGraphFrame &
  Readonly<{ operation: PlannedGraphOperation }>;

export type PersistRunGraphOperationIntent = PersistGraphOperationIntent &
  Readonly<{ runId: string }>;

export type PersistGraphOperationObservation = Readonly<{
  executionId: string;
  operationId: string;
  observation: OperationObservation;
  frame: GraphFrame;
  expectedRevision: number;
  occurredAt: string;
}>;

export type GraphOperationReconciliationAttribution = Readonly<{
  adapterRef: string;
  externalOperationId: string;
  evidence: JsonValue;
}>;

export type PersistReconciledGraphOperationObservation =
  PersistGraphOperationObservation &
    Readonly<{ attribution: GraphOperationReconciliationAttribution }>;

export type PendingGraphOutbox = Readonly<{
  operationId: string;
  executionId: string;
  payload: JsonValue;
}>;

export type GraphOperationLifecycle =
  | "planned"
  | "dispatched"
  | "observed"
  | "indeterminate";

export type GraphReconciliation = Readonly<{
  executionId: string;
  operations: readonly Readonly<{
    operationId: string;
    action: "dispatchable" | "indeterminate";
  }>[];
}>;

export type PinnedGraphArtifacts = Readonly<{
  definition: JsonValue;
  catalogue: JsonValue;
}>;

export class SqliteRunStore {
  readonly #database: Database;
  readonly #writerLock: WorkspaceWriterLock;
  #closed = false;

  private constructor(stateDirectory: string, writerLock: WorkspaceWriterLock) {
    this.#writerLock = writerLock;
    this.#database = new Database(join(stateDirectory, "government.sqlite"));
    try {
      this.#database.exec("PRAGMA journal_mode = WAL;");
      this.#database.exec("PRAGMA foreign_keys = ON;");
      this.#database.exec("PRAGMA busy_timeout = 5000;");
      this.applyMigrations();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  static async open(stateDirectory: string): Promise<SqliteRunStore> {
    mkdirSync(stateDirectory, { recursive: true });
    const writerLock = await WorkspaceWriterLock.acquire(stateDirectory);
    try {
      return new SqliteRunStore(stateDirectory, writerLock);
    } catch (error) {
      await writerLock.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#database.close();
    } finally {
      await this.#writerLock.close();
    }
  }

  schemaVersion(): number {
    const row = this.#database
      .query<{ version: number }, []>(
        "SELECT MAX(version) AS version FROM schema_migrations",
      )
      .get();
    return row?.version ?? 0;
  }

  createProviderAttempt(input: CreateProviderAttempt): void {
    this.#database.transaction(() => {
      this.requireRunningRun(input.runId);
      this.#database
        .query(
          "INSERT INTO provider_attempts (attempt_id, run_id, executor_ref, request_id, model_ref, request_fingerprint, configuration_fingerprint, lifecycle_state, terminal_json, failure, created_at, dispatched_at, completed_at) VALUES ($attemptId, $runId, $executorRef, $requestId, $modelRef, $requestFingerprint, $configurationFingerprint, 'planned', NULL, NULL, $createdAt, NULL, NULL)",
        )
        .run({
          $attemptId: input.attemptId,
          $runId: input.runId,
          $executorRef: input.executorRef,
          $requestId: input.requestId,
          $modelRef: input.modelRef,
          $requestFingerprint: input.requestFingerprint,
          $configurationFingerprint: input.configurationFingerprint,
          $createdAt: input.createdAt,
        });
      this.appendEvent(input.runId, "ProviderAttemptPlanned", input.createdAt, {
        attemptId: input.attemptId,
        executorRef: input.executorRef,
        requestId: input.requestId,
      });
    })();
  }

  markProviderAttemptDispatched(attemptId: string, occurredAt: string): void {
    this.#database.transaction(() => {
      const attempt = this.#database
        .query<{ run_id: string }, { $attemptId: string; $occurredAt: string }>(
          "UPDATE provider_attempts SET lifecycle_state = 'dispatched', dispatched_at = $occurredAt WHERE attempt_id = $attemptId AND lifecycle_state = 'planned' RETURNING run_id",
        )
        .get({ $attemptId: attemptId, $occurredAt: occurredAt });
      if (attempt === null)
        throw new Error(`provider attempt ${attemptId} is not planned`);
      this.appendEvent(
        attempt.run_id,
        "ProviderAttemptDispatched",
        occurredAt,
        { attemptId },
      );
    })();
  }

  completeProviderAttempt(
    attemptId: string,
    terminal: JsonValue,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      const attempt = this.#database
        .query<
          { run_id: string },
          { $attemptId: string; $terminal: string; $occurredAt: string }
        >(
          "UPDATE provider_attempts SET lifecycle_state = 'completed', terminal_json = $terminal, completed_at = $occurredAt WHERE attempt_id = $attemptId AND lifecycle_state = 'dispatched' RETURNING run_id",
        )
        .get({
          $attemptId: attemptId,
          $terminal: canonicalJson(terminal),
          $occurredAt: occurredAt,
        });
      if (attempt === null)
        throw new Error(`provider attempt ${attemptId} is not dispatched`);
      this.appendEvent(attempt.run_id, "ProviderAttemptCompleted", occurredAt, {
        attemptId,
      });
    })();
  }

  markProviderAttemptIndeterminate(
    attemptId: string,
    failure: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      const attempt = this.#database
        .query<
          { run_id: string },
          { $attemptId: string; $failure: string; $occurredAt: string }
        >(
          "UPDATE provider_attempts SET lifecycle_state = 'indeterminate', failure = $failure, completed_at = $occurredAt WHERE attempt_id = $attemptId AND lifecycle_state = 'dispatched' RETURNING run_id",
        )
        .get({
          $attemptId: attemptId,
          $failure: failure.slice(0, 4_096),
          $occurredAt: occurredAt,
        });
      if (attempt === null)
        throw new Error(`provider attempt ${attemptId} is not dispatched`);
      this.appendEvent(
        attempt.run_id,
        "ProviderAttemptIndeterminate",
        occurredAt,
        { attemptId },
      );
    })();
  }

  getProviderAttempt(attemptId: string): ProviderAttempt | null {
    const row = this.#database
      .query<
        {
          attempt_id: string;
          run_id: string;
          executor_ref: string;
          request_id: string;
          model_ref: string;
          request_fingerprint: string;
          configuration_fingerprint: string;
          lifecycle_state: ProviderAttemptLifecycle;
          terminal_json: string | null;
          failure: string | null;
          created_at: string;
          dispatched_at: string | null;
          completed_at: string | null;
        },
        { $attemptId: string }
      >(
        "SELECT attempt_id, run_id, executor_ref, request_id, model_ref, request_fingerprint, configuration_fingerprint, lifecycle_state, terminal_json, failure, created_at, dispatched_at, completed_at FROM provider_attempts WHERE attempt_id = $attemptId",
      )
      .get({ $attemptId: attemptId });
    if (row === null) return null;
    return {
      attemptId: row.attempt_id,
      runId: row.run_id,
      executorRef: row.executor_ref,
      requestId: row.request_id,
      modelRef: row.model_ref,
      requestFingerprint: row.request_fingerprint,
      configurationFingerprint: row.configuration_fingerprint,
      lifecycle: row.lifecycle_state,
      terminal:
        row.terminal_json === null
          ? null
          : (JSON.parse(row.terminal_json) as JsonValue),
      failure: row.failure,
      createdAt: row.created_at,
      dispatchedAt: row.dispatched_at,
      completedAt: row.completed_at,
    };
  }

  /** Recovery never replays a dispatched external request. */
  reconcileProviderAttempts(occurredAt: string): readonly ProviderAttempt[] {
    const dispatched = this.#database
      .query<{ attempt_id: string }, []>(
        "SELECT attempt_id FROM provider_attempts WHERE lifecycle_state = 'dispatched' ORDER BY created_at, attempt_id",
      )
      .all();
    for (const attempt of dispatched)
      this.markProviderAttemptIndeterminate(
        attempt.attempt_id,
        "provider attempt was interrupted before a durable terminal observation",
        occurredAt,
      );
    return dispatched
      .map((attempt) => this.getProviderAttempt(attempt.attempt_id))
      .filter((attempt): attempt is ProviderAttempt => attempt !== null);
  }

  recordM3TaskEvaluation(input: RecordM3TaskEvaluation): void {
    if (hashCanonicalJson(input.source) !== input.sourceFingerprint)
      throw new Error("M3 task evaluation source fingerprint does not match");
    if (hashCanonicalJson(input.patch) !== input.patchFingerprint)
      throw new Error("M3 task evaluation patch fingerprint does not match");
    this.#database.transaction(() => {
      this.requireRunningRun(input.runId);
      if (input.providerAttemptId !== null) {
        const attempt = this.#database
          .query<
            { run_id: string; lifecycle_state: ProviderAttemptLifecycle },
            { $attemptId: string }
          >(
            "SELECT run_id, lifecycle_state FROM provider_attempts WHERE attempt_id = $attemptId",
          )
          .get({ $attemptId: input.providerAttemptId });
        if (attempt === null)
          throw new Error(
            `M3 task evaluation provider attempt ${input.providerAttemptId} does not exist`,
          );
        if (attempt.run_id !== input.runId)
          throw new Error(
            "M3 task evaluation provider attempt belongs to another run",
          );
        if (attempt.lifecycle_state !== "completed")
          throw new Error(
            "M3 task evaluation requires a completed provider attempt",
          );
      }
      this.#database
        .query(
          "INSERT INTO m3_task_evaluations (evaluation_id, run_id, provider_attempt_id, task_ref, split, variant_ref, source_json, source_fingerprint, patch_json, patch_fingerprint, evaluator_ref, evaluator_fingerprint, profile_ref, candidate_source_fingerprint, outcome, reason, command_json, recorded_at) VALUES ($evaluationId, $runId, $providerAttemptId, $taskRef, $split, $variantRef, $source, $sourceFingerprint, $patch, $patchFingerprint, $evaluatorRef, $evaluatorFingerprint, $profileRef, $candidateSourceFingerprint, $outcome, $reason, $command, $recordedAt)",
        )
        .run({
          $evaluationId: input.evaluationId,
          $runId: input.runId,
          $providerAttemptId: input.providerAttemptId,
          $taskRef: input.taskRef,
          $split: input.split,
          $variantRef: input.variantRef,
          $source: canonicalJson(input.source),
          $sourceFingerprint: input.sourceFingerprint,
          $patch: canonicalJson(input.patch),
          $patchFingerprint: input.patchFingerprint,
          $evaluatorRef: input.evaluatorRef,
          $evaluatorFingerprint: input.evaluatorFingerprint,
          $profileRef: input.profileRef,
          $candidateSourceFingerprint: input.candidateSourceFingerprint,
          $outcome: input.outcome,
          $reason: input.reason,
          $command:
            input.command === null ? null : canonicalJson(input.command),
          $recordedAt: input.recordedAt,
        });
      this.appendEvent(
        input.runId,
        "M3TaskEvaluationRecorded",
        input.recordedAt,
        {
          evaluationId: input.evaluationId,
          taskRef: input.taskRef,
          outcome: input.outcome,
        },
      );
    })();
  }

  getM3TaskEvaluation(evaluationId: string): M3TaskEvaluation | null {
    const row = this.#database
      .query<
        {
          evaluation_id: string;
          run_id: string;
          provider_attempt_id: string | null;
          task_ref: string;
          split: M3TaskEvaluation["split"];
          variant_ref: string;
          source_json: string;
          source_fingerprint: string;
          patch_json: string;
          patch_fingerprint: string;
          evaluator_ref: string;
          evaluator_fingerprint: string;
          profile_ref: string;
          candidate_source_fingerprint: string | null;
          outcome: M3TaskEvaluation["outcome"];
          reason: string;
          command_json: string | null;
          recorded_at: string;
        },
        { $evaluationId: string }
      >(
        "SELECT evaluation_id, run_id, provider_attempt_id, task_ref, split, variant_ref, source_json, source_fingerprint, patch_json, patch_fingerprint, evaluator_ref, evaluator_fingerprint, profile_ref, candidate_source_fingerprint, outcome, reason, command_json, recorded_at FROM m3_task_evaluations WHERE evaluation_id = $evaluationId",
      )
      .get({ $evaluationId: evaluationId });
    if (row === null) return null;
    return {
      evaluationId: row.evaluation_id,
      runId: row.run_id,
      providerAttemptId: row.provider_attempt_id,
      taskRef: row.task_ref,
      split: row.split,
      variantRef: row.variant_ref,
      source: JSON.parse(row.source_json) as JsonValue,
      sourceFingerprint: row.source_fingerprint,
      patch: JSON.parse(row.patch_json) as JsonValue,
      patchFingerprint: row.patch_fingerprint,
      evaluatorRef: row.evaluator_ref,
      evaluatorFingerprint: row.evaluator_fingerprint,
      profileRef: row.profile_ref,
      candidateSourceFingerprint: row.candidate_source_fingerprint,
      outcome: row.outcome,
      reason: row.reason,
      command:
        row.command_json === null
          ? null
          : (JSON.parse(row.command_json) as JsonValue),
      recordedAt: row.recorded_at,
    };
  }

  recordM3EvaluationCohortObservation(
    cohortRef: string,
    evaluationId: string,
    recordedAt: string,
  ): M3EvaluationCohortObservation {
    if (!cohortRef.trim()) throw new Error("M3 cohort reference is required");
    const evaluation = this.getM3TaskEvaluation(evaluationId);
    if (evaluation === null)
      throw new Error(`M3 task evaluation ${evaluationId} does not exist`);
    if (evaluation.providerAttemptId === null)
      throw new Error("M3 cohort observation requires a provider attempt");
    const attempt = this.getProviderAttempt(evaluation.providerAttemptId);
    if (
      attempt === null ||
      attempt.lifecycle !== "completed" ||
      attempt.terminal === null
    )
      throw new Error(
        "M3 cohort observation requires a completed provider attempt",
      );
    const usage = providerUsage(attempt.terminal);
    const observation: M3EvaluationCohortObservation = {
      cohortRef,
      evaluationId: evaluation.evaluationId,
      runId: evaluation.runId,
      providerAttemptId: attempt.attemptId,
      taskRef: evaluation.taskRef,
      split: evaluation.split,
      variantRef: evaluation.variantRef,
      modelRef: attempt.modelRef,
      configurationFingerprint: attempt.configurationFingerprint,
      outcome: evaluation.outcome === "verified" ? "success" : "failure",
      usage,
      terminalFingerprint: hashCanonicalJson(attempt.terminal),
      recordedAt,
    };
    this.#database
      .query(
        "INSERT INTO m3_evaluation_cohort_observations (cohort_ref, evaluation_id, run_id, provider_attempt_id, task_ref, split, variant_ref, model_ref, configuration_fingerprint, outcome, usage_json, terminal_fingerprint, recorded_at) VALUES ($cohortRef, $evaluationId, $runId, $providerAttemptId, $taskRef, $split, $variantRef, $modelRef, $configurationFingerprint, $outcome, $usage, $terminalFingerprint, $recordedAt)",
      )
      .run({
        $cohortRef: observation.cohortRef,
        $evaluationId: observation.evaluationId,
        $runId: observation.runId,
        $providerAttemptId: observation.providerAttemptId,
        $taskRef: observation.taskRef,
        $split: observation.split,
        $variantRef: observation.variantRef,
        $modelRef: observation.modelRef,
        $configurationFingerprint: observation.configurationFingerprint,
        $outcome: observation.outcome,
        $usage: canonicalJson(observation.usage),
        $terminalFingerprint: observation.terminalFingerprint,
        $recordedAt: observation.recordedAt,
      });
    return observation;
  }

  listM3EvaluationCohortObservations(
    cohortRef: string,
  ): readonly M3EvaluationCohortObservation[] {
    return this.#database
      .query<
        {
          cohort_ref: string;
          evaluation_id: string;
          run_id: string;
          provider_attempt_id: string;
          task_ref: string;
          split: M3EvaluationCohortObservation["split"];
          variant_ref: string;
          model_ref: string;
          configuration_fingerprint: string;
          outcome: M3EvaluationCohortObservation["outcome"];
          usage_json: string;
          terminal_fingerprint: string;
          recorded_at: string;
        },
        { $cohortRef: string }
      >(
        "SELECT cohort_ref, evaluation_id, run_id, provider_attempt_id, task_ref, split, variant_ref, model_ref, configuration_fingerprint, outcome, usage_json, terminal_fingerprint, recorded_at FROM m3_evaluation_cohort_observations WHERE cohort_ref = $cohortRef ORDER BY task_ref, variant_ref",
      )
      .all({ $cohortRef: cohortRef })
      .map((row) => ({
        cohortRef: row.cohort_ref,
        evaluationId: row.evaluation_id,
        runId: row.run_id,
        providerAttemptId: row.provider_attempt_id,
        taskRef: row.task_ref,
        split: row.split,
        variantRef: row.variant_ref,
        modelRef: row.model_ref,
        configurationFingerprint: row.configuration_fingerprint,
        outcome: row.outcome,
        usage: JSON.parse(row.usage_json) as JsonValue,
        terminalFingerprint: row.terminal_fingerprint,
        recordedAt: row.recorded_at,
      }));
  }

  createRun(run: Run): void {
    this.#database.transaction(() => {
      this.#database
        .query(
          "INSERT INTO runs VALUES ($id, $taskType, $status, $createdAt, NULL, NULL)",
        )
        .run({
          $id: run.id,
          $taskType: run.taskType,
          $status: run.status,
          $createdAt: run.createdAt,
        });
      this.appendEvent(run.id, "RunRequested", run.createdAt, {
        taskType: run.taskType,
      });
    })();
  }

  createRunWithOperationAllocation(run: Run, maxOperations: number): void {
    validateOperationAllocation(maxOperations);
    this.#database.transaction(() => {
      this.insertRun(run);
      this.requireRunningRun(run.id);
      this.insertRunOperationAllocation(run.id, maxOperations, run.createdAt);
    })();
  }

  createRunWithReceipt(run: Run, receipt: CommandReceipt): void {
    this.#database.transaction(() => {
      this.insertRun(run);
      this.#database
        .query(
          "INSERT INTO command_receipts (command_id, payload_hash, run_id, created_at) VALUES ($commandId, $payloadHash, $runId, $createdAt)",
        )
        .run({
          $commandId: receipt.commandId,
          $payloadHash: receipt.payloadHash,
          $runId: receipt.runId,
          $createdAt: run.createdAt,
        });
    })();
  }

  createOwnedChildRun(parentRunId: string, child: Run): void {
    this.#database.transaction(() => {
      this.insertOwnedChildRun(parentRunId, child, null);
    })();
  }

  createOwnedChildRunWithOperationAllocation(
    parentRunId: string,
    child: Run,
    maxOperations: number,
  ): void {
    validateOperationAllocation(maxOperations);
    this.#database.transaction(() => {
      this.insertOwnedChildRun(parentRunId, child, maxOperations);
    })();
  }

  listOwnedChildren(parentRunId: string): readonly OwnedRunChild[] {
    return this.#database
      .query<
        RunRow & { parent_run_id: string; spawn_order: number },
        { $parentRunId: string }
      >(
        "SELECT runs.*, run_ownership.parent_run_id, run_ownership.spawn_order FROM run_ownership JOIN runs ON runs.id = run_ownership.child_run_id WHERE run_ownership.parent_run_id = $parentRunId ORDER BY run_ownership.spawn_order",
      )
      .all({ $parentRunId: parentRunId })
      .map((row) => ({
        parentRunId: row.parent_run_id,
        child: toRun(row),
        spawnOrder: row.spawn_order,
      }));
  }

  acquireRunnableOperationPermit(
    runId: string,
    operationId: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      this.requireRunningRun(runId);
      const rootRunId = this.rootRunId(runId);
      this.#database
        .query(
          "INSERT INTO runnable_operation_permits (root_run_id, holder_run_id, operation_id, acquired_at) VALUES ($rootRunId, $holderRunId, $operationId, $occurredAt)",
        )
        .run({
          $rootRunId: rootRunId,
          $holderRunId: runId,
          $operationId: operationId,
          $occurredAt: occurredAt,
        });
      this.appendEvent(runId, "RunnableOperationPermitAcquired", occurredAt, {
        rootRunId,
        operationId,
      });
    })();
  }

  releaseRunnableOperationPermit(
    runId: string,
    operationId: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      this.requireRunningRun(runId);
      const rootRunId = this.rootRunId(runId);
      const released = this.#database
        .query(
          "DELETE FROM runnable_operation_permits WHERE root_run_id = $rootRunId AND holder_run_id = $holderRunId AND operation_id = $operationId",
        )
        .run({
          $rootRunId: rootRunId,
          $holderRunId: runId,
          $operationId: operationId,
        });
      if (released.changes !== 1)
        throw new Error(`run ${runId} does not hold runnable operation permit`);
      this.appendEvent(runId, "RunnableOperationPermitReleased", occurredAt, {
        rootRunId,
        operationId,
      });
    })();
  }

  getRunnableOperationPermit(runId: string): RunnableOperationPermit | null {
    const rootRunId = this.rootRunId(runId);
    const row = this.#database
      .query<
        {
          root_run_id: string;
          holder_run_id: string;
          operation_id: string;
          acquired_at: string;
        },
        { $rootRunId: string }
      >(
        "SELECT root_run_id, holder_run_id, operation_id, acquired_at FROM runnable_operation_permits WHERE root_run_id = $rootRunId",
      )
      .get({ $rootRunId: rootRunId });
    return row === null
      ? null
      : {
          rootRunId: row.root_run_id,
          holderRunId: row.holder_run_id,
          operationId: row.operation_id,
          acquiredAt: row.acquired_at,
        };
  }

  getCommandReceipt(commandId: string): CommandReceipt | null {
    const row = this.#database
      .query<CommandReceiptRow, { $commandId: string }>(
        "SELECT command_id, payload_hash, run_id FROM command_receipts WHERE command_id = $commandId",
      )
      .get({ $commandId: commandId });
    return row === null
      ? null
      : {
          commandId: row.command_id,
          payloadHash: row.payload_hash,
          runId: row.run_id,
        };
  }

  appendEvent(
    runId: string,
    kind: EventKind,
    occurredAt: string,
    payload: Record<string, string>,
  ): void {
    this.#database
      .query(
        "INSERT INTO run_events (run_id, kind, occurred_at, payload_json) VALUES ($runId, $kind, $occurredAt, $payload)",
      )
      .run({
        $runId: runId,
        $kind: kind,
        $occurredAt: occurredAt,
        $payload: JSON.stringify(payload),
      });
  }

  observeOwnedChildOutcome(
    parentRunId: string,
    childRunId: string,
    observedAt: string,
  ): void {
    this.#database.transaction(() => {
      this.requireRunningRun(parentRunId);
      const child = this.#database
        .query<
          { status: RunStatus },
          { $parentRunId: string; $childRunId: string }
        >(
          "SELECT runs.status FROM run_ownership JOIN runs ON runs.id = run_ownership.child_run_id WHERE run_ownership.parent_run_id = $parentRunId AND run_ownership.child_run_id = $childRunId",
        )
        .get({ $parentRunId: parentRunId, $childRunId: childRunId });
      if (child === null)
        throw new Error(
          `run ${childRunId} is not owned by parent ${parentRunId}`,
        );
      if (child.status === "running")
        throw new Error(`owned child ${childRunId} is still running`);
      this.#database
        .query(
          "INSERT INTO run_child_outcome_observations (parent_run_id, child_run_id, observed_status, observed_at) VALUES ($parentRunId, $childRunId, $status, $observedAt)",
        )
        .run({
          $parentRunId: parentRunId,
          $childRunId: childRunId,
          $status: child.status,
          $observedAt: observedAt,
        });
      this.appendEvent(parentRunId, "RunChildOutcomeObserved", observedAt, {
        childRunId,
        status: child.status,
      });
    })();
  }

  listObservedOwnedChildOutcomes(
    parentRunId: string,
  ): readonly ObservedOwnedChildOutcome[] {
    return this.#database
      .query<
        {
          parent_run_id: string;
          child_run_id: string;
          observed_status: Exclude<RunStatus, "running">;
          observed_at: string;
        },
        { $parentRunId: string }
      >(
        "SELECT parent_run_id, child_run_id, observed_status, observed_at FROM run_child_outcome_observations WHERE parent_run_id = $parentRunId ORDER BY observed_at, child_run_id",
      )
      .all({ $parentRunId: parentRunId })
      .map((row) => ({
        parentRunId: row.parent_run_id,
        childRunId: row.child_run_id,
        status: row.observed_status,
        observedAt: row.observed_at,
      }));
  }

  completeRun(
    id: string,
    status: Exclude<RunStatus, "running">,
    outcome: string | null,
    completedAt: string,
  ): void {
    this.#database.transaction(() => {
      if (this.hasActiveOwnedChild(id))
        throw new Error(`run ${id} has an active owned child`);
      const propagated =
        status === "succeeded" ? this.firstUnobservedNonSuccessChild(id) : null;
      const settledStatus: Exclude<RunStatus, "running"> =
        propagated === null ? status : "failed";
      const settledOutcome =
        propagated === null
          ? outcome
          : `owned child ${propagated.childRunId} ${propagated.status}`;
      const result = this.#database
        .query(
          "UPDATE runs SET status = $status, completed_at = $completedAt, outcome = $outcome WHERE id = $id AND status = 'running' AND NOT EXISTS (SELECT 1 FROM run_ownership JOIN runs AS child ON child.id = run_ownership.child_run_id WHERE run_ownership.parent_run_id = $id AND child.status = 'running')",
        )
        .run({
          $id: id,
          $status: settledStatus,
          $completedAt: completedAt,
          $outcome: settledOutcome,
        });
      if (result.changes !== 1) {
        if (this.hasActiveOwnedChild(id))
          throw new Error(`run ${id} has an active owned child`);
        throw new Error(`run ${id} is not running`);
      }
      if (propagated !== null) {
        const payload = {
          childRunId: propagated.childRunId,
          status: propagated.status,
          spawnOrder: String(propagated.spawnOrder),
        };
        this.appendEvent(id, "RunChildOutcomePropagated", completedAt, payload);
        this.appendEvent(id, "RunFailed", completedAt, {
          ...payload,
          outcome: settledOutcome ?? "",
        });
        return;
      }
      this.appendEvent(
        id,
        eventKindForTerminalStatus(settledStatus),
        completedAt,
        settledOutcome === null ? {} : { outcome: settledOutcome },
      );
    })();
  }

  getRun(id: string): RunDetail | null {
    const row = this.#database
      .query<RunRow, { $id: string }>("SELECT * FROM runs WHERE id = $id")
      .get({ $id: id });
    return row === null
      ? null
      : { run: toRun(row), events: this.eventsFor(id) };
  }

  listRuns(): readonly Run[] {
    return this.#database
      .query<RunRow, []>("SELECT * FROM runs ORDER BY created_at DESC")
      .all()
      .map(toRun);
  }

  /* Migrations are additive; version 1 is the original M0 schema. */
  private applyMigrations(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const migrations: readonly string[] = [
      `
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        outcome TEXT
      );
      CREATE TABLE IF NOT EXISTS run_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        kind TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_receipts (
        command_id TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id),
        created_at TEXT NOT NULL
      );
      `,
      `
      CREATE TABLE IF NOT EXISTS graph_catalogues (
        ref TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        canonical_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_definitions (
        ref TEXT PRIMARY KEY,
        catalogue_ref TEXT NOT NULL REFERENCES graph_catalogues(ref),
        content_hash TEXT NOT NULL,
        canonical_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_executions (
        execution_id TEXT PRIMARY KEY,
        graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
        frame_hash TEXT NOT NULL,
        frame_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_operations (
        operation_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES graph_executions(execution_id),
        attempt_id TEXT,
        abstraction_ref TEXT NOT NULL,
        input_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('planned', 'observed')),
        observation_json TEXT,
        created_at TEXT NOT NULL,
        observed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS graph_outbox (
        operation_id TEXT PRIMARY KEY REFERENCES graph_operations(operation_id),
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'observed')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_operation_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL REFERENCES graph_executions(execution_id),
        operation_id TEXT NOT NULL REFERENCES graph_operations(operation_id),
        kind TEXT NOT NULL CHECK (kind IN ('planned', 'observed')),
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      `,
      `ALTER TABLE graph_executions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;`,
      `
        ALTER TABLE graph_catalogues ADD COLUMN encoding_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE graph_definitions ADD COLUMN encoding_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE graph_executions ADD COLUMN frame_encoding_version INTEGER NOT NULL DEFAULT 1;
      `,
      `
        ALTER TABLE graph_operations ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'planned' CHECK (lifecycle_state IN ('planned', 'dispatched', 'observed', 'indeterminate'));
        ALTER TABLE graph_outbox ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'pending' CHECK (lifecycle_state IN ('pending', 'dispatched', 'observed', 'indeterminate'));
        CREATE TABLE IF NOT EXISTS graph_operation_lifecycle_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL REFERENCES graph_executions(execution_id),
          operation_id TEXT NOT NULL REFERENCES graph_operations(operation_id),
          kind TEXT NOT NULL CHECK (kind IN ('dispatched', 'indeterminate')),
          occurred_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS graph_operation_reconciliations (
          operation_id TEXT PRIMARY KEY REFERENCES graph_operations(operation_id),
          adapter_ref TEXT NOT NULL,
          external_operation_id TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          UNIQUE (adapter_ref, external_operation_id)
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS run_ownership (
          child_run_id TEXT PRIMARY KEY REFERENCES runs(id),
          parent_run_id TEXT NOT NULL REFERENCES runs(id),
          spawn_order INTEGER NOT NULL CHECK (spawn_order > 0),
          created_at TEXT NOT NULL,
          UNIQUE (parent_run_id, spawn_order),
          CHECK (child_run_id <> parent_run_id)
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS run_graph_executions (
          run_id TEXT PRIMARY KEY REFERENCES runs(id),
          execution_id TEXT NOT NULL UNIQUE REFERENCES graph_executions(execution_id),
          attached_at TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS run_child_outcome_observations (
          child_run_id TEXT PRIMARY KEY REFERENCES runs(id),
          parent_run_id TEXT NOT NULL REFERENCES runs(id),
          observed_status TEXT NOT NULL CHECK (observed_status IN ('succeeded', 'cancelled', 'failed')),
          observed_at TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS run_operation_allocations (
          run_id TEXT PRIMARY KEY REFERENCES runs(id),
          max_operations INTEGER NOT NULL CHECK (max_operations >= 0),
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_operation_reservations (
          operation_id TEXT PRIMARY KEY REFERENCES graph_operations(operation_id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          created_at TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS runnable_operation_permits (
          root_run_id TEXT PRIMARY KEY REFERENCES runs(id),
          holder_run_id TEXT NOT NULL REFERENCES runs(id),
          operation_id TEXT NOT NULL,
          acquired_at TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS graph_operation_usage (
          operation_id TEXT PRIMARY KEY REFERENCES graph_operations(operation_id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          usage_units INTEGER,
          usage_known INTEGER NOT NULL CHECK (usage_known IN (0, 1)),
          recorded_at TEXT NOT NULL,
          CHECK ((usage_known = 0 AND usage_units IS NULL) OR (usage_known = 1 AND usage_units IS NOT NULL AND usage_units >= 0))
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS graph_heads (
          head_key TEXT PRIMARY KEY,
          graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
          version INTEGER NOT NULL CHECK (version >= 0),
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_head_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          head_key TEXT NOT NULL REFERENCES graph_heads(head_key),
          version INTEGER NOT NULL CHECK (version >= 0),
          graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
          occurred_at TEXT NOT NULL,
          UNIQUE (head_key, version)
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS graph_proposals (
          proposal_id TEXT PRIMARY KEY,
          head_key TEXT NOT NULL REFERENCES graph_heads(head_key),
          base_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
          candidate_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
          base_version INTEGER NOT NULL CHECK (base_version >= 0),
          origin_run_id TEXT REFERENCES runs(id),
          status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'stale', 'suspended')),
          created_at TEXT NOT NULL,
          committed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS graph_proposal_receipts (
          receipt_id TEXT PRIMARY KEY,
          proposal_id TEXT NOT NULL UNIQUE REFERENCES graph_proposals(proposal_id),
          head_key TEXT NOT NULL REFERENCES graph_heads(head_key),
          base_version INTEGER NOT NULL CHECK (base_version >= 0),
          candidate_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
          checked_fingerprint TEXT NOT NULL,
          checked_at TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS graph_proposal_dependencies (
          proposal_id TEXT NOT NULL REFERENCES graph_proposals(proposal_id),
          dependency_kind TEXT NOT NULL,
          dependency_ref TEXT NOT NULL,
          PRIMARY KEY (proposal_id, dependency_kind, dependency_ref)
        );
        CREATE INDEX graph_proposal_dependencies_reverse
          ON graph_proposal_dependencies (dependency_ref, proposal_id);
      `,
      `
        CREATE TABLE IF NOT EXISTS graph_dependency_statuses (
          dependency_ref TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'retired')),
          reason TEXT,
          fingerprint TEXT NOT NULL,
          changed_at TEXT NOT NULL
        );
      `,
      `ALTER TABLE graph_proposal_receipts ADD COLUMN dependency_status_fingerprint TEXT NOT NULL DEFAULT '';`,
      `
        CREATE TABLE IF NOT EXISTS graph_evidence (
          evidence_id TEXT PRIMARY KEY,
          evidence_kind TEXT NOT NULL,
          subject_ref TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          admitted_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_proposal_evidence (
          proposal_id TEXT NOT NULL REFERENCES graph_proposals(proposal_id),
          evidence_id TEXT NOT NULL REFERENCES graph_evidence(evidence_id),
          PRIMARY KEY (proposal_id, evidence_id)
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS composition_checkpoints (
          checkpoint_id TEXT PRIMARY KEY,
          root_ref TEXT NOT NULL,
          cursor TEXT,
          refs_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS composition_relations (
          relation_id TEXT PRIMARY KEY,
          relation_kind TEXT NOT NULL,
          left_ref TEXT NOT NULL,
          right_ref TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'retired')),
          scope_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS composition_relations_lookup
          ON composition_relations (left_ref, right_ref, relation_kind);
      `,
      `
        CREATE TABLE IF NOT EXISTS m3_cohort_observations (
          observation_id TEXT PRIMARY KEY,
          task_ref TEXT NOT NULL,
          split TEXT NOT NULL CHECK (split IN ('discovery', 'held-out')),
          candidate_ref TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
          cost_units REAL NOT NULL CHECK (cost_units >= 0),
          recorded_at TEXT NOT NULL,
          UNIQUE (task_ref, split, candidate_ref)
        );
      `,
      // v22 uses the transactional compatibility repair below.
      "",
      `
        ALTER TABLE graph_proposal_receipts ADD COLUMN admission_policy_ref TEXT;
        ALTER TABLE graph_proposal_receipts ADD COLUMN admitted_origin_run_id TEXT REFERENCES runs(id);
        ALTER TABLE graph_proposal_receipts ADD COLUMN admitted_governor_run_id TEXT REFERENCES runs(id);
        ALTER TABLE graph_proposal_receipts ADD COLUMN admission_evidence_fingerprint TEXT;
      `,
      `
        CREATE TABLE graph_head_dependencies (
          head_key TEXT NOT NULL REFERENCES graph_heads(head_key),
          dependency_ref TEXT NOT NULL,
          PRIMARY KEY (head_key, dependency_ref)
        );
        CREATE INDEX graph_head_dependencies_reverse
          ON graph_head_dependencies (dependency_ref, head_key);
        CREATE TABLE graph_head_statuses (
          head_key TEXT PRIMARY KEY REFERENCES graph_heads(head_key),
          status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
          reason TEXT,
          changed_at TEXT NOT NULL
        );
        INSERT INTO graph_head_statuses (head_key, status, reason, changed_at)
          SELECT head_key, 'active', NULL, updated_at FROM graph_heads WHERE 1
          ON CONFLICT(head_key) DO NOTHING;
        INSERT INTO graph_head_dependencies (head_key, dependency_ref)
          SELECT p.head_key, d.dependency_ref
          FROM graph_proposals p
          JOIN graph_proposal_dependencies d ON d.proposal_id = p.proposal_id
          WHERE p.status = 'committed'
          ON CONFLICT(head_key, dependency_ref) DO NOTHING;
      `,
      `
        CREATE TABLE composition_projection_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          subject_ref TEXT NOT NULL,
          occurred_at TEXT NOT NULL
        );
        INSERT INTO composition_projection_events (kind, subject_ref, occurred_at)
          SELECT 'head-restored', head_key, updated_at FROM graph_heads;
      `,
      `
        CREATE TABLE provider_attempts (
          attempt_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id),
          executor_ref TEXT NOT NULL,
          request_id TEXT NOT NULL UNIQUE,
          model_ref TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          configuration_fingerprint TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('planned', 'dispatched', 'completed', 'indeterminate')),
          terminal_json TEXT,
          failure TEXT,
          created_at TEXT NOT NULL,
          dispatched_at TEXT,
          completed_at TEXT
        );
        CREATE INDEX provider_attempts_recovery
          ON provider_attempts (lifecycle_state, created_at);
      `,
      `
        CREATE TABLE m3_task_evaluations (
          evaluation_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id),
          provider_attempt_id TEXT REFERENCES provider_attempts(attempt_id),
          task_ref TEXT NOT NULL,
          split TEXT NOT NULL CHECK (split IN ('development', 'held-out')),
          variant_ref TEXT NOT NULL,
          source_json TEXT NOT NULL,
          source_fingerprint TEXT NOT NULL,
          patch_json TEXT NOT NULL,
          patch_fingerprint TEXT NOT NULL,
          evaluator_ref TEXT NOT NULL,
          evaluator_fingerprint TEXT NOT NULL,
          profile_ref TEXT NOT NULL,
          candidate_source_fingerprint TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('verified', 'rejected', 'failed', 'indeterminate')),
          reason TEXT NOT NULL,
          command_json TEXT,
          recorded_at TEXT NOT NULL
        );
        CREATE INDEX m3_task_evaluations_task
          ON m3_task_evaluations (task_ref, split, variant_ref, recorded_at);
      `,
      `
        CREATE TABLE m3_evaluation_cohort_observations (
          cohort_ref TEXT NOT NULL,
          evaluation_id TEXT NOT NULL REFERENCES m3_task_evaluations(evaluation_id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          provider_attempt_id TEXT NOT NULL REFERENCES provider_attempts(attempt_id),
          task_ref TEXT NOT NULL,
          split TEXT NOT NULL CHECK (split IN ('development', 'held-out')),
          variant_ref TEXT NOT NULL,
          model_ref TEXT NOT NULL,
          configuration_fingerprint TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
          usage_json TEXT NOT NULL,
          terminal_fingerprint TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (cohort_ref, evaluation_id),
          UNIQUE (cohort_ref, task_ref, variant_ref)
        );
        CREATE INDEX m3_evaluation_cohort_observations_lookup
          ON m3_evaluation_cohort_observations (cohort_ref, split, task_ref, variant_ref);
      `,
      `
        CREATE TABLE run_graph_executions_rebuilt (
          run_id TEXT NOT NULL REFERENCES runs(id),
          execution_id TEXT NOT NULL UNIQUE REFERENCES graph_executions(execution_id),
          attached_at TEXT NOT NULL,
          PRIMARY KEY (run_id, execution_id)
        );
        INSERT INTO run_graph_executions_rebuilt
          SELECT run_id, execution_id, attached_at FROM run_graph_executions;
        DROP TABLE run_graph_executions;
        ALTER TABLE run_graph_executions_rebuilt RENAME TO run_graph_executions;
        CREATE INDEX run_graph_executions_by_run
          ON run_graph_executions (run_id, attached_at, execution_id);
      `,
    ];
    // v22 repairs historical layouts whose v18/v19 numbers meant different tables.
    // Never renumber those migrations: inspect/create the displaced tables instead.
    const latestVersion = migrations.length;
    const current = this.schemaVersion();
    if (current > latestVersion)
      throw new Error(`unsupported database schema version: ${current}`);
    for (let index = current; index < latestVersion; index += 1) {
      const version = index + 1;
      const repair = version === 22;
      const migration = migrations[index];
      if (migration === undefined && !repair)
        throw new Error(`missing database migration: ${version}`);
      // SQLite requires this outside the transaction for a parent-table rebuild.
      // The writer lock is held, and foreign keys are checked before committing.
      if (repair) this.#database.exec("PRAGMA foreign_keys = OFF");
      try {
        this.#database.transaction(() => {
          if (repair) {
            this.#database.exec(migrations.slice(17, 20).join("\n"));
            this.#database.exec(`
            CREATE TABLE graph_proposals_rebuilt (
              proposal_id TEXT PRIMARY KEY,
              head_key TEXT NOT NULL REFERENCES graph_heads(head_key),
              base_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
              candidate_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
              base_version INTEGER NOT NULL CHECK (base_version >= 0),
              origin_run_id TEXT REFERENCES runs(id),
              status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'stale', 'suspended')),
              created_at TEXT NOT NULL,
              committed_at TEXT
            );
            INSERT INTO graph_proposals_rebuilt SELECT
              proposal_id, head_key, base_graph_ref, candidate_graph_ref,
              base_version, origin_run_id, status, created_at, committed_at
              FROM graph_proposals;
            DROP TABLE graph_proposals;
            ALTER TABLE graph_proposals_rebuilt RENAME TO graph_proposals;
          `);
            if (
              this.#database.query("PRAGMA foreign_key_check").all().length > 0
            )
              throw new Error("database migration foreign key check failed");
          } else if (migration !== undefined) this.#database.exec(migration);
          this.#database
            .query(
              "INSERT INTO schema_migrations (version, applied_at) VALUES ($version, $appliedAt)",
            )
            .run({ $version: version, $appliedAt: new Date().toISOString() });
        })();
      } finally {
        if (repair) this.#database.exec("PRAGMA foreign_keys = ON");
      }
    }
  }

  createCompositionRelation(input: {
    relationId: string;
    relationKind: string;
    leftRef: string;
    rightRef: string;
    status?: "active" | "suspended" | "retired";
    scope: JsonValue;
    createdAt: string;
  }): void {
    const scopeJson = JSON.stringify(input.scope);
    if (Buffer.byteLength(scopeJson, "utf8") > 4096)
      throw new Error("composition relation scope exceeds 4 KiB");
    this.#database.transaction(() => {
      this.#database
        .query(
          "INSERT INTO composition_relations (relation_id, relation_kind, left_ref, right_ref, status, scope_json, created_at) VALUES ($relationId, $relationKind, $leftRef, $rightRef, $status, $scopeJson, $createdAt)",
        )
        .run({
          $relationId: input.relationId,
          $relationKind: input.relationKind,
          $leftRef: input.leftRef,
          $rightRef: input.rightRef,
          $status: input.status ?? "active",
          $scopeJson: scopeJson,
          $createdAt: input.createdAt,
        });
      this.appendCompositionProjectionEvent(
        "relation-created",
        input.relationId,
        input.createdAt,
      );
    })();
  }

  getCompositionRelation(relationId: string): CompositionRelation | null {
    const row = this.#database
      .query<
        {
          relation_id: string;
          relation_kind: string;
          left_ref: string;
          right_ref: string;
          status: "active" | "suspended" | "retired";
          scope_json: string;
          created_at: string;
        },
        { $relationId: string }
      >(
        "SELECT relation_id, relation_kind, left_ref, right_ref, status, scope_json, created_at FROM composition_relations WHERE relation_id = $relationId",
      )
      .get({ $relationId: relationId });
    if (row === null) return null;
    return {
      relationId: row.relation_id,
      relationKind: row.relation_kind,
      leftRef: row.left_ref,
      rightRef: row.right_ref,
      status: row.status,
      scope: JSON.parse(row.scope_json) as JsonValue,
      createdAt: row.created_at,
    };
  }

  listCompositionRelations(
    leftRef: string,
    rightRef: string,
  ): readonly CompositionRelation[] {
    return this.#database
      .query<
        {
          relation_id: string;
          relation_kind: string;
          left_ref: string;
          right_ref: string;
          status: "active" | "suspended" | "retired";
          scope_json: string;
          created_at: string;
        },
        { $leftRef: string; $rightRef: string }
      >(
        "SELECT relation_id, relation_kind, left_ref, right_ref, status, scope_json, created_at FROM composition_relations WHERE left_ref = $leftRef AND right_ref = $rightRef ORDER BY relation_id",
      )
      .all({ $leftRef: leftRef, $rightRef: rightRef })
      .map((row) => ({
        relationId: row.relation_id,
        relationKind: row.relation_kind,
        leftRef: row.left_ref,
        rightRef: row.right_ref,
        status: row.status,
        scope: JSON.parse(row.scope_json) as JsonValue,
        createdAt: row.created_at,
      }));
  }

  saveCompositionCheckpoint(input: {
    checkpointId: string;
    rootRef: string;
    cursor: string | null;
    refs: readonly string[];
    updatedAt: string;
  }): void {
    const refs = this.validateCompositionCheckpointDescriptor(input);
    const refsJson = JSON.stringify(refs);
    this.#database
      .query(
        "INSERT INTO composition_checkpoints (checkpoint_id, root_ref, cursor, refs_json, updated_at) VALUES ($checkpointId, $rootRef, $cursor, $refsJson, $updatedAt) ON CONFLICT(checkpoint_id) DO UPDATE SET root_ref = excluded.root_ref, cursor = excluded.cursor, refs_json = excluded.refs_json, updated_at = excluded.updated_at",
      )
      .run({
        $checkpointId: input.checkpointId,
        $rootRef: input.rootRef,
        $cursor: input.cursor,
        $refsJson: refsJson,
        $updatedAt: input.updatedAt,
      });
  }

  getCompositionCheckpoint(checkpointId: string): CompositionCheckpoint | null {
    const row = this.#database
      .query<
        {
          checkpoint_id: string;
          root_ref: string;
          cursor: string | null;
          refs_json: string;
          updated_at: string;
        },
        { $checkpointId: string }
      >(
        "SELECT checkpoint_id, root_ref, cursor, refs_json, updated_at FROM composition_checkpoints WHERE checkpoint_id = $checkpointId",
      )
      .get({ $checkpointId: checkpointId });
    if (row === null) return null;
    let refs: unknown;
    try {
      refs = JSON.parse(row.refs_json);
    } catch {
      throw new Error("stored composition checkpoint refs are invalid JSON");
    }
    if (
      !Array.isArray(refs) ||
      refs.some((ref): ref is string => typeof ref !== "string")
    )
      throw new Error("stored composition checkpoint refs are invalid");
    try {
      this.validateCompositionCheckpointDescriptor({
        rootRef: row.root_ref,
        cursor: row.cursor,
        refs,
      });
    } catch {
      throw new Error(
        "stored composition checkpoint violates bounded descriptor",
      );
    }
    return {
      checkpointId: row.checkpoint_id,
      rootRef: row.root_ref,
      cursor: row.cursor,
      refs,
      updatedAt: row.updated_at,
    };
  }

  getCompositionCheckpointView(
    checkpointId: string,
    start = 0,
    limit = 32,
  ): CompositionCheckpointView | null {
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error("composition view start must be a non-negative integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
      throw new Error("composition view limit must be between 1 and 32");
    const checkpoint = this.getCompositionCheckpoint(checkpointId);
    if (checkpoint === null) return null;
    const refs = checkpoint.refs.slice(start, start + limit);
    const omitted = checkpoint.refs.length - start - refs.length;
    const nextCursor = omitted > 0 ? String(start + refs.length) : null;
    const view = { checkpointId, refs, omitted, nextCursor };
    if (Buffer.byteLength(JSON.stringify(view), "utf8") > 16 * 1024)
      throw new Error("composition checkpoint view exceeds 16 KiB");
    return view;
  }

  /** A bounded read-only view derived from authoritative registry records. */
  getSharedCompositionView(start = 0, limit = 32): SharedCompositionView {
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error(
        "shared composition view start must be a non-negative integer",
      );
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
      throw new Error("shared composition view limit must be between 1 and 32");
    return this.#database.transaction(() => {
      const heads = this.#database
        .query<{ head_key: string; status: string }, []>(
          "SELECT h.head_key, s.status FROM graph_heads h JOIN graph_head_statuses s ON s.head_key = h.head_key",
        )
        .all()
        .map((row) => ({
          kind: "head" as const,
          ref: row.head_key,
          status: row.status,
        }));
      const proposals = this.#database
        .query<{ proposal_id: string; status: string }, []>(
          "SELECT proposal_id, status FROM graph_proposals WHERE status IN ('pending', 'suspended')",
        )
        .all()
        .map((row) => ({
          kind: "proposal" as const,
          ref: row.proposal_id,
          status: row.status,
        }));
      const relations = this.#database
        .query<{ relation_id: string; status: string }, []>(
          "SELECT relation_id, status FROM composition_relations",
        )
        .all()
        .map((row) => ({
          kind: "relation" as const,
          ref: row.relation_id,
          status: row.status,
        }));
      const items = [...heads, ...proposals, ...relations].sort(
        (left, right) => {
          const kindOrder =
            left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0;
          return (
            kindOrder ||
            (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0)
          );
        },
      );
      const event = this.#database
        .query<{ sequence: number }, []>(
          "SELECT MAX(sequence) AS sequence FROM composition_projection_events",
        )
        .get();
      const revision = event?.sequence ?? 0;
      const cursor = event === null ? null : String(event.sequence);
      const remainingItems = items.slice(start);
      const page: SharedCompositionItem[] = [];
      for (
        let index = 0;
        index < remainingItems.length && page.length < limit;
        index += 1
      ) {
        const item = remainingItems[index];
        if (item === undefined) break;
        const candidatePage = [...page, item];
        const omitted = remainingItems.length - candidatePage.length;
        const nextCursor =
          omitted > 0 ? String(start + candidatePage.length) : null;
        const encoded = canonicalJson({
          cursor,
          items: candidatePage,
          nextCursor,
          omitted,
          revision,
        });
        if (Buffer.byteLength(encoded, "utf8") > 16 * 1024) {
          if (page.length === 0)
            throw new Error("shared composition item exceeds 16 KiB");
          break;
        }
        page.push(item);
      }
      const omitted = remainingItems.length - page.length;
      return {
        revision,
        cursor,
        items: page,
        omitted,
        nextCursor: omitted > 0 ? String(start + page.length) : null,
      };
    })();
  }

  private appendCompositionProjectionEvent(
    kind: string,
    subjectRef: string,
    occurredAt: string,
  ): void {
    this.#database
      .query(
        "INSERT INTO composition_projection_events (kind, subject_ref, occurred_at) VALUES ($kind, $subjectRef, $occurredAt)",
      )
      .run({ $kind: kind, $subjectRef: subjectRef, $occurredAt: occurredAt });
  }

  private proposalDependencyStatusFingerprint(proposalId: string): string {
    return this.#database
      .query<
        { dependency_ref: string; status: string; fingerprint: string },
        { $proposalId: string }
      >(
        "SELECT d.dependency_ref, s.status, s.fingerprint FROM graph_proposal_dependencies AS d JOIN graph_dependency_statuses AS s ON s.dependency_ref = d.dependency_ref WHERE d.proposal_id = $proposalId ORDER BY d.dependency_kind, d.dependency_ref",
      )
      .all({ $proposalId: proposalId })
      .map((row) => `${row.dependency_ref}:${row.status}:${row.fingerprint}`)
      .join("|");
  }

  recordM3CohortObservation(observation: M3CohortObservation): void {
    this.#database
      .query(
        "INSERT INTO m3_cohort_observations (observation_id, task_ref, split, candidate_ref, outcome, cost_units, recorded_at) VALUES ($observationId, $taskRef, $split, $candidateRef, $outcome, $costUnits, $recordedAt)",
      )
      .run({
        $observationId: observation.observationId,
        $taskRef: observation.taskRef,
        $split: observation.split,
        $candidateRef: observation.candidateRef,
        $outcome: observation.outcome,
        $costUnits: observation.costUnits,
        $recordedAt: observation.recordedAt,
      });
  }

  listM3CohortObservations(): readonly M3CohortObservation[] {
    return this.#database
      .query<
        {
          observation_id: string;
          task_ref: string;
          split: "discovery" | "held-out";
          candidate_ref: string;
          outcome: "success" | "failure";
          cost_units: number;
          recorded_at: string;
        },
        []
      >(
        "SELECT observation_id, task_ref, split, candidate_ref, outcome, cost_units, recorded_at FROM m3_cohort_observations ORDER BY task_ref, split, candidate_ref",
      )
      .all()
      .map((row) => ({
        observationId: row.observation_id,
        taskRef: row.task_ref,
        split: row.split,
        candidateRef: row.candidate_ref,
        outcome: row.outcome,
        costUnits: row.cost_units,
        recordedAt: row.recorded_at,
      }));
  }

  createGraphEvidence(input: {
    evidenceId: string;
    evidenceKind: string;
    subjectRef: string;
    fingerprint: string;
    payload: JsonValue;
    admittedAt: string;
  }): void {
    if (hashCanonicalJson(input.payload) !== input.fingerprint)
      throw new Error("evidence fingerprint mismatch");
    if (input.evidenceKind === "normalization/evaluation")
      validateNormalizationEvidence(input.payload, input.subjectRef);
    this.#database
      .query(
        "INSERT INTO graph_evidence (evidence_id, evidence_kind, subject_ref, fingerprint, payload_json, admitted_at) VALUES ($evidenceId, $evidenceKind, $subjectRef, $fingerprint, $payload, $admittedAt)",
      )
      .run({
        $evidenceId: input.evidenceId,
        $evidenceKind: input.evidenceKind,
        $subjectRef: input.subjectRef,
        $fingerprint: input.fingerprint,
        $payload: canonicalJson(input.payload),
        $admittedAt: input.admittedAt,
      });
  }

  getGraphEvidence(evidenceId: string): GraphEvidence | null {
    const row = this.#database
      .query<
        {
          evidence_id: string;
          evidence_kind: string;
          subject_ref: string;
          fingerprint: string;
          payload_json: string;
          admitted_at: string;
        },
        { $evidenceId: string }
      >(
        "SELECT evidence_id, evidence_kind, subject_ref, fingerprint, payload_json, admitted_at FROM graph_evidence WHERE evidence_id = $evidenceId",
      )
      .get({ $evidenceId: evidenceId });
    return row === null
      ? null
      : {
          evidenceId: row.evidence_id,
          evidenceKind: row.evidence_kind,
          subjectRef: row.subject_ref,
          fingerprint: row.fingerprint,
          payload: JSON.parse(row.payload_json) as JsonValue,
          admittedAt: row.admitted_at,
        };
  }

  listGraphProposalEvidence(proposalId: string): readonly GraphEvidence[] {
    return this.#database
      .query<{ evidence_id: string }, { $proposalId: string }>(
        "SELECT evidence_id FROM graph_proposal_evidence WHERE proposal_id = $proposalId ORDER BY evidence_id",
      )
      .all({ $proposalId: proposalId })
      .map((row) => this.getGraphEvidence(row.evidence_id))
      .filter((row): row is GraphEvidence => row !== null);
  }

  createGraphProposal(input: {
    proposalId: string;
    headKey: string;
    baseGraphRef: string;
    candidateGraphRef: string;
    baseVersion: number;
    originRunId?: string | null;
    dependencies?: readonly Readonly<{
      dependencyKind: string;
      dependencyRef: string;
    }>[];
    evidenceIds?: readonly string[];
    createdAt: string;
  }): void {
    if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0)
      throw new Error(
        "proposal base version must be a non-negative safe integer",
      );
    this.#database.transaction(() => {
      const head = this.getGraphHead(input.headKey);
      if (head === null) throw new Error("graph head does not exist");
      if (
        head.version !== input.baseVersion ||
        head.graphRef !== input.baseGraphRef
      )
        throw new Error("proposal base does not match graph head");
      this.requireGraphDefinition(input.candidateGraphRef);
      this.#database
        .query(
          "INSERT INTO graph_proposals (proposal_id, head_key, base_graph_ref, candidate_graph_ref, base_version, origin_run_id, status, created_at, committed_at) VALUES ($proposalId, $headKey, $baseGraphRef, $candidateGraphRef, $baseVersion, $originRunId, 'pending', $createdAt, NULL)",
        )
        .run({
          $proposalId: input.proposalId,
          $headKey: input.headKey,
          $baseGraphRef: input.baseGraphRef,
          $candidateGraphRef: input.candidateGraphRef,
          $baseVersion: input.baseVersion,
          $originRunId: input.originRunId ?? null,
          $createdAt: input.createdAt,
        });
      for (const evidenceId of input.evidenceIds ?? []) {
        const evidence = this.getGraphEvidence(evidenceId);
        if (evidence === null) throw new Error("graph evidence does not exist");
        this.#database
          .query(
            "INSERT INTO graph_proposal_evidence (proposal_id, evidence_id) VALUES ($proposalId, $evidenceId)",
          )
          .run({ $proposalId: input.proposalId, $evidenceId: evidenceId });
      }
      for (const dependency of input.dependencies ?? []) {
        if (dependency.dependencyRef === input.candidateGraphRef)
          throw new Error("proposal cannot depend on its candidate graph");
        this.#database
          .query(
            "INSERT INTO graph_proposal_dependencies (proposal_id, dependency_kind, dependency_ref) VALUES ($proposalId, $dependencyKind, $dependencyRef)",
          )
          .run({
            $proposalId: input.proposalId,
            $dependencyKind: dependency.dependencyKind,
            $dependencyRef: dependency.dependencyRef,
          });
        this.#database
          .query(
            "INSERT INTO graph_dependency_statuses (dependency_ref, status, reason, fingerprint, changed_at) VALUES ($dependencyRef, 'active', NULL, 'active', $changedAt) ON CONFLICT(dependency_ref) DO NOTHING",
          )
          .run({
            $dependencyRef: dependency.dependencyRef,
            $changedAt: input.createdAt,
          });
      }
    })();
  }

  setGraphDependencyStatus(
    dependencyRef: string,
    status: "active" | "suspended" | "retired",
    reason: string | null,
    fingerprint: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      const existing = this.#database
        .query<
          { status: string; fingerprint: string },
          { $dependencyRef: string }
        >(
          "SELECT status, fingerprint FROM graph_dependency_statuses WHERE dependency_ref = $dependencyRef",
        )
        .get({ $dependencyRef: dependencyRef });
      if (
        existing !== null &&
        existing.status === status &&
        existing.fingerprint === fingerprint
      )
        return;
      this.#database
        .query(
          "INSERT INTO graph_dependency_statuses (dependency_ref, status, reason, fingerprint, changed_at) VALUES ($dependencyRef, $status, $reason, $fingerprint, $occurredAt) ON CONFLICT(dependency_ref) DO UPDATE SET status = excluded.status, reason = excluded.reason, fingerprint = excluded.fingerprint, changed_at = excluded.changed_at",
        )
        .run({
          $dependencyRef: dependencyRef,
          $status: status,
          $reason: reason,
          $fingerprint: fingerprint,
          $occurredAt: occurredAt,
        });
      if (status !== "active")
        this.#database
          .query(
            "UPDATE graph_proposals SET status = 'suspended' WHERE status = 'pending' AND proposal_id IN (SELECT proposal_id FROM graph_proposal_dependencies WHERE dependency_ref = $dependencyRef)",
          )
          .run({ $dependencyRef: dependencyRef });
      if (status !== "active")
        this.#database
          .query(
            "UPDATE graph_head_statuses SET status = 'suspended', reason = $reason, changed_at = $occurredAt WHERE status = 'active' AND head_key IN (SELECT head_key FROM graph_head_dependencies WHERE dependency_ref = $dependencyRef)",
          )
          .run({
            $dependencyRef: dependencyRef,
            $reason: reason,
            $occurredAt: occurredAt,
          });
      if (status !== "active")
        this.#database
          .query(
            "UPDATE composition_relations SET status = 'suspended' WHERE status = 'active' AND relation_kind = 'normalization-revision' AND right_ref IN (SELECT 'graph:' || h.graph_ref FROM graph_heads h JOIN graph_head_dependencies d ON d.head_key = h.head_key WHERE d.dependency_ref = $dependencyRef)",
          )
          .run({ $dependencyRef: dependencyRef });
      this.appendCompositionProjectionEvent(
        `dependency-${status}`,
        dependencyRef,
        occurredAt,
      );
    })();
  }

  getGraphDependencyStatus(dependencyRef: string): Readonly<{
    dependencyRef: string;
    status: "active" | "suspended" | "retired";
    reason: string | null;
    fingerprint: string;
    changedAt: string;
  }> | null {
    const row = this.#database
      .query<
        {
          dependency_ref: string;
          status: "active" | "suspended" | "retired";
          reason: string | null;
          fingerprint: string;
          changed_at: string;
        },
        { $dependencyRef: string }
      >(
        "SELECT dependency_ref, status, reason, fingerprint, changed_at FROM graph_dependency_statuses WHERE dependency_ref = $dependencyRef",
      )
      .get({ $dependencyRef: dependencyRef });
    return row === null
      ? null
      : {
          dependencyRef: row.dependency_ref,
          status: row.status,
          reason: row.reason,
          fingerprint: row.fingerprint,
          changedAt: row.changed_at,
        };
  }

  listGraphProposalDependencies(
    proposalId: string,
  ): readonly GraphDependency[] {
    return this.#database
      .query<
        {
          proposal_id: string;
          dependency_kind: string;
          dependency_ref: string;
        },
        { $proposalId: string }
      >(
        "SELECT proposal_id, dependency_kind, dependency_ref FROM graph_proposal_dependencies WHERE proposal_id = $proposalId ORDER BY dependency_kind, dependency_ref",
      )
      .all({ $proposalId: proposalId })
      .map((row) => ({
        proposalId: row.proposal_id,
        dependencyKind: row.dependency_kind,
        dependencyRef: row.dependency_ref,
      }));
  }

  listGraphProposalsDependingOn(
    dependencyRef: string,
  ): readonly GraphDependency[] {
    return this.#database
      .query<
        {
          proposal_id: string;
          dependency_kind: string;
          dependency_ref: string;
        },
        { $dependencyRef: string }
      >(
        "SELECT proposal_id, dependency_kind, dependency_ref FROM graph_proposal_dependencies WHERE dependency_ref = $dependencyRef ORDER BY proposal_id, dependency_kind",
      )
      .all({ $dependencyRef: dependencyRef })
      .map((row) => ({
        proposalId: row.proposal_id,
        dependencyKind: row.dependency_kind,
        dependencyRef: row.dependency_ref,
      }));
  }

  private requireActiveProposalDependencies(proposalId: string): void {
    const invalid = this.#database
      .query<{ dependency_ref: string }, [string]>(
        "SELECT d.dependency_ref FROM graph_proposal_dependencies d LEFT JOIN graph_dependency_statuses s ON s.dependency_ref = d.dependency_ref WHERE d.proposal_id = ? AND (s.status IS NULL OR s.status <> 'active') LIMIT 1",
      )
      .get(proposalId);
    if (invalid !== null) throw new Error("proposal dependency is not active");
  }

  private requireCompleteNormalizationEvidence(
    evidence: readonly GraphEvidence[],
    candidateRef: string,
    originRunId: string,
  ): void {
    if (evidence.length !== 1)
      throw new Error(
        "normalization proposal requires one complete evidence bundle",
      );
    const record = evidence[0];
    if (
      record === undefined ||
      record.evidenceKind !== "normalization/evaluation" ||
      record.subjectRef !== candidateRef ||
      hashCanonicalJson(record.payload) !== record.fingerprint
    )
      throw new Error("normalization evidence binding mismatch");
    validateNormalizationEvidence(record.payload, candidateRef);
    const executionIds = new Set<string>();
    for (const execution of persistedNormalizationEvidenceExecutions(
      record.payload,
      candidateRef,
    )) {
      if (executionIds.has(execution.executionId))
        throw new Error("normalization evidence reuses a persisted execution");
      executionIds.add(execution.executionId);
      const storedExecution = this.getGraphExecution(execution.executionId);
      if (
        storedExecution === null ||
        storedExecution.graphRef !== candidateRef ||
        storedExecution.frame.state.kind !== "succeeded" ||
        canonicalJson(storedExecution.frame.state.output) !==
          canonicalJson(execution.result)
      )
        throw new Error("normalization evidence execution is not persisted");
      const ownedExecution = this.#database
        .query<
          { execution_id: string },
          { $runId: string; $executionId: string }
        >(
          "SELECT execution_id FROM run_graph_executions WHERE run_id = $runId AND execution_id = $executionId",
        )
        .get({
          $runId: originRunId,
          $executionId: execution.executionId,
        });
      if (ownedExecution === null)
        throw new Error("normalization execution is not owned by the child");
    }
  }

  private deriveNormalizationRelationFromCommittedProposal(input: {
    proposalId: string;
    receiptId: string;
    headKey: string;
    baseGraphRef: string;
    candidateGraphRef: string;
    baseVersion: number;
    originRunId: string;
    governorRunId: string;
    policyRef: string;
    receiptFingerprint: string;
    evidenceFingerprint: string;
    dependencyStatusFingerprint: string;
    occurredAt: string;
  }): void {
    const evidenceIds = this.#database
      .query<{ evidence_id: string }, { $proposalId: string }>(
        "SELECT evidence_id FROM graph_proposal_evidence WHERE proposal_id = $proposalId ORDER BY evidence_id",
      )
      .all({ $proposalId: input.proposalId })
      .map((row) => row.evidence_id);
    const scope = {
      version: 1,
      headKey: input.headKey,
      baseVersion: input.baseVersion,
      originRunId: input.originRunId,
      governorRunId: input.governorRunId,
      proposalId: input.proposalId,
      receiptId: input.receiptId,
      receiptFingerprint: input.receiptFingerprint,
      policyRef: input.policyRef,
      evidenceFingerprint: input.evidenceFingerprint,
      evidenceIds,
      dependencyStatusFingerprint: input.dependencyStatusFingerprint,
    } as JsonValue;
    const scopeJson = canonicalJson(scope);
    if (Buffer.byteLength(scopeJson, "utf8") > 4096)
      throw new Error("derived normalization relation scope exceeds 4 KiB");
    const relationId = `normalization-relation/${input.proposalId}`;
    this.#database
      .query(
        "INSERT INTO composition_relations (relation_id, relation_kind, left_ref, right_ref, status, scope_json, created_at) VALUES ($relationId, 'normalization-revision', $leftRef, $rightRef, 'active', $scope, $occurredAt)",
      )
      .run({
        $relationId: relationId,
        $leftRef: `graph:${input.baseGraphRef}`,
        $rightRef: `graph:${input.candidateGraphRef}`,
        $scope: scopeJson,
        $occurredAt: input.occurredAt,
      });
    this.appendCompositionProjectionEvent(
      "normalization-relation-committed",
      relationId,
      input.occurredAt,
    );
  }

  createGraphProposalReceipt(input: {
    receiptId: string;
    proposalId: string;
    checkedFingerprint: string;
    checkedAt: string;
  }): void {
    this.#database.transaction(() => {
      const proposal = this.#database
        .query<
          {
            head_key: string;
            base_version: number;
            candidate_graph_ref: string;
            status: string;
          },
          { $proposalId: string }
        >(
          "SELECT head_key, base_version, candidate_graph_ref, status FROM graph_proposals WHERE proposal_id = $proposalId",
        )
        .get({ $proposalId: input.proposalId });
      if (proposal === null) throw new Error("graph proposal does not exist");
      if (proposal.status !== "pending")
        throw new Error("graph proposal is not pending");
      this.requireActiveProposalDependencies(input.proposalId);
      const dependencyStatusFingerprint =
        this.proposalDependencyStatusFingerprint(input.proposalId);
      this.#database
        .query(
          "INSERT INTO graph_proposal_receipts (receipt_id, proposal_id, head_key, base_version, candidate_graph_ref, checked_fingerprint, dependency_status_fingerprint, checked_at, admission_policy_ref, admitted_origin_run_id, admitted_governor_run_id, admission_evidence_fingerprint) VALUES ($receiptId, $proposalId, $headKey, $baseVersion, $candidateGraphRef, $checkedFingerprint, $dependencyStatusFingerprint, $checkedAt, NULL, NULL, NULL, NULL)",
        )
        .run({
          $receiptId: input.receiptId,
          $proposalId: input.proposalId,
          $headKey: proposal.head_key,
          $baseVersion: proposal.base_version,
          $candidateGraphRef: proposal.candidate_graph_ref,
          $checkedFingerprint: input.checkedFingerprint,
          $dependencyStatusFingerprint: dependencyStatusFingerprint,
          $checkedAt: input.checkedAt,
        });
    })();
  }

  /**
   * Mint a receipt for a child-originated normalization revision. Unlike the
   * historical receipt helper above, this proves the child/governor relation
   * and hashes every persisted admission input before the receipt is stored.
   */
  admitNormalizationProposal(input: {
    receiptId: string;
    proposalId: string;
    governorRunId: string;
    policyRef: string;
    checkedAt: string;
  }): GraphProposalReceipt {
    return this.#database.transaction(() => {
      const proposal = this.#database
        .query<
          {
            head_key: string;
            base_version: number;
            candidate_graph_ref: string;
            origin_run_id: string | null;
            status: string;
          },
          { $proposalId: string }
        >(
          "SELECT head_key, base_version, candidate_graph_ref, origin_run_id, status FROM graph_proposals WHERE proposal_id = $proposalId",
        )
        .get({ $proposalId: input.proposalId });
      if (proposal === null) throw new Error("graph proposal does not exist");
      if (proposal.status !== "pending")
        throw new Error("graph proposal is not pending");
      if (!proposal.candidate_graph_ref.startsWith("normalization/"))
        throw new Error(
          "trusted admission only supports normalization proposals",
        );
      if (proposal.origin_run_id === null)
        throw new Error("proposal has no originating child run");
      const authority = this.#database
        .query<
          { child_status: RunStatus; governor_status: RunStatus },
          { $childRunId: string; $governorRunId: string }
        >(
          "SELECT child.status AS child_status, governor.status AS governor_status FROM run_ownership ownership JOIN runs child ON child.id = ownership.child_run_id JOIN runs governor ON governor.id = ownership.parent_run_id WHERE ownership.child_run_id = $childRunId AND ownership.parent_run_id = $governorRunId",
        )
        .get({
          $childRunId: proposal.origin_run_id,
          $governorRunId: input.governorRunId,
        });
      if (authority === null)
        throw new Error("originating run is not owned by the governor");
      if (authority.child_status !== "succeeded")
        throw new Error("originating child run has not succeeded");
      if (authority.governor_status !== "running")
        throw new Error("governor run is not running");
      this.requireActiveProposalDependencies(input.proposalId);
      const evidence = this.listGraphProposalEvidence(input.proposalId);
      this.requireCompleteNormalizationEvidence(
        evidence,
        proposal.candidate_graph_ref,
        proposal.origin_run_id,
      );
      const dependencyStatusFingerprint =
        this.proposalDependencyStatusFingerprint(input.proposalId);
      const evidenceFingerprint = hashCanonicalJson(
        evidence.map((record) => ({
          evidenceId: record.evidenceId,
          evidenceKind: record.evidenceKind,
          subjectRef: record.subjectRef,
          fingerprint: record.fingerprint,
        })),
      );
      const checkedFingerprint = hashCanonicalJson({
        version: 1,
        proposal: {
          proposalId: input.proposalId,
          headKey: proposal.head_key,
          baseVersion: proposal.base_version,
          candidateGraphRef: proposal.candidate_graph_ref,
        },
        governorRunId: input.governorRunId,
        originRunId: proposal.origin_run_id,
        policyRef: input.policyRef,
        evidenceFingerprint,
        dependencyStatusFingerprint,
      });
      this.#database
        .query(
          "INSERT INTO graph_proposal_receipts (receipt_id, proposal_id, head_key, base_version, candidate_graph_ref, checked_fingerprint, dependency_status_fingerprint, checked_at, admission_policy_ref, admitted_origin_run_id, admitted_governor_run_id, admission_evidence_fingerprint) VALUES ($receiptId, $proposalId, $headKey, $baseVersion, $candidateGraphRef, $checkedFingerprint, $dependencyStatusFingerprint, $checkedAt, $policyRef, $originRunId, $governorRunId, $evidenceFingerprint)",
        )
        .run({
          $receiptId: input.receiptId,
          $proposalId: input.proposalId,
          $headKey: proposal.head_key,
          $baseVersion: proposal.base_version,
          $candidateGraphRef: proposal.candidate_graph_ref,
          $checkedFingerprint: checkedFingerprint,
          $dependencyStatusFingerprint: dependencyStatusFingerprint,
          $checkedAt: input.checkedAt,
          $policyRef: input.policyRef,
          $originRunId: proposal.origin_run_id,
          $governorRunId: input.governorRunId,
          $evidenceFingerprint: evidenceFingerprint,
        });
      return {
        receiptId: input.receiptId,
        proposalId: input.proposalId,
        headKey: proposal.head_key,
        baseVersion: proposal.base_version,
        candidateGraphRef: proposal.candidate_graph_ref,
        checkedFingerprint,
        dependencyStatusFingerprint,
        checkedAt: input.checkedAt,
        admissionPolicyRef: input.policyRef,
        admittedOriginRunId: proposal.origin_run_id,
        admittedGovernorRunId: input.governorRunId,
        admissionEvidenceFingerprint: evidenceFingerprint,
      };
    })();
  }

  commitGraphProposal(
    proposalId: string,
    receiptId: string,
    occurredAt: string,
  ): void {
    const committed = this.#database.transaction(() => {
      const row = this.#database
        .query<
          {
            head_key: string;
            base_graph_ref: string;
            candidate_graph_ref: string;
            base_version: number;
            origin_run_id: string | null;
            status: string;
            receipt_proposal_id: string | null;
            receipt_head_key: string | null;
            receipt_base_version: number | null;
            receipt_candidate_graph_ref: string | null;
            receipt_dependency_status_fingerprint: string | null;
            receipt_policy_ref: string | null;
            receipt_origin_run_id: string | null;
            receipt_governor_run_id: string | null;
            receipt_evidence_fingerprint: string | null;
            receipt_checked_fingerprint: string | null;
          },
          { $proposalId: string; $receiptId: string }
        >(
          "SELECT p.head_key, p.base_graph_ref, p.candidate_graph_ref, p.base_version, p.origin_run_id, p.status, r.proposal_id AS receipt_proposal_id, r.head_key AS receipt_head_key, r.base_version AS receipt_base_version, r.candidate_graph_ref AS receipt_candidate_graph_ref, r.dependency_status_fingerprint AS receipt_dependency_status_fingerprint, r.admission_policy_ref AS receipt_policy_ref, r.admitted_origin_run_id AS receipt_origin_run_id, r.admitted_governor_run_id AS receipt_governor_run_id, r.admission_evidence_fingerprint AS receipt_evidence_fingerprint, r.checked_fingerprint AS receipt_checked_fingerprint FROM graph_proposals AS p LEFT JOIN graph_proposal_receipts AS r ON r.receipt_id = $receiptId WHERE p.proposal_id = $proposalId",
        )
        .get({ $proposalId: proposalId, $receiptId: receiptId });
      if (row === null)
        throw new Error("graph proposal or receipt does not exist");
      const proposalEvidence = this.listGraphProposalEvidence(proposalId);
      const requiresNormalizationEvidence =
        row.candidate_graph_ref.startsWith("normalization/");
      if (requiresNormalizationEvidence) {
        if (row.origin_run_id === null)
          throw new Error(
            "normalization proposal has no originating child run",
          );
        this.requireCompleteNormalizationEvidence(
          proposalEvidence,
          row.candidate_graph_ref,
          row.origin_run_id,
        );
        if (
          row.receipt_policy_ref === null ||
          row.receipt_origin_run_id === null ||
          row.receipt_governor_run_id === null ||
          row.receipt_evidence_fingerprint === null ||
          row.receipt_checked_fingerprint === null
        )
          throw new Error("normalization proposal requires a trusted receipt");
        const evidenceFingerprint = hashCanonicalJson(
          proposalEvidence.map((evidence) => ({
            evidenceId: evidence.evidenceId,
            evidenceKind: evidence.evidenceKind,
            subjectRef: evidence.subjectRef,
            fingerprint: evidence.fingerprint,
          })),
        );
        const dependencyStatusFingerprint =
          this.proposalDependencyStatusFingerprint(proposalId);
        const expectedReceiptFingerprint = hashCanonicalJson({
          version: 1,
          proposal: {
            proposalId,
            headKey: row.head_key,
            baseVersion: row.base_version,
            candidateGraphRef: row.candidate_graph_ref,
          },
          governorRunId: row.receipt_governor_run_id,
          originRunId: row.receipt_origin_run_id,
          policyRef: row.receipt_policy_ref,
          evidenceFingerprint,
          dependencyStatusFingerprint,
        });
        if (
          row.receipt_evidence_fingerprint !== evidenceFingerprint ||
          row.receipt_checked_fingerprint !== expectedReceiptFingerprint
        )
          throw new Error("normalization receipt binding mismatch");
        const authority = this.#database
          .query<
            { child_status: RunStatus; governor_status: RunStatus },
            { $childRunId: string; $governorRunId: string }
          >(
            "SELECT child.status AS child_status, governor.status AS governor_status FROM run_ownership ownership JOIN runs child ON child.id = ownership.child_run_id JOIN runs governor ON governor.id = ownership.parent_run_id WHERE ownership.child_run_id = $childRunId AND ownership.parent_run_id = $governorRunId",
          )
          .get({
            $childRunId: row.receipt_origin_run_id,
            $governorRunId: row.receipt_governor_run_id,
          });
        if (
          row.origin_run_id !== row.receipt_origin_run_id ||
          authority === null ||
          authority.child_status !== "succeeded" ||
          authority.governor_status !== "running"
        )
          throw new Error(
            "normalization admission authority is no longer valid",
          );
      }
      if (
        row.status !== "pending" ||
        row.receipt_proposal_id !== proposalId ||
        row.receipt_head_key !== row.head_key ||
        row.receipt_base_version !== row.base_version ||
        row.receipt_candidate_graph_ref !== row.candidate_graph_ref ||
        row.receipt_dependency_status_fingerprint !==
          this.proposalDependencyStatusFingerprint(proposalId)
      )
        throw new Error("proposal receipt is invalid");
      const head = this.getGraphHead(row.head_key);
      this.requireActiveProposalDependencies(proposalId);
      if (
        head === null ||
        head.version !== row.base_version ||
        head.graphRef !== row.base_graph_ref
      ) {
        this.#database
          .query(
            "UPDATE graph_proposals SET status = 'stale' WHERE proposal_id = $proposalId AND status = 'pending'",
          )
          .run({ $proposalId: proposalId });
        return false;
      }
      this.#database
        .query(
          "UPDATE graph_heads SET graph_ref = $graphRef, version = $version, updated_at = $occurredAt WHERE head_key = $headKey AND version = $expectedVersion",
        )
        .run({
          $graphRef: row.candidate_graph_ref,
          $version: row.base_version + 1,
          $occurredAt: occurredAt,
          $headKey: row.head_key,
          $expectedVersion: row.base_version,
        });
      this.#database
        .query(
          "UPDATE graph_proposals SET status = 'committed', committed_at = $occurredAt WHERE proposal_id = $proposalId",
        )
        .run({ $proposalId: proposalId, $occurredAt: occurredAt });
      this.#database
        .query("DELETE FROM graph_head_dependencies WHERE head_key = $headKey")
        .run({ $headKey: row.head_key });
      this.#database
        .query(
          "INSERT INTO graph_head_dependencies (head_key, dependency_ref) SELECT $headKey, dependency_ref FROM graph_proposal_dependencies WHERE proposal_id = $proposalId",
        )
        .run({ $headKey: row.head_key, $proposalId: proposalId });
      this.#database
        .query(
          "INSERT INTO graph_head_statuses (head_key, status, reason, changed_at) VALUES ($headKey, 'active', NULL, $occurredAt) ON CONFLICT(head_key) DO UPDATE SET status = 'active', reason = NULL, changed_at = excluded.changed_at",
        )
        .run({ $headKey: row.head_key, $occurredAt: occurredAt });
      this.#database
        .query(
          "INSERT INTO graph_head_events (head_key, version, graph_ref, occurred_at) VALUES ($headKey, $version, $graphRef, $occurredAt)",
        )
        .run({
          $headKey: row.head_key,
          $version: row.base_version + 1,
          $graphRef: row.candidate_graph_ref,
          $occurredAt: occurredAt,
        });
      this.appendCompositionProjectionEvent(
        "head-committed",
        row.head_key,
        occurredAt,
      );
      if (requiresNormalizationEvidence) {
        if (
          row.origin_run_id === null ||
          row.receipt_governor_run_id === null ||
          row.receipt_policy_ref === null ||
          row.receipt_evidence_fingerprint === null ||
          row.receipt_checked_fingerprint === null
        )
          throw new Error("normalization proposal requires a trusted receipt");
        this.deriveNormalizationRelationFromCommittedProposal({
          proposalId,
          receiptId,
          headKey: row.head_key,
          baseGraphRef: row.base_graph_ref,
          candidateGraphRef: row.candidate_graph_ref,
          baseVersion: row.base_version,
          originRunId: row.origin_run_id,
          governorRunId: row.receipt_governor_run_id,
          policyRef: row.receipt_policy_ref,
          receiptFingerprint: row.receipt_checked_fingerprint,
          evidenceFingerprint: row.receipt_evidence_fingerprint,
          dependencyStatusFingerprint:
            this.proposalDependencyStatusFingerprint(proposalId),
          occurredAt,
        });
      }
      return true;
    })();
    if (!committed) throw new Error("graph proposal is stale");
  }

  getGraphProposal(proposalId: string): GraphProposal | null {
    const row = this.#database
      .query<
        {
          proposal_id: string;
          head_key: string;
          base_graph_ref: string;
          candidate_graph_ref: string;
          base_version: number;
          origin_run_id: string | null;
          status: "pending" | "committed" | "stale" | "suspended";
          created_at: string;
          committed_at: string | null;
        },
        { $proposalId: string }
      >(
        "SELECT proposal_id, head_key, base_graph_ref, candidate_graph_ref, base_version, origin_run_id, status, created_at, committed_at FROM graph_proposals WHERE proposal_id = $proposalId",
      )
      .get({ $proposalId: proposalId });
    return row === null
      ? null
      : {
          proposalId: row.proposal_id,
          headKey: row.head_key,
          baseGraphRef: row.base_graph_ref,
          candidateGraphRef: row.candidate_graph_ref,
          baseVersion: row.base_version,
          originRunId: row.origin_run_id,
          status: row.status,
          createdAt: row.created_at,
          committedAt: row.committed_at,
        };
  }

  createGraphHead(headKey: string, graphRef: string, occurredAt: string): void {
    this.#database.transaction(() => {
      this.requireGraphDefinition(graphRef);
      this.#database
        .query(
          "INSERT INTO graph_heads (head_key, graph_ref, version, updated_at) VALUES ($headKey, $graphRef, 0, $occurredAt)",
        )
        .run({
          $headKey: headKey,
          $graphRef: graphRef,
          $occurredAt: occurredAt,
        });
      this.#database
        .query(
          "INSERT INTO graph_head_statuses (head_key, status, reason, changed_at) VALUES ($headKey, 'active', NULL, $occurredAt)",
        )
        .run({ $headKey: headKey, $occurredAt: occurredAt });
      this.#database
        .query(
          "INSERT INTO graph_head_events (head_key, version, graph_ref, occurred_at) VALUES ($headKey, 0, $graphRef, $occurredAt)",
        )
        .run({
          $headKey: headKey,
          $graphRef: graphRef,
          $occurredAt: occurredAt,
        });
      this.appendCompositionProjectionEvent(
        "head-created",
        headKey,
        occurredAt,
      );
    })();
  }

  commitGraphHead(
    headKey: string,
    expectedVersion: number,
    graphRef: string,
    occurredAt: string,
  ): void {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      throw new Error(
        "expected head version must be a non-negative safe integer",
      );
    this.#database.transaction(() => {
      this.requireGraphDefinition(graphRef);
      const updated = this.#database
        .query(
          "UPDATE graph_heads SET graph_ref = $graphRef, version = $nextVersion, updated_at = $occurredAt WHERE head_key = $headKey AND version = $expectedVersion",
        )
        .run({
          $headKey: headKey,
          $graphRef: graphRef,
          $nextVersion: expectedVersion + 1,
          $expectedVersion: expectedVersion,
          $occurredAt: occurredAt,
        });
      if (updated.changes !== 1)
        throw new Error(
          "graph head " +
            headKey +
            " does not have expected version " +
            expectedVersion,
        );
      this.#database
        .query(
          "INSERT INTO graph_head_events (head_key, version, graph_ref, occurred_at) VALUES ($headKey, $version, $graphRef, $occurredAt)",
        )
        .run({
          $headKey: headKey,
          $version: expectedVersion + 1,
          $graphRef: graphRef,
          $occurredAt: occurredAt,
        });
      this.appendCompositionProjectionEvent(
        "head-committed",
        headKey,
        occurredAt,
      );
    })();
  }

  getGraphHead(headKey: string): GraphHead | null {
    const row = this.#database
      .query<
        {
          head_key: string;
          graph_ref: string;
          version: number;
          updated_at: string;
        },
        { $headKey: string }
      >(
        "SELECT head_key, graph_ref, version, updated_at FROM graph_heads WHERE head_key = $headKey",
      )
      .get({ $headKey: headKey });
    return row === null
      ? null
      : {
          headKey: row.head_key,
          graphRef: row.graph_ref,
          version: row.version,
          updatedAt: row.updated_at,
        };
  }

  getGraphHeadStatus(headKey: string): GraphHeadStatus | null {
    const row = this.#database
      .query<
        {
          head_key: string;
          status: "active" | "suspended";
          reason: string | null;
          changed_at: string;
        },
        { $headKey: string }
      >(
        "SELECT head_key, status, reason, changed_at FROM graph_head_statuses WHERE head_key = $headKey",
      )
      .get({ $headKey: headKey });
    return row === null
      ? null
      : {
          headKey: row.head_key,
          status: row.status,
          reason: row.reason,
          changedAt: row.changed_at,
        };
  }

  requireActiveGraphHead(headKey: string): GraphHead {
    const head = this.getGraphHead(headKey);
    if (head === null) throw new Error("graph head does not exist");
    const status = this.getGraphHeadStatus(headKey);
    if (status === null || status.status !== "active")
      throw new Error("graph head is not active");
    return head;
  }

  hasGraphDefinition(graphRef: string): boolean {
    return (
      this.#database
        .query<{ ref: string }, { $graphRef: string }>(
          "SELECT ref FROM graph_definitions WHERE ref = $graphRef",
        )
        .get({ $graphRef: graphRef }) !== null
    );
  }

  registerGraphDefinition(definition: GraphDefinition): void {
    this.#database.transaction(() => {
      this.persistDefinition(definition);
    })();
  }

  persistGraphFrame(input: PersistGraphFrame): void {
    this.#database.transaction(() => {
      this.persistDefinition(input.definition);
      this.upsertGraphExecution(
        input.executionId,
        input.definition.ref,
        input.frame,
        input.expectedRevision,
        input.occurredAt,
      );
    })();
  }

  /**
   * Atomically records the advanced frame, one operation intent, its outbox
   * payload, and its planned event. No dispatcher runs inside this transaction.
   */
  persistGraphOperationIntent(input: PersistGraphOperationIntent): void {
    this.persistGraphOperationIntentForRun(input, null);
  }

  persistRunGraphOperationIntent(input: PersistRunGraphOperationIntent): void {
    if (input.expectedRevision !== null)
      throw new Error("run-bound graph execution must be created fresh");
    this.persistGraphOperationIntentForRun(input, input.runId);
  }

  private persistGraphOperationIntentForRun(
    input: PersistGraphOperationIntent,
    initialRunId: string | null,
  ): void {
    this.#database.transaction(() => {
      if (initialRunId !== null) this.requireRunningRun(initialRunId);
      this.persistDefinition(input.definition);
      this.upsertGraphExecution(
        input.executionId,
        input.definition.ref,
        input.frame,
        input.expectedRevision,
        input.occurredAt,
      );
      if (initialRunId !== null)
        this.attachGraphExecutionToRunInternal(
          initialRunId,
          input.executionId,
          input.occurredAt,
        );
      const operation = input.operation;
      const operationJson = asJson({
        operationId: operation.operationId,
        abstraction: operation.abstraction,
        input: operation.input,
        attempt: operation.attempt ?? null,
      });
      this.#database
        .query(
          "INSERT INTO graph_operations (operation_id, execution_id, attempt_id, abstraction_ref, input_json, state, lifecycle_state, observation_json, created_at, observed_at) VALUES ($operationId, $executionId, $attemptId, $abstractionRef, $inputJson, 'planned', 'planned', NULL, $occurredAt, NULL)",
        )
        .run({
          $operationId: operation.operationId,
          $executionId: input.executionId,
          $attemptId: operation.attempt?.id ?? null,
          $abstractionRef: operation.abstraction,
          $inputJson: canonicalJson(operation.input),
          $occurredAt: input.occurredAt,
        });
      const ownerRunId =
        initialRunId ?? this.runIdForGraphExecution(input.executionId);
      if (ownerRunId !== null)
        this.reserveOperationForRun(
          ownerRunId,
          operation.operationId,
          input.occurredAt,
        );
      this.#database
        .query(
          "INSERT INTO graph_outbox (operation_id, payload_json, state, lifecycle_state, created_at) VALUES ($operationId, $payload, 'pending', 'pending', $occurredAt)",
        )
        .run({
          $operationId: operation.operationId,
          $payload: canonicalJson(operationJson),
          $occurredAt: input.occurredAt,
        });
      this.appendGraphOperationEvent(
        input.executionId,
        operation.operationId,
        "planned",
        input.occurredAt,
        operationJson,
      );
    })();
  }

  persistGraphOperationObservation(
    input: PersistGraphOperationObservation,
  ): void {
    if (input.observation.operationId !== input.operationId)
      throw new Error(
        "observation operation ID does not match its persistence key",
      );
    this.#database.transaction(() => {
      const observationJson = asJson(input.observation);
      const updated = this.#database
        .query(
          "UPDATE graph_operations SET state = 'observed', lifecycle_state = 'observed', observation_json = $observation, observed_at = $occurredAt WHERE operation_id = $operationId AND execution_id = $executionId AND state = 'planned' AND lifecycle_state = 'dispatched'",
        )
        .run({
          $operationId: input.operationId,
          $executionId: input.executionId,
          $observation: canonicalJson(observationJson),
          $occurredAt: input.occurredAt,
        });
      if (updated.changes !== 1)
        throw new Error(
          `graph operation ${input.operationId} is not dispatched`,
        );
      this.#database
        .query(
          "UPDATE graph_outbox SET state = 'observed', lifecycle_state = 'observed' WHERE operation_id = $operationId AND state = 'pending' AND lifecycle_state = 'dispatched'",
        )
        .run({ $operationId: input.operationId });
      this.upsertGraphExecution(
        input.executionId,
        input.frame.graphRef,
        input.frame,
        input.expectedRevision,
        input.occurredAt,
      );
      this.appendGraphOperationEvent(
        input.executionId,
        input.operationId,
        "observed",
        input.occurredAt,
        observationJson,
      );
    })();
  }

  /**
   * Accepts a read-only adapter lookup only after recovery made the operation
   * indeterminate. The accepted observation, frame advance, and immutable
   * adapter attribution commit together.
   */
  persistReconciledGraphOperationObservation(
    input: PersistReconciledGraphOperationObservation,
  ): void {
    if (input.observation.operationId !== input.operationId)
      throw new Error(
        "observation operation ID does not match its persistence key",
      );
    validateReconciliationAttribution(input.attribution);
    this.#database.transaction(() => {
      const observationJson = asJson(input.observation);
      const updated = this.#database
        .query(
          "UPDATE graph_operations SET state = 'observed', lifecycle_state = 'observed', observation_json = $observation, observed_at = $occurredAt WHERE operation_id = $operationId AND execution_id = $executionId AND state = 'planned' AND lifecycle_state = 'indeterminate'",
        )
        .run({
          $operationId: input.operationId,
          $executionId: input.executionId,
          $observation: canonicalJson(observationJson),
          $occurredAt: input.occurredAt,
        });
      if (updated.changes !== 1)
        throw new Error(
          `graph operation ${input.operationId} is not indeterminate`,
        );
      const outbox = this.#database
        .query(
          "UPDATE graph_outbox SET state = 'observed', lifecycle_state = 'observed' WHERE operation_id = $operationId AND state = 'pending' AND lifecycle_state = 'indeterminate'",
        )
        .run({ $operationId: input.operationId });
      if (outbox.changes !== 1)
        throw new Error(
          "graph operation " +
            input.operationId +
            " has no indeterminate outbox row",
        );
      this.upsertGraphExecution(
        input.executionId,
        input.frame.graphRef,
        input.frame,
        input.expectedRevision,
        input.occurredAt,
      );
      this.#database
        .query(
          "INSERT INTO graph_operation_reconciliations (operation_id, adapter_ref, external_operation_id, evidence_json, occurred_at) VALUES ($operationId, $adapterRef, $externalOperationId, $evidence, $occurredAt)",
        )
        .run({
          $operationId: input.operationId,
          $adapterRef: input.attribution.adapterRef,
          $externalOperationId: input.attribution.externalOperationId,
          $evidence: canonicalJson(input.attribution.evidence),
          $occurredAt: input.occurredAt,
        });
      this.appendGraphOperationEvent(
        input.executionId,
        input.operationId,
        "observed",
        input.occurredAt,
        observationJson,
      );
    })();
  }

  recordGraphOperationUsage(
    executionId: string,
    operationId: string,
    usageUnits: number | null,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      this.recordGraphOperationUsageInternal(
        executionId,
        operationId,
        usageUnits,
        occurredAt,
      );
    })();
  }

  getRunUsageTotals(runId: string): RunUsageTotals {
    const row = this.#database
      .query<
        { known_units: number; unknown_operations: number },
        { $runId: string }
      >(
        "WITH RECURSIVE subtree(run_id) AS (SELECT $runId UNION SELECT run_ownership.child_run_id FROM run_ownership JOIN subtree ON run_ownership.parent_run_id = subtree.run_id) SELECT COALESCE(SUM(usage_units), 0) AS known_units, COALESCE(SUM(CASE WHEN usage_known = 0 THEN 1 ELSE 0 END), 0) AS unknown_operations FROM graph_operation_usage JOIN subtree ON subtree.run_id = graph_operation_usage.run_id",
      )
      .get({ $runId: runId });
    const knownUnits = row?.known_units ?? 0;
    const unknownOperations = row?.unknown_operations ?? 0;
    if (
      !Number.isSafeInteger(knownUnits) ||
      !Number.isSafeInteger(unknownOperations)
    )
      throw new Error("usage totals are outside JavaScript safe integer range");
    return { runId, knownUnits, unknownOperations };
  }

  private recordGraphOperationUsageInternal(
    executionId: string,
    operationId: string,
    usageUnits: number | null,
    occurredAt: string,
  ): void {
    if (
      usageUnits !== null &&
      (!Number.isSafeInteger(usageUnits) || usageUnits < 0)
    )
      throw new Error(
        "usage units must be null or a non-negative safe integer",
      );
    const operation = this.#database
      .query<
        { lifecycle_state: GraphOperationLifecycle },
        { $executionId: string; $operationId: string }
      >(
        "SELECT lifecycle_state FROM graph_operations WHERE execution_id = $executionId AND operation_id = $operationId AND state = 'planned'",
      )
      .get({ $executionId: executionId, $operationId: operationId });
    if (operation === null)
      throw new Error("graph operation does not exist or is not chargeable");
    if (
      operation.lifecycle_state !== "observed" &&
      operation.lifecycle_state !== "indeterminate"
    )
      throw new Error("graph operation is not terminally chargeable");
    const runId = this.runIdForGraphExecution(executionId);
    if (runId === null) throw new Error("graph operation has no owning run");
    const existing = this.#database
      .query<
        { usage_units: number | null; usage_known: number },
        { $operationId: string }
      >(
        "SELECT usage_units, usage_known FROM graph_operation_usage WHERE operation_id = $operationId",
      )
      .get({ $operationId: operationId });
    if (existing !== null) {
      if (
        existing.usage_known === 1 &&
        (usageUnits === null || existing.usage_units !== usageUnits)
      )
        throw new Error(
          "graph operation usage conflicts with its recorded charge",
        );
      if (existing.usage_known === 0 && usageUnits !== null)
        this.#database
          .query(
            "UPDATE graph_operation_usage SET usage_units = $usageUnits, usage_known = 1, recorded_at = $occurredAt WHERE operation_id = $operationId",
          )
          .run({
            $operationId: operationId,
            $usageUnits: usageUnits,
            $occurredAt: occurredAt,
          });
      this.appendEvent(runId, "OperationUsageRecorded", occurredAt, {
        operationId,
        usageUnits: String(usageUnits),
      });
      return;
    }
    this.#database
      .query(
        "INSERT INTO graph_operation_usage (operation_id, run_id, usage_units, usage_known, recorded_at) VALUES ($operationId, $runId, $usageUnits, $usageKnown, $occurredAt)",
      )
      .run({
        $operationId: operationId,
        $runId: runId,
        $usageUnits: usageUnits,
        $usageKnown: usageUnits === null ? 0 : 1,
        $occurredAt: occurredAt,
      });
    this.appendEvent(runId, "OperationUsageRecorded", occurredAt, {
      operationId,
      usageUnits: usageUnits === null ? "unknown" : String(usageUnits),
    });
  }

  graphOperationLifecycle(
    executionId: string,
    operationId: string,
  ): GraphOperationLifecycle | null {
    const row = this.#database
      .query<
        { lifecycle_state: GraphOperationLifecycle },
        { $executionId: string; $operationId: string }
      >(
        "SELECT lifecycle_state FROM graph_operations WHERE execution_id = $executionId AND operation_id = $operationId AND state = 'planned'",
      )
      .get({ $executionId: executionId, $operationId: operationId });
    return row?.lifecycle_state ?? null;
  }

  markGraphOperationDispatched(
    executionId: string,
    operationId: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      const operation = this.#database
        .query(
          "UPDATE graph_operations SET lifecycle_state = 'dispatched' WHERE operation_id = $operationId AND execution_id = $executionId AND state = 'planned' AND lifecycle_state = 'planned'",
        )
        .run({ $executionId: executionId, $operationId: operationId });
      if (operation.changes !== 1)
        throw new Error(`graph operation ${operationId} is not planned`);
      const outbox = this.#database
        .query(
          "UPDATE graph_outbox SET lifecycle_state = 'dispatched' WHERE operation_id = $operationId AND state = 'pending' AND lifecycle_state = 'pending'",
        )
        .run({ $operationId: operationId });
      if (outbox.changes !== 1)
        throw new Error(
          `graph operation ${operationId} has no pending outbox row`,
        );
      this.appendGraphLifecycleEvent(
        executionId,
        operationId,
        "dispatched",
        occurredAt,
      );
    })();
  }

  markGraphOperationIndeterminate(
    executionId: string,
    operationId: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      const operation = this.#database
        .query(
          "UPDATE graph_operations SET lifecycle_state = 'indeterminate' WHERE operation_id = $operationId AND execution_id = $executionId AND state = 'planned' AND lifecycle_state = 'dispatched'",
        )
        .run({ $executionId: executionId, $operationId: operationId });
      if (operation.changes !== 1)
        throw new Error(`graph operation ${operationId} is not dispatched`);
      const outbox = this.#database
        .query(
          "UPDATE graph_outbox SET lifecycle_state = 'indeterminate' WHERE operation_id = $operationId AND state = 'pending' AND lifecycle_state = 'dispatched'",
        )
        .run({ $operationId: operationId });
      if (outbox.changes !== 1)
        throw new Error(
          `graph operation ${operationId} has no dispatched outbox row`,
        );
      this.appendGraphLifecycleEvent(
        executionId,
        operationId,
        "indeterminate",
        occurredAt,
      );
    })();
  }

  attachGraphExecutionToRun(
    runId: string,
    executionId: string,
    occurredAt: string,
  ): void {
    this.#database.transaction(() => {
      this.requireRunningRun(runId);
      const execution = this.#database
        .query<{ execution_id: string }, { $executionId: string }>(
          "SELECT execution_id FROM graph_executions WHERE execution_id = $executionId",
        )
        .get({ $executionId: executionId });
      if (execution === null)
        throw new Error(`graph execution ${executionId} does not exist`);
      this.attachGraphExecutionToRunInternal(runId, executionId, occurredAt);
    })();
  }

  getGraphExecutionForRun(runId: string): PersistedGraphExecution | null {
    const row = this.#database
      .query<{ execution_id: string }, { $runId: string }>(
        "SELECT execution_id FROM run_graph_executions WHERE run_id = $runId ORDER BY attached_at, execution_id LIMIT 1",
      )
      .get({ $runId: runId });
    return row === null ? null : this.getGraphExecution(row.execution_id);
  }

  getGraphExecution(executionId: string): PersistedGraphExecution | null {
    const row = this.#database
      .query<
        {
          execution_id: string;
          graph_ref: string;
          revision: number;
          frame_encoding_version: number;
          frame_hash: string;
          frame_json: string;
        },
        { $executionId: string }
      >(
        "SELECT execution_id, graph_ref, revision, frame_encoding_version, frame_hash, frame_json FROM graph_executions WHERE execution_id = $executionId",
      )
      .get({ $executionId: executionId });
    if (row === null) return null;
    const artifacts = this.loadPinnedGraphArtifacts(executionId, row.graph_ref);
    const definition = decodePinnedGraphDefinition(
      artifacts.definition,
      artifacts.catalogue,
    );
    if (row.frame_encoding_version !== 1)
      throw new Error(
        "graph execution " +
          executionId +
          " has unsupported frame encoding " +
          row.frame_encoding_version,
      );
    const frameValue = parseCanonicalRecord(
      row.frame_json,
      row.frame_hash,
      `graph execution ${executionId} frame`,
    );
    let frame: GraphFrame;
    try {
      frame = decodePinnedGraphFrame(frameValue, definition);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        "graph execution " +
          executionId +
          " cannot reconstruct its frame: " +
          detail,
      );
    }
    this.verifyAwaitingFrameOperation(executionId, frame);
    this.verifyRetryOperationHistory(executionId, frame);
    return {
      executionId: row.execution_id,
      graphRef: row.graph_ref,
      revision: row.revision,
      frame,
      frameHash: row.frame_hash as ContentHash,
    };
  }

  reconcileGraphExecution(
    executionId: string,
    occurredAt: string,
  ): GraphReconciliation | null {
    const execution = this.getGraphExecution(executionId);
    if (execution === null) return null;
    const operations = this.#database
      .query<
        { operation_id: string; lifecycle_state: string },
        { $executionId: string }
      >(
        "SELECT operation_id, lifecycle_state FROM graph_operations WHERE execution_id = $executionId AND state = 'planned' ORDER BY created_at, operation_id",
      )
      .all({ $executionId: executionId });
    const decisions: GraphReconciliation["operations"][number][] = [];
    for (const operation of operations) {
      if (operation.lifecycle_state === "planned") {
        decisions.push({
          operationId: operation.operation_id,
          action: "dispatchable",
        });
        continue;
      }
      if (operation.lifecycle_state === "dispatched") {
        this.markGraphOperationIndeterminate(
          executionId,
          operation.operation_id,
          occurredAt,
        );
      } else if (operation.lifecycle_state !== "indeterminate") {
        throw new Error(
          "graph operation " +
            operation.operation_id +
            " has an invalid recovery lifecycle",
        );
      }
      decisions.push({
        operationId: operation.operation_id,
        action: "indeterminate",
      });
    }
    return Object.freeze({
      executionId,
      operations: Object.freeze(decisions),
    });
  }

  getRunnableGraphDefinition(executionId: string): GraphDefinition | null {
    const execution = this.getGraphExecution(executionId);
    if (execution === null) return null;
    const artifacts = this.loadPinnedGraphArtifacts(
      executionId,
      execution.graphRef,
    );
    return decodePinnedGraphDefinition(
      artifacts.definition,
      artifacts.catalogue,
    );
  }

  listPendingGraphOutbox(): readonly PendingGraphOutbox[] {
    return this.#database
      .query<
        { operation_id: string; execution_id: string; payload_json: string },
        []
      >(
        "SELECT graph_outbox.operation_id, graph_operations.execution_id, graph_outbox.payload_json FROM graph_outbox JOIN graph_operations ON graph_operations.operation_id = graph_outbox.operation_id WHERE graph_outbox.state = 'pending' AND graph_outbox.lifecycle_state = 'pending' ORDER BY graph_outbox.created_at, graph_outbox.operation_id",
      )
      .all()
      .map((row) => ({
        operationId: row.operation_id,
        executionId: row.execution_id,
        payload: JSON.parse(row.payload_json) as JsonValue,
      }));
  }

  loadPinnedGraphArtifacts(
    executionId: string,
    graphRef: string,
  ): PinnedGraphArtifacts {
    const row = this.#database
      .query<
        {
          definition_json: string;
          definition_hash: string;
          definition_version: number;
          catalogue_json: string;
          catalogue_hash: string;
          catalogue_version: number;
        },
        { $executionId: string; $graphRef: string }
      >(
        "SELECT graph_definitions.canonical_json AS definition_json, graph_definitions.content_hash AS definition_hash, graph_definitions.encoding_version AS definition_version, graph_catalogues.canonical_json AS catalogue_json, graph_catalogues.content_hash AS catalogue_hash, graph_catalogues.encoding_version AS catalogue_version FROM graph_executions JOIN graph_definitions ON graph_definitions.ref = graph_executions.graph_ref JOIN graph_catalogues ON graph_catalogues.ref = graph_definitions.catalogue_ref WHERE graph_executions.execution_id = $executionId AND graph_executions.graph_ref = $graphRef",
      )
      .get({ $executionId: executionId, $graphRef: graphRef });
    if (row === null)
      throw new Error(
        `graph execution ${executionId} is missing its pinned definition ${graphRef}`,
      );
    if (row.definition_version !== 1 || row.catalogue_version !== 1)
      throw new Error(
        `graph execution ${executionId} has unsupported definition encoding`,
      );
    const definition = parseCanonicalRecord(
      row.definition_json,
      row.definition_hash,
      `graph definition ${graphRef}`,
    );
    const catalogue = parseCanonicalRecord(
      row.catalogue_json,
      row.catalogue_hash,
      `graph catalogue for ${graphRef}`,
    );
    verifyPinnedDefinition(definition, catalogue, graphRef, executionId);
    try {
      decodePinnedGraphDefinition(definition, catalogue);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        "graph execution " +
          executionId +
          " cannot reconstruct its runnable definition: " +
          detail,
      );
    }
    return { definition, catalogue };
  }

  private verifyRetryOperationHistory(
    executionId: string,
    frame: GraphFrame,
  ): void {
    if (frame.state.kind !== "awaitingCall") return;
    const retries = frame.state.continuations.filter(
      (item): item is Extract<typeof item, { kind: "retry" }> =>
        item.kind === "retry",
    );
    if (retries.length === 0) return;

    const rows = this.#database
      .query<
        {
          operation_id: string;
          attempt_id: string | null;
          state: string;
          lifecycle_state: string;
          observation_json: string | null;
        },
        { $executionId: string }
      >(
        "SELECT operation_id, attempt_id, state, lifecycle_state, observation_json FROM graph_operations WHERE execution_id = $executionId",
      )
      .all({ $executionId: executionId });
    const seenOperationIds = new Set<string>();
    const seenAttemptIds = new Set<string>();

    for (const retry of retries) {
      if (retry.completedAttemptIds.length > retry.ordinal - 1)
        throw new Error("retry frame has too many completed attempts");
      const attemptIds = new Set<string>([
        ...retry.completedAttemptIds,
        ...(retry.attemptId === null ? [] : [retry.attemptId]),
      ]);
      for (const attemptId of attemptIds) {
        if (seenAttemptIds.has(attemptId))
          throw new Error("retry frame reuses an attempt history");
        seenAttemptIds.add(attemptId);
      }
      for (const operationId of retry.operationIds) {
        if (seenOperationIds.has(operationId))
          throw new Error("retry frame reuses an operation history");
        seenOperationIds.add(operationId);
      }

      const operationIdSet = new Set<string>(retry.operationIds);
      const history = rows.filter(
        (row) => row.attempt_id !== null && attemptIds.has(row.attempt_id),
      );
      if (
        history.length !== operationIdSet.size ||
        history.some((row) => !operationIdSet.has(row.operation_id))
      )
        throw new Error("retry frame operation history is incomplete");
      for (const operationId of retry.operationIds) {
        const row = history.find((item) => item.operation_id === operationId);
        if (row === undefined)
          throw new Error("retry frame references a missing operation history");
      }

      for (const attemptId of retry.completedAttemptIds) {
        const completed = history.filter((row) => row.attempt_id === attemptId);
        if (
          completed.length === 0 ||
          completed.some(
            (row) =>
              row.state !== "observed" ||
              row.lifecycle_state !== "observed" ||
              row.observation_json === null,
          )
        )
          throw new Error("completed retry attempt is not durably observed");
      }
    }
  }

  private verifyAwaitingFrameOperation(
    executionId: string,
    frame: GraphFrame,
  ): void {
    if (frame.state.kind !== "awaitingCall") return;
    const row = this.#database
      .query<
        {
          execution_id: string;
          attempt_id: string | null;
          abstraction_ref: string;
          input_json: string;
          state: string;
          lifecycle_state: string;
          outbox_payload: string;
          outbox_state: string;
          outbox_lifecycle: string;
        },
        { $operationId: string }
      >(
        "SELECT graph_operations.execution_id, graph_operations.attempt_id, graph_operations.abstraction_ref, graph_operations.input_json, graph_operations.state, graph_operations.lifecycle_state, graph_outbox.payload_json AS outbox_payload, graph_outbox.state AS outbox_state, graph_outbox.lifecycle_state AS outbox_lifecycle FROM graph_operations JOIN graph_outbox ON graph_outbox.operation_id = graph_operations.operation_id WHERE graph_operations.operation_id = $operationId",
      )
      .get({ $operationId: frame.state.operationId });
    if (row === null || row.execution_id !== executionId)
      throw new Error("awaiting frame is missing its operation record");
    if (
      row.state !== "planned" ||
      row.abstraction_ref !== frame.state.abstraction ||
      row.attempt_id !== (frame.state.attempt?.id ?? null)
    )
      throw new Error("awaiting frame does not match its operation record");
    const expectedOutboxLifecycle =
      row.lifecycle_state === "planned" ? "pending" : row.lifecycle_state;
    if (
      !["planned", "dispatched", "indeterminate"].includes(
        row.lifecycle_state,
      ) ||
      row.outbox_state !== "pending" ||
      row.outbox_lifecycle !== expectedOutboxLifecycle
    )
      throw new Error("awaiting frame has an inconsistent operation lifecycle");
    const input = parseCanonicalJson(row.input_json, "operation input");
    const payload = parseCanonicalJson(row.outbox_payload, "operation outbox");
    if (
      !isJsonObject(payload) ||
      !sameSorted(Object.keys(payload), [
        "abstraction",
        "attempt",
        "input",
        "operationId",
      ]) ||
      payload.operationId !== frame.state.operationId ||
      payload.abstraction !== frame.state.abstraction ||
      canonicalJson(requiredField(payload, "input")) !== canonicalJson(input) ||
      canonicalJson(frame.state.input) !== canonicalJson(input) ||
      canonicalJson(requiredField(payload, "attempt")) !==
        canonicalJson(asJson(frame.state.attempt))
    )
      throw new Error("awaiting frame outbox does not match its operation");
  }

  private eventsFor(runId: string): readonly RunEvent[] {
    return this.#database
      .query<EventRow, { $runId: string }>(
        "SELECT * FROM run_events WHERE run_id = $runId ORDER BY sequence",
      )
      .all({ $runId: runId })
      .map((row) => ({
        sequence: row.sequence,
        runId: row.run_id,
        kind: row.kind,
        occurredAt: row.occurred_at,
        payload: JSON.parse(row.payload_json) as Record<string, string>,
      }));
  }

  getRunOperationAllocation(runId: string): RunOperationAllocation | null {
    const row = this.#database
      .query<{ max_operations: number }, { $runId: string }>(
        "SELECT max_operations FROM run_operation_allocations WHERE run_id = $runId",
      )
      .get({ $runId: runId });
    if (row === null) return null;
    const reservedOperations = this.inclusiveReservedOperationCount(runId);
    if (!Number.isSafeInteger(row.max_operations))
      throw new Error(
        "operation allocation is outside JavaScript safe integer range",
      );
    return {
      runId,
      maxOperations: row.max_operations,
      reservedOperations,
      remainingOperations: row.max_operations - reservedOperations,
    };
  }

  private hasActiveOwnedChild(parentRunId: string): boolean {
    return (
      this.#database
        .query<{ child_run_id: string }, { $parentRunId: string }>(
          "SELECT run_ownership.child_run_id FROM run_ownership JOIN runs AS child ON child.id = run_ownership.child_run_id WHERE run_ownership.parent_run_id = $parentRunId AND child.status = 'running' LIMIT 1",
        )
        .get({ $parentRunId: parentRunId }) !== null
    );
  }

  private firstUnobservedNonSuccessChild(parentRunId: string): Readonly<{
    childRunId: string;
    status: Exclude<RunStatus, "running">;
    spawnOrder: number;
  }> | null {
    const row = this.#database
      .query<
        {
          child_run_id: string;
          status: Exclude<RunStatus, "running">;
          spawn_order: number;
        },
        { $parentRunId: string }
      >(
        "SELECT run_ownership.child_run_id, child.status, run_ownership.spawn_order FROM run_ownership JOIN runs AS child ON child.id = run_ownership.child_run_id LEFT JOIN run_child_outcome_observations AS observation ON observation.child_run_id = run_ownership.child_run_id WHERE run_ownership.parent_run_id = $parentRunId AND child.status != 'succeeded' AND observation.child_run_id IS NULL ORDER BY run_ownership.spawn_order LIMIT 1",
      )
      .get({ $parentRunId: parentRunId });
    return row === null
      ? null
      : {
          childRunId: row.child_run_id,
          status: row.status,
          spawnOrder: row.spawn_order,
        };
  }

  private insertOwnedChildRun(
    parentRunId: string,
    child: Run,
    maxOperations: number | null,
  ): void {
    const parent = this.#database
      .query<{ status: RunStatus }, { $parentRunId: string }>(
        "SELECT status FROM runs WHERE id = $parentRunId",
      )
      .get({ $parentRunId: parentRunId });
    if (parent === null)
      throw new Error(`parent run ${parentRunId} does not exist`);
    if (parent.status !== "running")
      throw new Error(`parent run ${parentRunId} is not running`);
    const childCount =
      this.#database
        .query<{ child_count: number }, { $parentRunId: string }>(
          "SELECT COUNT(*) AS child_count FROM run_ownership WHERE parent_run_id = $parentRunId",
        )
        .get({ $parentRunId: parentRunId })?.child_count ?? 0;
    if (childCount >= RUN_OWNERSHIP_LIMITS.maxChildren)
      throw new Error(
        "run " +
          parentRunId +
          " has reached the child limit of " +
          RUN_OWNERSHIP_LIMITS.maxChildren,
      );
    const parentDepth = this.ancestorRunIds(parentRunId).length - 1;
    if (parentDepth + 1 > RUN_OWNERSHIP_LIMITS.maxDepth)
      throw new Error(
        "run " +
          parentRunId +
          " has reached the ownership depth limit of " +
          RUN_OWNERSHIP_LIMITS.maxDepth,
      );
    this.insertRun(child);
    this.requireRunningRun(child.id);
    this.#database
      .query(
        "INSERT INTO run_ownership (child_run_id, parent_run_id, spawn_order, created_at) VALUES ($childRunId, $parentRunId, (SELECT COALESCE(MAX(spawn_order), 0) + 1 FROM run_ownership WHERE parent_run_id = $parentRunId), $createdAt)",
      )
      .run({
        $childRunId: child.id,
        $parentRunId: parentRunId,
        $createdAt: child.createdAt,
      });
    if (maxOperations !== null)
      this.insertRunOperationAllocation(
        child.id,
        maxOperations,
        child.createdAt,
      );
    this.appendEvent(parentRunId, "RunChildSpawned", child.createdAt, {
      childRunId: child.id,
    });
  }

  private insertRunOperationAllocation(
    runId: string,
    maxOperations: number,
    occurredAt: string,
  ): void {
    this.#database
      .query(
        "INSERT INTO run_operation_allocations (run_id, max_operations, created_at) VALUES ($runId, $maxOperations, $occurredAt)",
      )
      .run({
        $runId: runId,
        $maxOperations: maxOperations,
        $occurredAt: occurredAt,
      });
    this.appendEvent(runId, "RunOperationAllocationCreated", occurredAt, {
      maxOperations: String(maxOperations),
    });
  }

  private runIdForGraphExecution(executionId: string): string | null {
    const row = this.#database
      .query<{ run_id: string }, { $executionId: string }>(
        "SELECT run_id FROM run_graph_executions WHERE execution_id = $executionId",
      )
      .get({ $executionId: executionId });
    return row?.run_id ?? null;
  }

  private reserveOperationForRun(
    runId: string,
    operationId: string,
    occurredAt: string,
  ): void {
    this.requireRunningRun(runId);
    for (const ancestorRunId of this.ancestorRunIds(runId)) {
      const allocation = this.#database
        .query<{ max_operations: number }, { $runId: string }>(
          "SELECT max_operations FROM run_operation_allocations WHERE run_id = $runId",
        )
        .get({ $runId: ancestorRunId });
      if (allocation === null)
        throw new Error(`run ${ancestorRunId} has no operation allocation`);
      if (!Number.isSafeInteger(allocation.max_operations))
        throw new Error(
          "operation allocation is outside JavaScript safe integer range",
        );
      if (
        this.inclusiveReservedOperationCount(ancestorRunId) + 1 >
        allocation.max_operations
      )
        throw new Error(`run ${ancestorRunId} operation allocation exceeded`);
    }
    this.#database
      .query(
        "INSERT INTO graph_operation_reservations (operation_id, run_id, created_at) VALUES ($operationId, $runId, $occurredAt)",
      )
      .run({
        $operationId: operationId,
        $runId: runId,
        $occurredAt: occurredAt,
      });
    this.appendEvent(runId, "OperationReserved", occurredAt, {
      operationId,
      operations: "1",
    });
  }

  private rootRunId(runId: string): string {
    const ancestors = this.ancestorRunIds(runId);
    const rootRunId = ancestors[ancestors.length - 1];
    if (rootRunId === undefined) throw new Error(`run ${runId} does not exist`);
    return rootRunId;
  }

  private ancestorRunIds(runId: string): readonly string[] {
    return this.#database
      .query<{ run_id: string }, { $runId: string }>(
        "WITH RECURSIVE ancestors(run_id) AS (SELECT $runId UNION SELECT run_ownership.parent_run_id FROM run_ownership JOIN ancestors ON run_ownership.child_run_id = ancestors.run_id) SELECT run_id FROM ancestors",
      )
      .all({ $runId: runId })
      .map((row) => row.run_id);
  }

  private inclusiveReservedOperationCount(runId: string): number {
    const row = this.#database
      .query<{ reserved_operations: number }, { $runId: string }>(
        "WITH RECURSIVE subtree(run_id) AS (SELECT $runId UNION SELECT run_ownership.child_run_id FROM run_ownership JOIN subtree ON run_ownership.parent_run_id = subtree.run_id) SELECT COUNT(*) AS reserved_operations FROM graph_operation_reservations JOIN subtree ON subtree.run_id = graph_operation_reservations.run_id",
      )
      .get({ $runId: runId });
    const reservedOperations = row?.reserved_operations ?? 0;
    if (!Number.isSafeInteger(reservedOperations))
      throw new Error(
        "operation reservation count is outside JavaScript safe integer range",
      );
    return reservedOperations;
  }

  private attachGraphExecutionToRunInternal(
    runId: string,
    executionId: string,
    occurredAt: string,
  ): void {
    this.#database
      .query(
        "INSERT INTO run_graph_executions (run_id, execution_id, attached_at) VALUES ($runId, $executionId, $occurredAt)",
      )
      .run({
        $runId: runId,
        $executionId: executionId,
        $occurredAt: occurredAt,
      });
    this.appendEvent(runId, "GraphExecutionAttached", occurredAt, {
      executionId,
    });
  }

  private requireRunningRun(runId: string): void {
    const row = this.#database
      .query<{ status: RunStatus }, { $runId: string }>(
        "SELECT status FROM runs WHERE id = $runId",
      )
      .get({ $runId: runId });
    if (row === null) throw new Error(`run ${runId} does not exist`);
    if (row.status !== "running")
      throw new Error(`run ${runId} is not running`);
  }

  private insertRun(run: Run): void {
    this.#database
      .query(
        "INSERT INTO runs VALUES ($id, $taskType, $status, $createdAt, NULL, NULL)",
      )
      .run({
        $id: run.id,
        $taskType: run.taskType,
        $status: run.status,
        $createdAt: run.createdAt,
      });
    this.appendEvent(run.id, "RunRequested", run.createdAt, {
      taskType: run.taskType,
    });
  }

  private validateCompositionCheckpointDescriptor(input: {
    rootRef: string;
    cursor: string | null;
    refs: readonly string[];
  }): readonly string[] {
    if (input.refs.length > 32)
      throw new Error("composition checkpoint exceeds 32 references");
    const refs = [...input.refs];
    const refsJson = JSON.stringify(refs);
    const rootDescriptor = canonicalJson({
      cursor: input.cursor,
      refs,
      rootRef: input.rootRef,
    });
    if (Buffer.byteLength(rootDescriptor, "utf8") > 4096)
      throw new Error("composition checkpoint root descriptor exceeds 4 KiB");
    if (Buffer.byteLength(refsJson, "utf8") > 16 * 1024)
      throw new Error("composition checkpoint view exceeds 16 KiB");
    return refs;
  }

  private requireGraphDefinition(graphRef: string): void {
    const row = this.#database
      .query<{ ref: string }, { $graphRef: string }>(
        "SELECT ref FROM graph_definitions WHERE ref = $graphRef",
      )
      .get({ $graphRef: graphRef });
    if (row === null)
      throw new Error(`graph definition ${graphRef} does not exist`);
  }

  private persistDefinition(definition: GraphDefinition): void {
    const catalogue = asJson({
      ref: definition.manifest.ref,
      abstractions: [...definition.catalogue.abstractions]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ref, abstraction]) => ({ ref, contract: abstraction.contract })),
      schemas: [...definition.catalogue.schemas]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ref, schema]) => ({ ref, schema })),
    });
    const definitionJson = asJson({
      ref: definition.ref,
      catalogueRef: definition.manifest.ref,
      manifest: definition.manifest,
      graph: definition.graph,
      checked: definition.checked,
    });
    this.insertImmutableRecord(
      "graph_catalogues",
      definition.manifest.ref,
      catalogue,
    );
    this.insertImmutableDefinition(
      definition.ref,
      definition.manifest.ref,
      definitionJson,
    );
  }

  private upsertGraphExecution(
    executionId: string,
    graphRef: string,
    frame: GraphFrame,
    expectedRevision: number | null,
    occurredAt: string,
  ): void {
    if (frame.graphRef !== graphRef)
      throw new Error("frame graph reference does not match its definition");
    const frameJsonValue = asJson(frame);
    const frameJson = canonicalJson(frameJsonValue);
    const frameHash = hashCanonicalJson(frameJsonValue);
    if (expectedRevision === null) {
      this.#database
        .query(
          "INSERT INTO graph_executions (execution_id, graph_ref, revision, frame_encoding_version, frame_hash, frame_json, updated_at) VALUES ($executionId, $graphRef, 0, 1, $frameHash, $frameJson, $occurredAt)",
        )
        .run({
          $executionId: executionId,
          $graphRef: graphRef,
          $frameHash: frameHash,
          $frameJson: frameJson,
          $occurredAt: occurredAt,
        });
      return;
    }
    const updated = this.#database
      .query(
        "UPDATE graph_executions SET revision = $nextRevision, frame_encoding_version = 1, frame_hash = $frameHash, frame_json = $frameJson, updated_at = $occurredAt WHERE execution_id = $executionId AND graph_ref = $graphRef AND revision = $expectedRevision",
      )
      .run({
        $executionId: executionId,
        $graphRef: graphRef,
        $expectedRevision: expectedRevision,
        $nextRevision: expectedRevision + 1,
        $frameHash: frameHash,
        $frameJson: frameJson,
        $occurredAt: occurredAt,
      });
    if (updated.changes !== 1)
      throw new Error(
        `graph execution ${executionId} does not have expected frame revision ${expectedRevision}`,
      );
  }

  private insertImmutableRecord(
    table: "graph_catalogues",
    ref: string,
    value: JsonValue,
  ): void {
    const canonical = canonicalJson(value);
    const hash = hashCanonicalJson(value);
    const existing = this.#database
      .query<{ content_hash: string }, { $ref: string }>(
        `SELECT content_hash FROM ${table} WHERE ref = $ref`,
      )
      .get({ $ref: ref });
    if (existing !== null) {
      if (existing.content_hash !== hash)
        throw new Error(
          `${table} ${ref} conflicts with an existing immutable record`,
        );
      return;
    }
    this.#database
      .query(
        "INSERT INTO graph_catalogues (ref, content_hash, canonical_json, encoding_version) VALUES ($ref, $hash, $canonical, 1)",
      )
      .run({ $ref: ref, $hash: hash, $canonical: canonical });
  }

  private insertImmutableDefinition(
    ref: string,
    catalogueRef: string,
    value: JsonValue,
  ): void {
    const canonical = canonicalJson(value);
    const hash = hashCanonicalJson(value);
    const existing = this.#database
      .query<{ content_hash: string }, { $ref: string }>(
        "SELECT content_hash FROM graph_definitions WHERE ref = $ref",
      )
      .get({ $ref: ref });
    if (existing !== null) {
      if (existing.content_hash !== hash)
        throw new Error(
          `graph definition ${ref} conflicts with an existing immutable record`,
        );
      return;
    }
    this.#database
      .query(
        "INSERT INTO graph_definitions (ref, catalogue_ref, content_hash, canonical_json, encoding_version) VALUES ($ref, $catalogueRef, $hash, $canonical, 1)",
      )
      .run({
        $ref: ref,
        $catalogueRef: catalogueRef,
        $hash: hash,
        $canonical: canonical,
      });
  }

  private appendGraphLifecycleEvent(
    executionId: string,
    operationId: string,
    kind: "dispatched" | "indeterminate",
    occurredAt: string,
  ): void {
    this.#database
      .query(
        "INSERT INTO graph_operation_lifecycle_events (execution_id, operation_id, kind, occurred_at, payload_json) VALUES ($executionId, $operationId, $kind, $occurredAt, '{}')",
      )
      .run({
        $executionId: executionId,
        $operationId: operationId,
        $kind: kind,
        $occurredAt: occurredAt,
      });
  }

  private appendGraphOperationEvent(
    executionId: string,
    operationId: string,
    kind: "planned" | "observed",
    occurredAt: string,
    payload: JsonValue,
  ): void {
    this.#database
      .query(
        "INSERT INTO graph_operation_events (execution_id, operation_id, kind, occurred_at, payload_json) VALUES ($executionId, $operationId, $kind, $occurredAt, $payload)",
      )
      .run({
        $executionId: executionId,
        $operationId: operationId,
        $kind: kind,
        $occurredAt: occurredAt,
        $payload: canonicalJson(payload),
      });
  }
}

function eventKindForTerminalStatus(
  status: Exclude<RunStatus, "running">,
): EventKind {
  if (status === "succeeded") return "RunCompleted";
  if (status === "cancelled") return "RunCancelled";
  return "RunFailed";
}

function validateOperationAllocation(maxOperations: number): void {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0)
    throw new Error("operation allocation must be a non-negative safe integer");
}

function validateReconciliationAttribution(
  attribution: GraphOperationReconciliationAttribution,
): void {
  if (
    !isBoundedText(attribution.adapterRef) ||
    !isBoundedText(attribution.externalOperationId) ||
    !isJsonValue(attribution.evidence)
  )
    throw new Error("reconciliation attribution is invalid");
}

function isBoundedText(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 256;
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function parseCanonicalJson(text: string, label: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!isJsonValue(value) || canonicalJson(value) !== text)
    throw new Error(`${label} is not canonical JSON`);
  return value;
}

function parseCanonicalRecord(
  text: string,
  hash: string,
  label: string,
): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!isJsonValue(value)) throw new Error(`${label} is not a JSON value`);
  if (canonicalJson(value) !== text || hashCanonicalJson(value) !== hash)
    throw new Error(`${label} failed canonical hash verification`);
  return value;
}

function verifyPinnedDefinition(
  definition: JsonValue,
  catalogue: JsonValue,
  graphRef: string,
  executionId: string,
): void {
  if (!isJsonObject(definition) || !isJsonObject(catalogue))
    throw new Error(
      `graph execution ${executionId} has malformed pinned artifacts`,
    );
  requireExactKeys(
    definition,
    ["catalogueRef", "checked", "graph", "manifest", "ref"],
    `graph execution ${executionId} definition`,
  );
  requireExactKeys(
    catalogue,
    ["abstractions", "ref", "schemas"],
    `graph execution ${executionId} catalogue`,
  );
  if (
    definition.ref !== graphRef ||
    typeof definition.catalogueRef !== "string"
  )
    throw new Error(
      `graph execution ${executionId} has a mismatched definition reference`,
    );
  const manifest = requiredField(definition, "manifest");
  if (!isJsonObject(manifest))
    throw new Error(`graph execution ${executionId} has malformed manifest`);
  requireExactKeys(
    manifest,
    ["abstractions", "ref", "schemas"],
    `graph execution ${executionId} manifest`,
  );
  if (
    manifest.ref !== definition.catalogueRef ||
    catalogue.ref !== definition.catalogueRef
  )
    throw new Error(
      `graph execution ${executionId} has a mismatched catalogue reference`,
    );
  const decodedGraph = decodeGraph(requiredField(definition, "graph"));
  if ("reason" in decodedGraph)
    throw new Error(
      `graph execution ${executionId} has invalid graph syntax: ${decodedGraph.reason}`,
    );
  const manifestAbstractions = referenceArray(
    requiredField(manifest, "abstractions"),
    `graph execution ${executionId} manifest abstractions`,
  );
  const manifestSchemas = referenceArray(
    requiredField(manifest, "schemas"),
    `graph execution ${executionId} manifest schemas`,
  );
  const catalogueAbstractions = entryReferences(
    requiredField(catalogue, "abstractions"),
    "contract",
    `graph execution ${executionId} catalogue abstractions`,
  );
  const catalogueSchemas = entryReferences(
    requiredField(catalogue, "schemas"),
    "schema",
    `graph execution ${executionId} catalogue schemas`,
  );
  if (
    !sameSorted(manifestAbstractions, catalogueAbstractions) ||
    !sameSorted(manifestSchemas, catalogueSchemas)
  )
    throw new Error(
      `graph execution ${executionId} manifest does not match catalogue`,
    );
}

function requireExactKeys(
  value: Readonly<{ [key: string]: JsonValue }>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  if (!sameSorted(actual, keys))
    throw new Error(`${label} has an invalid shape`);
}

function requiredField(
  value: Readonly<{ [key: string]: JsonValue }>,
  key: string,
): JsonValue {
  const field = value[key];
  if (field === undefined) throw new Error(`missing persisted field: ${key}`);
  return field;
}

function referenceArray(value: JsonValue, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`${label} is not an exact reference list`);
  const references = [...value] as string[];
  if (new Set(references).size !== references.length)
    throw new Error(`${label} contains duplicate references`);
  return references.sort();
}

function entryReferences(
  value: JsonValue,
  payloadKey: string,
  label: string,
): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an entry list`);
  const references: string[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry) || typeof entry.ref !== "string")
      throw new Error(`${label} contains an invalid reference`);
    const payload = requiredField(entry, payloadKey);
    if (!isJsonObject(payload))
      throw new Error(`${label} contains an invalid payload`);
    references.push(entry.ref);
  }
  if (new Set(references).size !== references.length)
    throw new Error(`${label} contains duplicate references`);
  return references.sort();
}

function sameSorted(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const left = [...first].sort();
  const right = [...second].sort();
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return typeof value !== "number" || Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonObject(
  value: JsonValue,
): value is Readonly<{ [key: string]: JsonValue }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    taskType: row.task_type,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    outcome: row.outcome,
  };
}
