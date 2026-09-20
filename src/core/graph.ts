import type {
  Contract,
  PredicateDomain,
  SchemaCatalogue,
  SchemaDefinition,
} from "./contracts.ts";

declare const schemaRefBrand: unique symbol;
declare const abstractionRefBrand: unique symbol;

export type SchemaRef = string & Readonly<{ [schemaRefBrand]: "SchemaRef" }>;

export type AbstractionRef = string &
  Readonly<{ [abstractionRefBrand]: "AbstractionRef" }>;

export type InvalidSchemaRef = Readonly<{
  kind: "InvalidSchemaRef";
  value: string;
}>;

export type InvalidAbstractionRef = Readonly<{
  kind: "InvalidAbstractionRef";
  value: string;
}>;

export type Graph =
  | Readonly<{ kind: "id"; schema: SchemaRef }>
  | Readonly<{ kind: "call"; abstraction: AbstractionRef }>
  | Readonly<{
      kind: "wire";
      input: SchemaRef;
      output: SchemaRef;
      fields: readonly WireField[];
    }>
  | Readonly<{
      kind: "route";
      input: SchemaRef;
      predicate: Predicate;
      whenTrue: Graph;
      whenFalse: Graph;
    }>
  | Readonly<{
      kind: "guard";
      input: SchemaRef;
      predicate: Predicate;
      body: Graph;
    }>
  | Readonly<{
      kind: "retry";
      maxAttempts: number;
      witness: RetryWitness;
      body: Graph;
    }>
  | Readonly<{ kind: "seq"; first: Graph; second: Graph }>;

/** A closed, authored statement that makes each bounded retry admissible. */
export type RetryWitness = Readonly<{
  precondition: SchemaRef;
  maxAttempts: number;
  retryableFailures: readonly string[];
  restoration: "sameInput";
  idempotency: "required";
  effectCeiling: EffectBound;
}>;

export type WireField = Readonly<{
  from: string;
  to: string;
}>;

export type Predicate =
  | Readonly<{ kind: "true" }>
  | Readonly<{ kind: "false" }>
  | Readonly<{ kind: "not"; term: Predicate }>
  | Readonly<{ kind: "and"; left: Predicate; right: Predicate }>
  | Readonly<{ kind: "or"; left: Predicate; right: Predicate }>
  | Readonly<{ kind: "tagEquals"; field: string; value: string }>
  | Readonly<{ kind: "integerAtMost"; field: string; value: number }>
  | Readonly<{ kind: "integerAtLeast"; field: string; value: number }>;

export type EffectBound = Readonly<{
  capabilities: readonly string[];
  reads: readonly string[];
  writes: readonly string[];
  maxOperations: number;
}>;

export type CallableAbstraction = Readonly<{
  ref: AbstractionRef;
  contract: Contract;
}>;

export type GraphCatalogue = Readonly<{
  abstractions: ReadonlyMap<AbstractionRef, CallableAbstraction>;
  schemas: SchemaCatalogue;
}>;

export type CheckedGraph = Readonly<{
  graph: Graph;
  input: SchemaRef;
  output: SchemaRef;
  effect: EffectBound;
  calls: readonly AbstractionRef[];
  failures: readonly string[];
}>;

export type GraphCheckError =
  | Readonly<{
      kind: "UnknownAbstraction";
      path: readonly GraphPathSegment[];
      abstraction: AbstractionRef;
    }>
  | Readonly<{
      kind: "SequenceInterfaceMismatch";
      path: readonly GraphPathSegment[];
      firstOutput: SchemaRef;
      secondInput: SchemaRef;
    }>
  | Readonly<{
      kind: "UnknownSchema";
      path: readonly GraphPathSegment[];
      schema: SchemaRef;
    }>
  | Readonly<{
      kind: "WireRequiresRecordSchemas";
      path: readonly GraphPathSegment[];
      input: SchemaRef;
      output: SchemaRef;
    }>
  | Readonly<{
      kind: "WireUnknownSourceField";
      path: readonly GraphPathSegment[];
      field: string;
    }>
  | Readonly<{
      kind: "WireUnknownTargetField";
      path: readonly GraphPathSegment[];
      field: string;
    }>
  | Readonly<{
      kind: "WireDuplicateTargetField";
      path: readonly GraphPathSegment[];
      field: string;
    }>
  | Readonly<{
      kind: "WireMissingTargetField";
      path: readonly GraphPathSegment[];
      field: string;
    }>
  | Readonly<{
      kind: "WireFieldSchemaMismatch";
      path: readonly GraphPathSegment[];
      from: string;
      to: string;
      sourceSchema: SchemaRef;
      targetSchema: SchemaRef;
    }>
  | Readonly<{
      kind: "PredicateRequiresRecordInput";
      path: readonly GraphPathSegment[];
      input: SchemaRef;
    }>
  | Readonly<{
      kind: "PredicateUnknownField";
      path: readonly GraphPathSegment[];
      field: string;
    }>
  | Readonly<{
      kind: "PredicateUndeclaredDomain";
      path: readonly GraphPathSegment[];
      field: string;
    }>
  | Readonly<{
      kind: "PredicateValueOutsideDomain";
      path: readonly GraphPathSegment[];
      field: string;
      value: string | number;
    }>
  | Readonly<{
      kind: "RouteBranchInputMismatch";
      path: readonly GraphPathSegment[];
      branch: "whenTrue" | "whenFalse";
      expected: SchemaRef;
      actual: SchemaRef;
    }>
  | Readonly<{
      kind: "RouteBranchOutputMismatch";
      path: readonly GraphPathSegment[];
      trueOutput: SchemaRef;
      falseOutput: SchemaRef;
    }>
  | Readonly<{
      kind: "GuardBodyInputMismatch";
      path: readonly GraphPathSegment[];
      expected: SchemaRef;
      actual: SchemaRef;
    }>
  | Readonly<{
      kind: "InvalidRetryAttempts";
      path: readonly GraphPathSegment[];
      maxAttempts: number;
    }>
  | Readonly<{
      kind: "RetryWitnessInputMismatch";
      path: readonly GraphPathSegment[];
      expected: SchemaRef;
      actual: SchemaRef;
    }>
  | Readonly<{
      kind: "RetryWitnessAttemptBoundExceeded";
      path: readonly GraphPathSegment[];
      maxAttempts: number;
      witnessMaximum: number;
    }>
  | Readonly<{
      kind: "RetryWitnessUndeclaredFailure";
      path: readonly GraphPathSegment[];
      failure: string;
    }>
  | Readonly<{
      kind: "RetryWitnessMissingFailures";
      path: readonly GraphPathSegment[];
    }>
  | Readonly<{
      kind: "RetryEffectExceedsWitness";
      path: readonly GraphPathSegment[];
      required: EffectBound;
      allowed: EffectBound;
    }>;

export type GraphPathSegment =
  | "first"
  | "second"
  | "whenTrue"
  | "whenFalse"
  | "body";

export type GraphDecodeError = Readonly<{
  kind: "InvalidGraph";
  path: readonly string[];
  reason:
    | "ExpectedObject"
    | "MissingField"
    | "UnexpectedField"
    | "InvalidKind"
    | "InvalidSchemaRef"
    | "InvalidAbstractionRef"
    | "ExpectedArray"
    | "InvalidWireField"
    | "InvalidPredicate"
    | "InvalidRetry";
}>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

export interface GraphInterpreter {
  call(abstraction: CallableAbstraction, input: JsonValue): GraphCallResult;
}

export type GraphCallResult =
  | Readonly<{ kind: "succeeded"; output: JsonValue }>
  | Readonly<{ kind: "failed"; failure: string }>;

export type GraphExecution =
  | Readonly<{
      kind: "succeeded";
      output: JsonValue;
      calls: readonly AbstractionRef[];
      effect: EffectBound;
    }>
  | Readonly<{
      kind: "failed";
      failure: "GuardRejected" | "OperationFailed";
      detail: string | null;
      calls: readonly AbstractionRef[];
      effect: EffectBound;
    }>;

type GraphStep =
  | Readonly<{ kind: "succeeded"; output: JsonValue }>
  | Readonly<{
      kind: "failed";
      failure: "GuardRejected" | "OperationFailed";
      detail: string | null;
    }>;

export type GraphContractCheckError =
  | GraphCheckError
  | Readonly<{
      kind: "ContractInputMismatch";
      expected: SchemaRef;
      actual: SchemaRef;
    }>
  | Readonly<{
      kind: "ContractOutputMismatch";
      expected: SchemaRef;
      actual: SchemaRef;
    }>
  | Readonly<{
      kind: "GraphFailureNotAllowed";
      failure: string;
    }>
  | Readonly<{
      kind: "GraphEffectExceedsContract";
      required: EffectBound;
      allowed: EffectBound;
    }>;

export const emptyEffectBound: EffectBound = {
  capabilities: [],
  reads: [],
  writes: [],
  maxOperations: 0,
};

const exactReferencePattern =
  /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*@[1-9][0-9]*$/;
const fieldNamePattern = /^[a-z][a-z0-9_]{0,63}$/;

export function parseSchemaRef(value: string): SchemaRef | InvalidSchemaRef {
  return exactReferencePattern.test(value)
    ? (value as SchemaRef)
    : { kind: "InvalidSchemaRef", value };
}

export function parseAbstractionRef(
  value: string,
): AbstractionRef | InvalidAbstractionRef {
  return exactReferencePattern.test(value)
    ? (value as AbstractionRef)
    : { kind: "InvalidAbstractionRef", value };
}

export function isSchemaRef(
  value: SchemaRef | InvalidSchemaRef,
): value is SchemaRef {
  return typeof value === "string";
}

export function isAbstractionRef(
  value: AbstractionRef | InvalidAbstractionRef,
): value is AbstractionRef {
  return typeof value === "string";
}

export function decodeGraph(value: unknown): Graph | GraphDecodeError {
  return decodeGraphAt(value, []);
}

export function checkGraph(
  graph: Graph,
  catalogue: GraphCatalogue,
): CheckedGraph | GraphCheckError {
  return checkGraphAt(graph, catalogue, []);
}

export function checkGraphAgainstContract(
  graph: Graph,
  catalogue: GraphCatalogue,
  contract: Contract,
): CheckedGraph | GraphContractCheckError {
  const checked = checkGraph(graph, catalogue);
  if (isGraphCheckError(checked)) return checked;
  if (checked.input !== contract.input) {
    return {
      kind: "ContractInputMismatch",
      expected: contract.input,
      actual: checked.input,
    };
  }
  if (checked.output !== contract.output) {
    return {
      kind: "ContractOutputMismatch",
      expected: contract.output,
      actual: checked.output,
    };
  }
  const disallowedFailure = checked.failures.find(
    (failure) => !contract.failures.includes(failure),
  );
  if (disallowedFailure !== undefined)
    return { kind: "GraphFailureNotAllowed", failure: disallowedFailure };
  if (!isEffectWithin(checked.effect, contract.effect)) {
    return {
      kind: "GraphEffectExceedsContract",
      required: checked.effect,
      allowed: contract.effect,
    };
  }
  return checked;
}

export function interpretGraph(
  graph: Graph,
  catalogue: GraphCatalogue,
  input: JsonValue,
  interpreter: GraphInterpreter,
): GraphExecution | GraphCheckError {
  const checked = checkGraph(graph, catalogue);
  if (isGraphCheckError(checked)) return checked;
  const calls: AbstractionRef[] = [];
  const execution = executeGraph(graph, catalogue, input, interpreter, calls);
  if (execution.kind === "failed") {
    return {
      kind: "failed",
      failure: execution.failure,
      detail: execution.detail,
      calls,
      effect: checked.effect,
    };
  }
  return {
    kind: "succeeded",
    output: execution.output,
    calls,
    effect: checked.effect,
  };
}

export function combineEffectBounds(
  first: EffectBound,
  second: EffectBound,
): EffectBound {
  const maxOperations = first.maxOperations + second.maxOperations;
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0)
    throw new Error("combined effect bound exceeds a safe integer");
  return {
    capabilities: mergeNames(first.capabilities, second.capabilities),
    reads: mergeNames(first.reads, second.reads),
    writes: mergeNames(first.writes, second.writes),
    maxOperations,
  };
}

export function repeatEffectBound(
  effect: EffectBound,
  attempts: number,
): EffectBound {
  const maxOperations = effect.maxOperations * attempts;
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0)
    throw new Error("repeated effect bound exceeds a safe integer");
  return { ...effect, maxOperations };
}

function decodeGraphAt(
  value: unknown,
  path: readonly string[],
): Graph | GraphDecodeError {
  if (!isRecord(value)) return invalidGraph(path, "ExpectedObject");
  const kind = value.kind;
  if (typeof kind !== "string")
    return invalidGraph([...path, "kind"], "InvalidKind");
  switch (kind) {
    case "id": {
      const shapeError = exactFields(value, ["kind", "schema"], path);
      if (shapeError !== null) return shapeError;
      if (typeof value.schema !== "string")
        return invalidGraph([...path, "schema"], "InvalidSchemaRef");
      const schema = parseSchemaRef(value.schema);
      return isSchemaRef(schema)
        ? { kind, schema }
        : invalidGraph([...path, "schema"], "InvalidSchemaRef");
    }
    case "call": {
      const shapeError = exactFields(value, ["kind", "abstraction"], path);
      if (shapeError !== null) return shapeError;
      if (typeof value.abstraction !== "string")
        return invalidGraph([...path, "abstraction"], "InvalidAbstractionRef");
      const abstraction = parseAbstractionRef(value.abstraction);
      return isAbstractionRef(abstraction)
        ? { kind, abstraction }
        : invalidGraph([...path, "abstraction"], "InvalidAbstractionRef");
    }
    case "wire": {
      const shapeError = exactFields(
        value,
        ["kind", "input", "output", "fields"],
        path,
      );
      if (shapeError !== null) return shapeError;
      if (typeof value.input !== "string")
        return invalidGraph([...path, "input"], "InvalidSchemaRef");
      if (typeof value.output !== "string")
        return invalidGraph([...path, "output"], "InvalidSchemaRef");
      const input = parseSchemaRef(value.input);
      if (!isSchemaRef(input))
        return invalidGraph([...path, "input"], "InvalidSchemaRef");
      const output = parseSchemaRef(value.output);
      if (!isSchemaRef(output))
        return invalidGraph([...path, "output"], "InvalidSchemaRef");
      const fields = decodeWireFields(value.fields, [...path, "fields"]);
      if (isGraphDecodeError(fields)) return fields;
      return { kind, input, output, fields };
    }
    case "route": {
      const shapeError = exactFields(
        value,
        ["kind", "input", "predicate", "whenTrue", "whenFalse"],
        path,
      );
      if (shapeError !== null) return shapeError;
      const input = decodeSchemaField(value.input, [...path, "input"]);
      if (isGraphDecodeError(input)) return input;
      const predicate = decodePredicate(value.predicate, [
        ...path,
        "predicate",
      ]);
      if (isGraphDecodeError(predicate)) return predicate;
      const whenTrue = decodeGraphAt(value.whenTrue, [...path, "whenTrue"]);
      if (isGraphDecodeError(whenTrue)) return whenTrue;
      const whenFalse = decodeGraphAt(value.whenFalse, [...path, "whenFalse"]);
      if (isGraphDecodeError(whenFalse)) return whenFalse;
      return { kind, input, predicate, whenTrue, whenFalse };
    }
    case "guard": {
      const shapeError = exactFields(
        value,
        ["kind", "input", "predicate", "body"],
        path,
      );
      if (shapeError !== null) return shapeError;
      const input = decodeSchemaField(value.input, [...path, "input"]);
      if (isGraphDecodeError(input)) return input;
      const predicate = decodePredicate(value.predicate, [
        ...path,
        "predicate",
      ]);
      if (isGraphDecodeError(predicate)) return predicate;
      const body = decodeGraphAt(value.body, [...path, "body"]);
      if (isGraphDecodeError(body)) return body;
      return { kind, input, predicate, body };
    }
    case "retry": {
      const shapeError = exactFields(
        value,
        ["kind", "maxAttempts", "witness", "body"],
        path,
      );
      if (shapeError !== null) return shapeError;
      if (
        typeof value.maxAttempts !== "number" ||
        !Number.isSafeInteger(value.maxAttempts) ||
        value.maxAttempts < 1
      )
        return invalidGraph([...path, "maxAttempts"], "InvalidRetry");
      const witness = decodeRetryWitness(value.witness, [...path, "witness"]);
      if (isGraphDecodeError(witness)) return witness;
      const body = decodeGraphAt(value.body, [...path, "body"]);
      if (isGraphDecodeError(body)) return body;
      return { kind, maxAttempts: value.maxAttempts, witness, body };
    }
    case "seq": {
      const shapeError = exactFields(value, ["kind", "first", "second"], path);
      if (shapeError !== null) return shapeError;
      const first = decodeGraphAt(value.first, [...path, "first"]);
      if (isGraphDecodeError(first)) return first;
      const second = decodeGraphAt(value.second, [...path, "second"]);
      if (isGraphDecodeError(second)) return second;
      return { kind, first, second };
    }
    default:
      return invalidGraph([...path, "kind"], "InvalidKind");
  }
}

function checkGraphAt(
  graph: Graph,
  catalogue: GraphCatalogue,
  path: readonly GraphPathSegment[],
): CheckedGraph | GraphCheckError {
  switch (graph.kind) {
    case "id":
      return {
        graph,
        input: graph.schema,
        output: graph.schema,
        effect: emptyEffectBound,
        calls: [],
        failures: [],
      };
    case "call": {
      const abstraction = catalogue.abstractions.get(graph.abstraction);
      if (abstraction === undefined) {
        return {
          kind: "UnknownAbstraction",
          path,
          abstraction: graph.abstraction,
        };
      }
      return {
        graph,
        input: abstraction.contract.input,
        output: abstraction.contract.output,
        effect: abstraction.contract.effect,
        calls: [abstraction.ref],
        failures: abstraction.contract.failures,
      };
    }
    case "wire":
      return checkWire(graph, catalogue.schemas, path);
    case "route":
      return checkRoute(graph, catalogue, path);
    case "guard":
      return checkGuard(graph, catalogue, path);
    case "retry":
      return checkRetry(graph, catalogue, path);
    case "seq": {
      const first = checkGraphAt(graph.first, catalogue, [...path, "first"]);
      if (isGraphCheckError(first)) return first;
      const second = checkGraphAt(graph.second, catalogue, [...path, "second"]);
      if (isGraphCheckError(second)) return second;
      if (first.output !== second.input) {
        return {
          kind: "SequenceInterfaceMismatch",
          path,
          firstOutput: first.output,
          secondInput: second.input,
        };
      }
      return {
        graph,
        input: first.input,
        output: second.output,
        effect: combineEffectBounds(first.effect, second.effect),
        calls: [...first.calls, ...second.calls],
        failures: mergeNames(first.failures, second.failures),
      };
    }
  }
}

function executeGraph(
  graph: Graph,
  catalogue: GraphCatalogue,
  input: JsonValue,
  interpreter: GraphInterpreter,
  calls: AbstractionRef[],
): GraphStep {
  switch (graph.kind) {
    case "id":
      return { kind: "succeeded", output: input };
    case "call": {
      const abstraction = catalogue.abstractions.get(graph.abstraction);
      if (abstraction === undefined)
        throw new Error(
          `checked abstraction disappeared: ${graph.abstraction}`,
        );
      calls.push(abstraction.ref);
      const result = interpreter.call(abstraction, input);
      return result.kind === "succeeded"
        ? result
        : {
            kind: "failed",
            failure: "OperationFailed",
            detail: result.failure,
          };
    }
    case "wire":
      return { kind: "succeeded", output: executeWire(graph, input) };
    case "route":
      return executeGraph(
        evaluatePredicate(graph.predicate, input)
          ? graph.whenTrue
          : graph.whenFalse,
        catalogue,
        input,
        interpreter,
        calls,
      );
    case "guard":
      return evaluatePredicate(graph.predicate, input)
        ? executeGraph(graph.body, catalogue, input, interpreter, calls)
        : { kind: "failed", failure: "GuardRejected", detail: null };
    case "retry": {
      for (let attempt = 1; attempt <= graph.maxAttempts; attempt += 1) {
        const result = executeGraph(
          graph.body,
          catalogue,
          input,
          interpreter,
          calls,
        );
        if (result.kind === "succeeded") return result;
        const retryable =
          result.failure === "GuardRejected" ? "GuardRejected" : result.detail;
        if (
          retryable === null ||
          !graph.witness.retryableFailures.includes(retryable) ||
          attempt === graph.maxAttempts
        )
          return result;
      }
      throw new Error("checked retry exhausted without an outcome");
    }
    case "seq": {
      const first = executeGraph(
        graph.first,
        catalogue,
        input,
        interpreter,
        calls,
      );
      return first.kind === "failed"
        ? first
        : executeGraph(
            graph.second,
            catalogue,
            first.output,
            interpreter,
            calls,
          );
    }
  }
}

function checkRoute(
  graph: Extract<Graph, Readonly<{ kind: "route" }>>,
  catalogue: GraphCatalogue,
  path: readonly GraphPathSegment[],
): CheckedGraph | GraphCheckError {
  const predicateError = checkPredicate(
    graph.predicate,
    graph.input,
    catalogue.schemas,
    path,
  );
  if (predicateError !== null) return predicateError;
  const whenTrue = checkGraphAt(graph.whenTrue, catalogue, [
    ...path,
    "whenTrue",
  ]);
  if (isGraphCheckError(whenTrue)) return whenTrue;
  const whenFalse = checkGraphAt(graph.whenFalse, catalogue, [
    ...path,
    "whenFalse",
  ]);
  if (isGraphCheckError(whenFalse)) return whenFalse;
  if (whenTrue.input !== graph.input) {
    return {
      kind: "RouteBranchInputMismatch",
      path,
      branch: "whenTrue",
      expected: graph.input,
      actual: whenTrue.input,
    };
  }
  if (whenFalse.input !== graph.input) {
    return {
      kind: "RouteBranchInputMismatch",
      path,
      branch: "whenFalse",
      expected: graph.input,
      actual: whenFalse.input,
    };
  }
  if (whenTrue.output !== whenFalse.output) {
    return {
      kind: "RouteBranchOutputMismatch",
      path,
      trueOutput: whenTrue.output,
      falseOutput: whenFalse.output,
    };
  }
  return {
    graph,
    input: graph.input,
    output: whenTrue.output,
    effect: joinEffectBounds(whenTrue.effect, whenFalse.effect),
    calls: [...whenTrue.calls, ...whenFalse.calls],
    failures: mergeNames(whenTrue.failures, whenFalse.failures),
  };
}

function checkGuard(
  graph: Extract<Graph, Readonly<{ kind: "guard" }>>,
  catalogue: GraphCatalogue,
  path: readonly GraphPathSegment[],
): CheckedGraph | GraphCheckError {
  const predicateError = checkPredicate(
    graph.predicate,
    graph.input,
    catalogue.schemas,
    path,
  );
  if (predicateError !== null) return predicateError;
  const body = checkGraphAt(graph.body, catalogue, [...path, "body"]);
  if (isGraphCheckError(body)) return body;
  if (body.input !== graph.input) {
    return {
      kind: "GuardBodyInputMismatch",
      path,
      expected: graph.input,
      actual: body.input,
    };
  }
  return {
    graph,
    input: graph.input,
    output: body.output,
    effect: body.effect,
    calls: body.calls,
    failures: mergeNames(body.failures, ["GuardRejected"]),
  };
}

function checkRetry(
  graph: Extract<Graph, Readonly<{ kind: "retry" }>>,
  catalogue: GraphCatalogue,
  path: readonly GraphPathSegment[],
): CheckedGraph | GraphCheckError {
  if (!isPositiveSafeInteger(graph.maxAttempts)) {
    return {
      kind: "InvalidRetryAttempts",
      path,
      maxAttempts: graph.maxAttempts,
    };
  }
  if (!isPositiveSafeInteger(graph.witness.maxAttempts)) {
    return {
      kind: "InvalidRetryAttempts",
      path,
      maxAttempts: graph.witness.maxAttempts,
    };
  }
  if (graph.maxAttempts > graph.witness.maxAttempts) {
    return {
      kind: "RetryWitnessAttemptBoundExceeded",
      path,
      maxAttempts: graph.maxAttempts,
      witnessMaximum: graph.witness.maxAttempts,
    };
  }
  if (graph.witness.retryableFailures.length === 0)
    return { kind: "RetryWitnessMissingFailures", path };
  const body = checkGraphAt(graph.body, catalogue, [...path, "body"]);
  if (isGraphCheckError(body)) return body;
  if (body.input !== graph.witness.precondition) {
    return {
      kind: "RetryWitnessInputMismatch",
      path,
      expected: graph.witness.precondition,
      actual: body.input,
    };
  }
  for (const failure of graph.witness.retryableFailures) {
    if (!body.failures.includes(failure)) {
      return { kind: "RetryWitnessUndeclaredFailure", path, failure };
    }
  }
  const effect = repeatEffectBound(body.effect, graph.maxAttempts);
  if (!isEffectWithin(effect, graph.witness.effectCeiling)) {
    return {
      kind: "RetryEffectExceedsWitness",
      path,
      required: effect,
      allowed: graph.witness.effectCeiling,
    };
  }
  return {
    graph,
    input: body.input,
    output: body.output,
    effect,
    calls: body.calls,
    failures: body.failures,
  };
}

function checkWire(
  graph: Extract<Graph, Readonly<{ kind: "wire" }>>,
  schemas: SchemaCatalogue,
  path: readonly GraphPathSegment[],
): CheckedGraph | GraphCheckError {
  const input = schemas.get(graph.input);
  if (input === undefined)
    return { kind: "UnknownSchema", path, schema: graph.input };
  const output = schemas.get(graph.output);
  if (output === undefined)
    return { kind: "UnknownSchema", path, schema: graph.output };
  if (input.kind !== "record" || output.kind !== "record") {
    return {
      kind: "WireRequiresRecordSchemas",
      path,
      input: graph.input,
      output: graph.output,
    };
  }

  const inputFields = fieldsByName(input);
  const outputFields = fieldsByName(output);
  const mappedTargets = new Set<string>();
  for (const field of graph.fields) {
    const source = inputFields.get(field.from);
    if (source === undefined)
      return { kind: "WireUnknownSourceField", path, field: field.from };
    const target = outputFields.get(field.to);
    if (target === undefined)
      return { kind: "WireUnknownTargetField", path, field: field.to };
    if (mappedTargets.has(field.to)) {
      return { kind: "WireDuplicateTargetField", path, field: field.to };
    }
    if (source !== target) {
      return {
        kind: "WireFieldSchemaMismatch",
        path,
        from: field.from,
        to: field.to,
        sourceSchema: source,
        targetSchema: target,
      };
    }
    mappedTargets.add(field.to);
  }
  for (const target of output.fields) {
    if (!mappedTargets.has(target.name))
      return { kind: "WireMissingTargetField", path, field: target.name };
  }
  return {
    graph,
    input: graph.input,
    output: graph.output,
    effect: emptyEffectBound,
    calls: [],
    failures: [],
  };
}

export function executeWire(
  graph: Extract<Graph, Readonly<{ kind: "wire" }>>,
  input: JsonValue,
): JsonValue {
  if (!isJsonObject(input))
    throw new Error("wire received a non-record runtime value");
  const output: Record<string, JsonValue> = {};
  for (const field of graph.fields) {
    const value = input[field.from];
    if (value === undefined)
      throw new Error(`wire source field missing at runtime: ${field.from}`);
    output[field.to] = value;
  }
  return output;
}

function checkPredicate(
  predicate: Predicate,
  input: SchemaRef,
  schemas: SchemaCatalogue,
  path: readonly GraphPathSegment[],
): GraphCheckError | null {
  switch (predicate.kind) {
    case "true":
    case "false":
      return null;
    case "not":
      return checkPredicate(predicate.term, input, schemas, path);
    case "and":
    case "or":
      return (
        checkPredicate(predicate.left, input, schemas, path) ??
        checkPredicate(predicate.right, input, schemas, path)
      );
    case "tagEquals":
      return checkPredicateField(
        input,
        schemas,
        path,
        predicate.field,
        predicate.value,
        "tag",
      );
    case "integerAtMost":
    case "integerAtLeast":
      return checkPredicateField(
        input,
        schemas,
        path,
        predicate.field,
        predicate.value,
        "integer",
      );
  }
}

function checkPredicateField(
  input: SchemaRef,
  schemas: SchemaCatalogue,
  path: readonly GraphPathSegment[],
  field: string,
  value: string | number,
  expected: PredicateDomain["kind"],
): GraphCheckError | null {
  const schema = schemas.get(input);
  if (schema === undefined)
    return { kind: "UnknownSchema", path, schema: input };
  if (schema.kind !== "record")
    return { kind: "PredicateRequiresRecordInput", path, input };
  const definition = schema.fields.find(
    (candidate) => candidate.name === field,
  );
  if (definition === undefined)
    return { kind: "PredicateUnknownField", path, field };
  const domain = definition.predicateDomain;
  if (domain === undefined || domain.kind !== expected)
    return { kind: "PredicateUndeclaredDomain", path, field };
  if (!isValueWithinDomain(value, domain)) {
    return { kind: "PredicateValueOutsideDomain", path, field, value };
  }
  return null;
}

function isValueWithinDomain(
  value: string | number,
  domain: PredicateDomain,
): boolean {
  switch (domain.kind) {
    case "tag":
      return typeof value === "string" && domain.values.includes(value);
    case "integer":
      return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= domain.minimum &&
        value <= domain.maximum
      );
  }
}

export function evaluatePredicate(
  predicate: Predicate,
  input: JsonValue,
): boolean {
  switch (predicate.kind) {
    case "true":
      return true;
    case "false":
      return false;
    case "not":
      return !evaluatePredicate(predicate.term, input);
    case "and":
      return (
        evaluatePredicate(predicate.left, input) &&
        evaluatePredicate(predicate.right, input)
      );
    case "or":
      return (
        evaluatePredicate(predicate.left, input) ||
        evaluatePredicate(predicate.right, input)
      );
    case "tagEquals":
      return readPredicateField(input, predicate.field) === predicate.value;
    case "integerAtMost": {
      const value = readPredicateField(input, predicate.field);
      if (typeof value !== "number")
        throw new Error(`predicate field is not a number: ${predicate.field}`);
      return value <= predicate.value;
    }
    case "integerAtLeast": {
      const value = readPredicateField(input, predicate.field);
      if (typeof value !== "number")
        throw new Error(`predicate field is not a number: ${predicate.field}`);
      return value >= predicate.value;
    }
  }
}

function readPredicateField(input: JsonValue, field: string): JsonValue {
  if (!isJsonObject(input))
    throw new Error("predicate received a non-record runtime value");
  const value = input[field];
  if (value === undefined)
    throw new Error(`predicate field missing at runtime: ${field}`);
  return value;
}

function joinEffectBounds(
  first: EffectBound,
  second: EffectBound,
): EffectBound {
  return {
    capabilities: mergeNames(first.capabilities, second.capabilities),
    reads: mergeNames(first.reads, second.reads),
    writes: mergeNames(first.writes, second.writes),
    maxOperations: Math.max(first.maxOperations, second.maxOperations),
  };
}

function isEffectWithin(required: EffectBound, allowed: EffectBound): boolean {
  return (
    required.maxOperations <= allowed.maxOperations &&
    required.capabilities.every((value) =>
      allowed.capabilities.includes(value),
    ) &&
    required.reads.every((value) => allowed.reads.includes(value)) &&
    required.writes.every((value) => allowed.writes.includes(value))
  );
}

function decodeSchemaField(
  value: unknown,
  path: readonly string[],
): SchemaRef | GraphDecodeError {
  if (typeof value !== "string") return invalidGraph(path, "InvalidSchemaRef");
  const schema = parseSchemaRef(value);
  return isSchemaRef(schema) ? schema : invalidGraph(path, "InvalidSchemaRef");
}

function decodePredicate(
  value: unknown,
  path: readonly string[],
): Predicate | GraphDecodeError {
  if (!isRecord(value)) return invalidGraph(path, "InvalidPredicate");
  if (typeof value.kind !== "string")
    return invalidGraph([...path, "kind"], "InvalidPredicate");
  switch (value.kind) {
    case "true":
    case "false": {
      const shapeError = exactFields(value, ["kind"], path);
      return shapeError ?? { kind: value.kind };
    }
    case "not": {
      const shapeError = exactFields(value, ["kind", "term"], path);
      if (shapeError !== null) return shapeError;
      const term = decodePredicate(value.term, [...path, "term"]);
      return isGraphDecodeError(term) ? term : { kind: value.kind, term };
    }
    case "and":
    case "or": {
      const shapeError = exactFields(value, ["kind", "left", "right"], path);
      if (shapeError !== null) return shapeError;
      const left = decodePredicate(value.left, [...path, "left"]);
      if (isGraphDecodeError(left)) return left;
      const right = decodePredicate(value.right, [...path, "right"]);
      return isGraphDecodeError(right)
        ? right
        : { kind: value.kind, left, right };
    }
    case "tagEquals": {
      const shapeError = exactFields(value, ["kind", "field", "value"], path);
      if (shapeError !== null) return shapeError;
      return typeof value.field === "string" &&
        typeof value.value === "string" &&
        isFieldName(value.field)
        ? { kind: value.kind, field: value.field, value: value.value }
        : invalidGraph(path, "InvalidPredicate");
    }
    case "integerAtMost":
    case "integerAtLeast": {
      const shapeError = exactFields(value, ["kind", "field", "value"], path);
      if (shapeError !== null) return shapeError;
      return typeof value.field === "string" &&
        isFieldName(value.field) &&
        typeof value.value === "number" &&
        Number.isSafeInteger(value.value)
        ? { kind: value.kind, field: value.field, value: value.value }
        : invalidGraph(path, "InvalidPredicate");
    }
    default:
      return invalidGraph([...path, "kind"], "InvalidPredicate");
  }
}

function decodeWireFields(
  value: unknown,
  path: readonly string[],
): readonly WireField[] | GraphDecodeError {
  if (!Array.isArray(value)) return invalidGraph(path, "ExpectedArray");
  const fields: WireField[] = [];
  for (const [index, candidate] of value.entries()) {
    const fieldPath = [...path, String(index)];
    if (!isRecord(candidate))
      return invalidGraph(fieldPath, "InvalidWireField");
    const shapeError = exactFields(candidate, ["from", "to"], fieldPath);
    if (shapeError !== null) return shapeError;
    if (
      typeof candidate.from !== "string" ||
      typeof candidate.to !== "string" ||
      !isFieldName(candidate.from) ||
      !isFieldName(candidate.to)
    ) {
      return invalidGraph(fieldPath, "InvalidWireField");
    }
    fields.push({ from: candidate.from, to: candidate.to });
  }
  return fields;
}

function decodeRetryWitness(
  value: unknown,
  path: readonly string[],
): RetryWitness | GraphDecodeError {
  if (!isRecord(value)) return invalidGraph(path, "InvalidRetry");
  const shapeError = exactFields(
    value,
    [
      "precondition",
      "maxAttempts",
      "retryableFailures",
      "restoration",
      "idempotency",
      "effectCeiling",
    ],
    path,
  );
  if (shapeError !== null) return shapeError;
  const precondition = decodeSchemaField(value.precondition, [
    ...path,
    "precondition",
  ]);
  if (isGraphDecodeError(precondition)) return precondition;
  if (!isPositiveSafeInteger(value.maxAttempts))
    return invalidGraph([...path, "maxAttempts"], "InvalidRetry");
  if (
    !Array.isArray(value.retryableFailures) ||
    value.retryableFailures.length === 0 ||
    value.retryableFailures.some(
      (failure) => typeof failure !== "string" || failure.length === 0,
    ) ||
    new Set(value.retryableFailures).size !== value.retryableFailures.length ||
    value.restoration !== "sameInput" ||
    value.idempotency !== "required"
  )
    return invalidGraph(path, "InvalidRetry");
  const effectCeiling = decodeEffectBound(value.effectCeiling, [
    ...path,
    "effectCeiling",
  ]);
  if (isGraphDecodeError(effectCeiling)) return effectCeiling;
  return {
    precondition,
    maxAttempts: value.maxAttempts,
    retryableFailures: value.retryableFailures,
    restoration: "sameInput",
    idempotency: "required",
    effectCeiling,
  };
}

function decodeEffectBound(
  value: unknown,
  path: readonly string[],
): EffectBound | GraphDecodeError {
  if (!isRecord(value)) return invalidGraph(path, "InvalidRetry");
  const shapeError = exactFields(
    value,
    ["capabilities", "reads", "writes", "maxOperations"],
    path,
  );
  if (shapeError !== null) return shapeError;
  if (
    !isStringArray(value.capabilities) ||
    !isStringArray(value.reads) ||
    !isStringArray(value.writes) ||
    typeof value.maxOperations !== "number" ||
    !Number.isSafeInteger(value.maxOperations) ||
    value.maxOperations < 0
  )
    return invalidGraph(path, "InvalidRetry");
  return {
    capabilities: value.capabilities,
    reads: value.reads,
    writes: value.writes,
    maxOperations: value.maxOperations,
  };
}

function fieldsByName(schema: Extract<SchemaDefinition, { kind: "record" }>) {
  return new Map(schema.fields.map((field) => [field.name, field.schema]));
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  path: readonly string[],
): GraphDecodeError | null {
  for (const field of fields) {
    if (!(field in value))
      return invalidGraph([...path, field], "MissingField");
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field))
      return invalidGraph([...path, field], "UnexpectedField");
  }
  return null;
}

function mergeNames(
  first: readonly string[],
  second: readonly string[],
): string[] {
  return [...new Set([...first, ...second])].sort();
}

function invalidGraph(
  path: readonly string[],
  reason: GraphDecodeError["reason"],
): GraphDecodeError {
  return { kind: "InvalidGraph", path, reason };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(
  value: JsonValue,
): value is Readonly<{ [key: string]: JsonValue }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldName(value: string): boolean {
  return fieldNamePattern.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isGraphDecodeError(value: unknown): value is GraphDecodeError {
  return isRecord(value) && value.kind === "InvalidGraph";
}

function isGraphCheckError(
  value: CheckedGraph | GraphCheckError,
): value is GraphCheckError {
  return "path" in value;
}
