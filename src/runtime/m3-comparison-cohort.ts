import type { JsonValue } from "../core/graph.ts";
import type {
  M3ComparisonObservation,
  M3ComparisonProtocol,
  M3ComparisonReport,
} from "../experiments/m3-comparison-protocol.ts";
import { assembleM3ComparisonReport } from "../experiments/m3-comparison-protocol.ts";
import type { SqliteRunStore } from "../storage/sqlite.ts";

type ObjectValue = Readonly<Record<string, JsonValue>>;

function object(value: JsonValue, label: string): ObjectValue {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}

function nullableNumber(value: JsonValue, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a non-negative number or null`);
  return value;
}

function boolean(value: JsonValue, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function terminalObservation(terminal: JsonValue): Readonly<{
  usage: M3ComparisonObservation["usage"];
  commandExecutions: number;
  toolCalls: number;
}> {
  const root = object(terminal, "provider terminal");
  const usage = object(root.usage ?? null, "provider usage");
  const accounting = object(root.accounting ?? null, "provider accounting");
  return {
    usage: {
      inputTokens: nullableNumber(usage.inputTokens ?? null, "input tokens"),
      cachedInputTokens: nullableNumber(
        usage.cachedInputTokens ?? null,
        "cached input tokens",
      ),
      outputTokens: nullableNumber(usage.outputTokens ?? null, "output tokens"),
      totalTokens: nullableNumber(usage.totalTokens ?? null, "total tokens"),
      known: boolean(usage.known ?? null, "usage known"),
    },
    commandExecutions:
      nullableNumber(
        accounting.commandExecutions ?? null,
        "command executions",
      ) ?? 0,
    toolCalls: nullableNumber(accounting.toolCalls ?? null, "tool calls") ?? 0,
  };
}

/** Rebuild comparison inputs from durable cohort references; callers supply no metrics. */
export function m3ComparisonObservationsFromCohort(
  store: SqliteRunStore,
  cohortRef: string,
): readonly M3ComparisonObservation[] {
  return store.listM3EvaluationCohortObservations(cohortRef).map((entry) => {
    const evaluation = store.getM3TaskEvaluation(entry.evaluationId);
    const attempt = store.getProviderAttempt(entry.providerAttemptId);
    if (evaluation === null || attempt === null || attempt.terminal === null)
      throw new Error(
        "M3 cohort evidence no longer resolves its durable records",
      );
    const terminal = terminalObservation(attempt.terminal);
    return {
      taskRef: evaluation.taskRef,
      sourceFingerprint: evaluation.sourceFingerprint,
      split: evaluation.split,
      variantRef: evaluation.variantRef,
      modelRef: attempt.modelRef,
      executorRef: attempt.executorRef,
      configurationFingerprint: attempt.configurationFingerprint,
      evaluatorRef: evaluation.evaluatorRef,
      evaluatorFingerprint: evaluation.evaluatorFingerprint,
      profileRef: evaluation.profileRef,
      outcome: entry.outcome,
      ...terminal,
    };
  });
}

export function assembleM3ComparisonCohortReport(
  store: SqliteRunStore,
  cohortRef: string,
  protocol: M3ComparisonProtocol,
): M3ComparisonReport {
  return assembleM3ComparisonReport(
    protocol,
    m3ComparisonObservationsFromCohort(store, cohortRef),
  );
}
