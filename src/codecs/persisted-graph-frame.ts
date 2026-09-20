import {
  decodeGraph,
  type Graph,
  isAbstractionRef,
  type JsonValue,
  parseAbstractionRef,
} from "../core/graph.ts";
import type { GraphDefinition } from "../core/graph-definition.ts";
import {
  type AttemptId,
  type FrameContinuation,
  type GraphFrame,
  isAttemptId,
  isGraphRef,
  isOperationId,
  type OperationId,
  parseAttemptId,
  parseGraphRef,
  parseOperationId,
} from "../core/graph-frame.ts";
import { canonicalJson } from "./canonical.ts";

type ObjectValue = Readonly<{ [key: string]: JsonValue }>;

export function decodePinnedGraphFrame(
  value: JsonValue,
  definition: GraphDefinition,
): GraphFrame {
  const frame = exact(value, ["graphRef", "schemaVersion", "state"], "frame");
  if (frame.schemaVersion !== 1)
    throw new Error("frame has an unsupported schema version");
  const graphRef = parseGraphRef(string(frame, "graphRef"));
  if (!isGraphRef(graphRef) || graphRef !== definition.ref)
    throw new Error("frame has a mismatched graph reference");
  return Object.freeze({
    schemaVersion: 1,
    graphRef,
    state: decodeState(
      field(frame, "state"),
      definition,
      graphNodes(definition.graph),
    ),
  });
}

function decodeState(
  value: JsonValue,
  definition: GraphDefinition,
  nodes: ReadonlySet<string>,
): GraphFrame["state"] {
  const stateObject = object(value, "frame state");
  const kind = string(stateObject, "kind");
  if (kind === "running") {
    const state = exact(
      value,
      ["continuations", "kind", "node", "value"],
      "running frame",
    );
    const node = graph(field(state, "node"), nodes, "running node");
    return Object.freeze({
      kind,
      node,
      value: json(field(state, "value"), "running value"),
      continuations: continuations(
        field(state, "continuations"),
        definition,
        nodes,
      ),
    });
  }
  if (kind === "awaitingCall") {
    const state = exact(
      value,
      [
        "abstraction",
        "attempt",
        "continuations",
        "input",
        "kind",
        "operationId",
      ],
      "awaiting frame",
    );
    const abstraction = abstractionRef(string(state, "abstraction"));
    if (!definition.catalogue.abstractions.has(abstraction))
      throw new Error("awaiting frame references an unavailable abstraction");
    const continuation = continuations(
      field(state, "continuations"),
      definition,
      nodes,
    );
    const attempt = retryAttempt(field(state, "attempt"));
    const pendingOperationId = operationId(string(state, "operationId"));
    const activeRetry = [...continuation]
      .reverse()
      .find((item) => item.kind === "retry");
    if (activeRetry === undefined && attempt !== null)
      throw new Error(
        "awaiting frame has an attempt without retry continuation",
      );
    if (activeRetry !== undefined) {
      if (
        attempt === null ||
        activeRetry.attemptId === null ||
        attempt.id !== activeRetry.attemptId ||
        attempt.ordinal !== activeRetry.ordinal ||
        !activeRetry.operationIds.includes(pendingOperationId)
      )
        throw new Error(
          "awaiting retry frame does not match its active continuation",
        );
    }
    return Object.freeze({
      kind,
      operationId: pendingOperationId,
      abstraction,
      input: json(field(state, "input"), "awaiting input"),
      continuations: continuation,
      attempt,
    });
  }
  if (kind === "succeeded") {
    const state = exact(value, ["kind", "output"], "succeeded frame");
    return Object.freeze({
      kind,
      output: json(field(state, "output"), "frame output"),
    });
  }
  if (kind === "failed") {
    const state = exact(value, ["detail", "failure", "kind"], "failed frame");
    const failure = string(state, "failure");
    if (failure !== "GuardRejected" && failure !== "OperationFailed")
      throw new Error("failed frame has an invalid failure");
    const detail = field(state, "detail");
    if (detail !== null && typeof detail !== "string")
      throw new Error("failed frame detail must be null or string");
    return Object.freeze({ kind, failure, detail });
  }
  throw new Error("frame has an unsupported state");
}

function continuations(
  value: JsonValue,
  definition: GraphDefinition,
  nodes: ReadonlySet<string>,
): readonly FrameContinuation[] {
  if (!Array.isArray(value))
    throw new Error("frame continuations must be an array");
  return Object.freeze(
    value.map((item) => continuation(item, definition, nodes)),
  );
}

function continuation(
  value: JsonValue,
  definition: GraphDefinition,
  nodes: ReadonlySet<string>,
): FrameContinuation {
  const continuationObject = object(value, "frame continuation");
  const kind = string(continuationObject, "kind");
  if (kind === "seq") {
    const item = exact(value, ["kind", "next"], "sequence continuation");
    return Object.freeze({
      kind,
      next: graph(field(item, "next"), nodes, "sequence continuation"),
    });
  }
  if (kind !== "retry")
    throw new Error("frame has an unsupported continuation");
  const item = exact(
    value,
    [
      "attemptId",
      "body",
      "completedAttemptIds",
      "input",
      "kind",
      "maxAttempts",
      "operationIds",
      "ordinal",
      "witness",
    ],
    "retry continuation",
  );
  const body = graph(field(item, "body"), nodes, "retry body");
  const matching = retryNodes(definition.graph).find(
    (node) =>
      sameGraph(node.body, body) &&
      canonicalJson(node.witness) === canonicalJson(field(item, "witness")) &&
      node.maxAttempts === item.maxAttempts,
  );
  if (matching === undefined)
    throw new Error("retry continuation is not from the pinned graph");
  const maxAttempts = positive(field(item, "maxAttempts"), "retry maxAttempts");
  const ordinal = positive(field(item, "ordinal"), "retry ordinal");
  if (ordinal > maxAttempts)
    throw new Error("retry ordinal exceeds its attempt bound");
  const attemptIdValue = field(item, "attemptId");
  const attemptId =
    attemptIdValue === null ? null : attemptIdOf(attemptIdValue);
  const completedAttemptIds = ids(
    field(item, "completedAttemptIds"),
    attemptIdOf,
    "completed attempt IDs",
  );
  const operationIds = ids(
    field(item, "operationIds"),
    operationIdOf,
    "retry operation IDs",
  );
  if (attemptId !== null && completedAttemptIds.includes(attemptId))
    throw new Error("retry attempt is already completed");
  return Object.freeze({
    kind,
    body,
    input: json(field(item, "input"), "retry input"),
    witness: matching.witness,
    maxAttempts,
    ordinal,
    attemptId,
    completedAttemptIds,
    operationIds,
  });
}

function graph(
  value: JsonValue,
  nodes: ReadonlySet<string>,
  label: string,
): Graph {
  const decoded = decodeGraph(value);
  if ("reason" in decoded) throw new Error(`${label} has invalid graph syntax`);
  if (!nodes.has(JSON.stringify(decoded)))
    throw new Error(`${label} is not from the pinned graph`);
  return decoded;
}

function graphNodes(graph: Graph): ReadonlySet<string> {
  const nodes = new Set<string>();
  const visit = (node: Graph): void => {
    nodes.add(JSON.stringify(node));
    if (node.kind === "seq") {
      visit(node.first);
      visit(node.second);
    }
    if (node.kind === "route") {
      visit(node.whenTrue);
      visit(node.whenFalse);
    }
    if (node.kind === "guard" || node.kind === "retry") visit(node.body);
  };
  visit(graph);
  return nodes;
}

function retryNodes(
  graph: Graph,
): readonly Extract<Graph, { kind: "retry" }>[] {
  const result: Extract<Graph, { kind: "retry" }>[] = [];
  const visit = (node: Graph): void => {
    if (node.kind === "retry") {
      result.push(node);
      visit(node.body);
      return;
    }
    if (node.kind === "seq") {
      visit(node.first);
      visit(node.second);
    }
    if (node.kind === "route") {
      visit(node.whenTrue);
      visit(node.whenFalse);
    }
    if (node.kind === "guard") visit(node.body);
  };
  visit(graph);
  return result;
}

function sameGraph(left: Graph, right: Graph): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function retryAttempt(
  value: JsonValue,
): { readonly id: AttemptId; readonly ordinal: number } | null {
  if (value === null) return null;
  const item = exact(value, ["id", "ordinal"], "retry attempt");
  return Object.freeze({
    id: attemptIdOf(field(item, "id")),
    ordinal: positive(field(item, "ordinal"), "retry attempt ordinal"),
  });
}

function ids<T extends string>(
  value: JsonValue,
  parse: (value: JsonValue) => T,
  label: string,
): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map(parse);
  if (new Set(result).size !== result.length)
    throw new Error(`${label} contains duplicates`);
  return Object.freeze(result);
}

function attemptIdOf(value: JsonValue): AttemptId {
  if (typeof value !== "string") throw new Error("attempt ID must be a string");
  const parsed = parseAttemptId(value);
  if (!isAttemptId(parsed)) throw new Error("attempt ID is invalid");
  return parsed;
}

function operationIdOf(value: JsonValue): OperationId {
  if (typeof value !== "string")
    throw new Error("operation ID must be a string");
  const parsed = parseOperationId(value);
  if (!isOperationId(parsed)) throw new Error("operation ID is invalid");
  return parsed;
}

function operationId(value: string): OperationId {
  return operationIdOf(value);
}

function abstractionRef(value: string) {
  const parsed = parseAbstractionRef(value);
  if (!isAbstractionRef(parsed))
    throw new Error("abstraction reference is invalid");
  return parsed;
}

function exact(
  value: JsonValue,
  keys: readonly string[],
  label: string,
): ObjectValue {
  const item = object(value, label);
  if (!same(Object.keys(item).sort(), [...keys].sort()))
    throw new Error(`${label} has an invalid shape`);
  return item;
}

function object(value: JsonValue, label: string): ObjectValue {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}

function field(value: ObjectValue, key: string): JsonValue {
  const result = value[key];
  if (result === undefined) throw new Error(`missing frame field ${key}`);
  return result;
}

function string(value: ObjectValue, key: string): string {
  const result = field(value, key);
  if (typeof result !== "string")
    throw new Error(`frame field ${key} must be a string`);
  return result;
}

function positive(value: JsonValue, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function json(value: JsonValue, _label: string): JsonValue {
  return value;
}

function same<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}
