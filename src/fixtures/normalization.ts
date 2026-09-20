import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import type { Contract, SchemaDefinition } from "../core/contracts.ts";
import { parseVerifierRef } from "../core/contracts.ts";
import type {
  AbstractionRef,
  Graph,
  GraphCatalogue,
  JsonValue,
  SchemaRef,
} from "../core/graph.ts";
import {
  type CatalogueManifestRef,
  createCatalogueManifest,
  defineGraph,
  type GraphDefinition,
} from "../core/graph-definition.ts";
import type { GraphRef } from "../core/graph-frame.ts";
import type { GraphEvidence } from "../storage/sqlite.ts";

const ref = <T extends string>(value: T) => value;
const input = ref("normalization/decoded@1") as SchemaRef;
const output = ref("normalization/canonical@1") as SchemaRef;
const records = ref("normalization/records@1") as SchemaRef;
const batchId = ref("normalization/batch-id@1") as SchemaRef;
const recordCount = ref("normalization/record-count@1") as SchemaRef;
const fastCapability = ref("normalization/fast@1") as AbstractionRef;
const slowCapability = ref("normalization/slow@1") as AbstractionRef;
const manifestRef = ref("normalization/catalogue@1") as CatalogueManifestRef;

function contract(capability: AbstractionRef): Contract {
  return {
    input,
    output,
    effect: {
      capabilities: [capability],
      reads: [],
      writes: [],
      maxOperations: 1,
    },
    failures: [],
    verifier: parseVerifierRef(
      "normalization/verifier@1",
    ) as Contract["verifier"],
    assumptions: [],
    assurance: "authored",
  };
}

const schemas = new Map<SchemaRef, SchemaDefinition>([
  [
    input,
    {
      kind: "record",
      ref: input,
      fields: [
        { name: "batch_id", schema: batchId },
        { name: "records", schema: records },
        {
          name: "record_count",
          schema: recordCount,
          predicateDomain: { kind: "integer", minimum: 0, maximum: 2 },
        },
      ],
    },
  ],
  [records, { kind: "atomic", ref: records }],
  [batchId, { kind: "atomic", ref: batchId }],
  [recordCount, { kind: "atomic", ref: recordCount }],
  [output, { kind: "atomic", ref: output }],
]);

export const normalizationCatalogue: GraphCatalogue = {
  abstractions: new Map([
    [
      fastCapability,
      { ref: fastCapability, contract: contract(fastCapability) },
    ],
    [
      slowCapability,
      { ref: slowCapability, contract: contract(slowCapability) },
    ],
  ]),
  schemas,
};

export const normalizationRefs = Object.freeze({
  input,
  output,
  fastCapability,
  slowCapability,
  manifest: manifestRef,
  baseline: ref("normalization/baseline@1") as GraphRef,
  revised: ref("normalization/revised@1") as GraphRef,
});

const manifest = createCatalogueManifest(manifestRef, normalizationCatalogue);

function definition(refValue: GraphRef, graph: Graph): GraphDefinition {
  const result = defineGraph(refValue, graph, manifest, normalizationCatalogue);
  if ("kind" in result)
    throw new Error(`invalid normalization fixture: ${result.kind}`);
  return result;
}

export const normalizationBaseline = definition(normalizationRefs.baseline, {
  kind: "call",
  abstraction: slowCapability,
});
export const normalizationRevised = definition(normalizationRefs.revised, {
  kind: "route",
  input,
  predicate: { kind: "integerAtMost", field: "record_count", value: 1 },
  whenTrue: { kind: "call", abstraction: fastCapability },
  whenFalse: { kind: "call", abstraction: slowCapability },
});

export type NormalizationRecord = Readonly<{
  id: string;
  value: string;
}>;

export type NormalizationResult = Readonly<{
  batchId: string;
  records: readonly NormalizationRecord[];
  complete: true;
  audit: readonly Readonly<{ inputId: string; outputIndex: number }>[];
}>;

export type PersistedNormalizationEvidence = Readonly<{
  executionId: string;
  candidateRef: string;
  result: NormalizationResult;
  calls: readonly string[];
}>;

export type PersistedNormalizationDomainEvidence = Readonly<{
  executionId: string;
  candidateRef: string;
  result: NormalizationResult;
  calls: readonly string[];
}>;

/** The small finite domain used by the offline admission fixture. */
export const normalizationFiniteDomain: readonly (readonly NormalizationRecord[])[] =
  Object.freeze([
    [],
    [{ id: "a", value: "a" }],
    [{ id: "a", value: "b" }],
    [
      { id: "a", value: "a" },
      { id: "b", value: "b" },
    ],
    [
      { id: "a", value: "b" },
      { id: "b", value: "a" },
    ],
  ]);

export function normalizationCapabilityFor(
  records: readonly NormalizationRecord[],
): AbstractionRef {
  if (records.length > 2)
    throw new Error("normalization fixture input exceeds finite domain");
  return records.length <= 1 ? fastCapability : slowCapability;
}

export function evaluateNormalization(
  batchId: string,
  records: readonly NormalizationRecord[],
): NormalizationResult {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id))
      throw new Error(`duplicate normalization record: ${record.id}`);
    seen.add(record.id);
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const ordered = records
    .map((record) => ({ ...record }))
    .sort(
      (left, right) =>
        compare(left.value, right.value) || compare(left.id, right.id),
    );
  return {
    batchId,
    records: ordered,
    complete: true,
    audit: ordered.map((record, outputIndex) => ({
      inputId: record.id,
      outputIndex,
    })),
  };
}

/**
 * The finite fixture's actual capability boundary. Fast is only defined for
 * the route's zero- or one-record domain; slow remains defined throughout.
 */
export function executeNormalizationCapability(
  capability: AbstractionRef,
  batchId: string,
  records: readonly NormalizationRecord[],
): NormalizationResult {
  if (capability !== fastCapability && capability !== slowCapability)
    throw new Error("unknown normalization capability");
  if (
    capability === fastCapability &&
    normalizationCapabilityFor(records) !== fastCapability
  )
    throw new Error(
      "fast normalization capability is ineligible for this input",
    );
  return evaluateNormalization(batchId, records);
}

export function admitNormalizationEvidence(
  result: NormalizationResult,
): boolean {
  if (!result.complete || result.audit.length !== result.records.length)
    return false;
  const seen = new Set<string>();
  for (const [index, audit] of result.audit.entries()) {
    const record = result.records[index];
    if (
      record === undefined ||
      audit.inputId !== record.id ||
      audit.outputIndex !== index
    )
      return false;
    if (seen.has(audit.inputId)) return false;
    seen.add(audit.inputId);
  }
  return true;
}

/** Convert an admitted evaluator result into the immutable storage record used by proposals. */
export function createNormalizationEvidence(
  evidenceId: string,
  result: NormalizationResult,
  admittedAt: string,
  inputRecords: readonly NormalizationRecord[],
  candidateRef: GraphRef,
): Omit<GraphEvidence, "admittedAt"> & { admittedAt: string } {
  if (!admitNormalizationEvidence(result))
    throw new Error("normalization evidence was not admitted");
  const payload: JsonValue = {
    version: 1,
    candidateRef,
    manifestRef,
    evaluatorRef: "normalization/evaluator@2",
    input: { batchId: result.batchId, records: inputRecords },
    result,
  };
  validateNormalizationEvidence(payload, candidateRef);
  return {
    evidenceId,
    evidenceKind: "normalization/evaluation",
    subjectRef: candidateRef,
    fingerprint: hashCanonicalJson(payload),
    payload,
    admittedAt,
  };
}

/** Creates evidence only after the candidate's owned frame reached its terminal result. */
export function createPersistedNormalizationEvidence(
  evidenceId: string,
  execution: PersistedNormalizationEvidence,
  admittedAt: string,
  inputRecords: readonly NormalizationRecord[],
): Omit<GraphEvidence, "admittedAt"> & { admittedAt: string } {
  const payload: JsonValue = {
    version: 2,
    candidateRef: execution.candidateRef,
    manifestRef,
    evaluatorRef: "normalization/persisted-evaluator@1",
    input: { batchId: execution.result.batchId, records: inputRecords },
    execution,
  };
  validateNormalizationEvidence(payload, execution.candidateRef);
  return {
    evidenceId,
    evidenceKind: "normalization/evaluation",
    subjectRef: execution.candidateRef,
    fingerprint: hashCanonicalJson(payload),
    payload,
    admittedAt,
  };
}

/**
 * The admission-grade envelope binds every member of the frozen finite domain
 * to a distinct persisted execution. Version 2 remains readable but cannot
 * authorize a new normalization revision.
 */
export function createPersistedNormalizationDomainEvidence(
  evidenceId: string,
  executions: readonly PersistedNormalizationDomainEvidence[],
  admittedAt: string,
): Omit<GraphEvidence, "admittedAt"> & { admittedAt: string } {
  const payload: JsonValue = {
    version: 3,
    candidateRef: executions[0]?.candidateRef ?? "",
    manifestRef,
    evaluatorRef: "normalization/persisted-domain-evaluator@1",
    cases: executions.map((execution, index) => ({
      input: {
        batchId: execution.result.batchId,
        records: normalizationFiniteDomain[index] ?? [],
      },
      execution,
    })),
  };
  const candidateRef = executions[0]?.candidateRef;
  if (candidateRef === undefined)
    throw new Error("normalization domain evidence requires executions");
  validateNormalizationEvidence(payload, candidateRef);
  return {
    evidenceId,
    evidenceKind: "normalization/evaluation",
    subjectRef: candidateRef,
    fingerprint: hashCanonicalJson(payload),
    payload,
    admittedAt,
  };
}

/** Validate the persisted fixture envelope, including source/output preservation. */
export function validateNormalizationEvidence(
  value: unknown,
  candidateRef: string,
): void {
  const object = (value: unknown): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid normalization evidence");
    return value as Record<string, unknown>;
  };
  const payload = object(value);
  if (
    (payload.version !== 1 && payload.version !== 2 && payload.version !== 3) ||
    payload.candidateRef !== candidateRef ||
    payload.manifestRef !== manifestRef ||
    (payload.evaluatorRef !== "normalization/evaluator@2" &&
      payload.evaluatorRef !== "normalization/persisted-evaluator@1" &&
      payload.evaluatorRef !== "normalization/persisted-domain-evaluator@1") ||
    (candidateRef !== normalizationRefs.baseline &&
      candidateRef !== normalizationRefs.revised)
  )
    throw new Error("invalid normalization evidence");
  const recordsFor = (value: unknown): NormalizationRecord[] => {
    const source = object(value);
    if (typeof source.batchId !== "string" || !Array.isArray(source.records))
      throw new Error("invalid normalization evidence");
    return source.records.map((value) => {
      const record = object(value);
      if (typeof record.id !== "string" || typeof record.value !== "string")
        throw new Error("invalid normalization evidence");
      return { id: record.id, value: record.value };
    });
  };
  if (payload.version === 3) {
    if (
      !Array.isArray(payload.cases) ||
      payload.cases.length !== normalizationFiniteDomain.length
    )
      throw new Error("invalid normalization domain evidence");
    const executionIds = new Set<string>();
    const batchIds = new Set<string>();
    for (const [index, value] of payload.cases.entries()) {
      const entry = object(value);
      const input = object(entry.input);
      const records = recordsFor(input);
      if (
        canonicalJson(records as JsonValue) !==
          canonicalJson(
            (normalizationFiniteDomain[index] ?? []) as JsonValue,
          ) ||
        typeof input.batchId !== "string" ||
        !input.batchId ||
        batchIds.has(input.batchId)
      )
        throw new Error("invalid normalization domain evidence");
      batchIds.add(input.batchId);
      const execution = object(entry.execution);
      if (
        typeof execution.executionId !== "string" ||
        executionIds.has(execution.executionId) ||
        execution.candidateRef !== candidateRef ||
        !Array.isArray(execution.calls) ||
        !execution.calls.every((call) => typeof call === "string") ||
        canonicalJson(execution.result as JsonValue) !==
          canonicalJson(
            evaluateNormalization(input.batchId, records) as JsonValue,
          ) ||
        canonicalJson(execution.calls as JsonValue) !==
          canonicalJson([
            candidateRef === normalizationRefs.baseline
              ? slowCapability
              : normalizationCapabilityFor(records),
          ])
      )
        throw new Error("invalid normalization domain evidence");
      executionIds.add(execution.executionId);
    }
    return;
  }
  const source = object(payload.input);
  const records = recordsFor(source);
  const sourceBatchId = source.batchId;
  if (typeof sourceBatchId !== "string")
    throw new Error("invalid normalization evidence");
  const expected = evaluateNormalization(sourceBatchId, records);
  if (
    payload.version === 1 &&
    canonicalJson(payload.result as JsonValue) !== canonicalJson(expected)
  )
    throw new Error("invalid normalization evidence");
  if (payload.version === 2) {
    const execution = object(payload.execution);
    if (
      typeof execution.executionId !== "string" ||
      execution.candidateRef !== candidateRef ||
      !Array.isArray(execution.calls) ||
      !execution.calls.every((call) => typeof call === "string") ||
      canonicalJson(execution.result as JsonValue) !==
        canonicalJson(expected) ||
      canonicalJson(execution.calls as JsonValue) !==
        canonicalJson([
          candidateRef === normalizationRefs.baseline
            ? slowCapability
            : normalizationCapabilityFor(records),
        ])
    )
      throw new Error("invalid normalization evidence");
  }
}

export function persistedNormalizationEvidenceExecutions(
  value: unknown,
  candidateRef: string,
): readonly Readonly<{ executionId: string; result: NormalizationResult }>[] {
  validateNormalizationEvidence(value, candidateRef);
  const payload = value as Record<string, unknown>;
  if (payload.version !== 3 || !Array.isArray(payload.cases))
    throw new Error("normalization evidence requires a persisted domain");
  return payload.cases.map((value) => {
    const execution = (value as Record<string, unknown>).execution as Record<
      string,
      unknown
    >;
    return {
      executionId: execution.executionId as string,
      result: execution.result as NormalizationResult,
    };
  });
}

/** @deprecated Version 2 helper retained only for historical-record reads. */
export function persistedNormalizationEvidenceExecution(
  value: unknown,
  candidateRef: string,
): Readonly<{ executionId: string; result: NormalizationResult }> {
  validateNormalizationEvidence(value, candidateRef);
  const payload = value as Record<string, unknown>;
  if (
    payload.version !== 2 ||
    payload.execution === null ||
    typeof payload.execution !== "object"
  )
    throw new Error("normalization evidence requires a persisted execution");
  const execution = payload.execution as Record<string, unknown>;
  return {
    executionId: execution.executionId as string,
    result: execution.result as NormalizationResult,
  };
}
