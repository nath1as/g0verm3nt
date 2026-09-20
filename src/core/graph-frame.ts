import {
  type AbstractionRef,
  type CheckedGraph,
  evaluatePredicate,
  executeWire,
  type Graph,
  type JsonValue,
  type RetryWitness,
} from "./graph.ts";

declare const graphRefBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const attemptIdBrand: unique symbol;

export type GraphRef = string & Readonly<{ [graphRefBrand]: "GraphRef" }>;
export type OperationId = string &
  Readonly<{ [operationIdBrand]: "OperationId" }>;
export type AttemptId = string & Readonly<{ [attemptIdBrand]: "AttemptId" }>;

export type InvalidGraphRef = Readonly<{
  kind: "InvalidGraphRef";
  value: string;
}>;

export type InvalidOperationId = Readonly<{
  kind: "InvalidOperationId";
  value: string;
}>;
export type InvalidAttemptId = Readonly<{
  kind: "InvalidAttemptId";
  value: string;
}>;

export type GraphFrame = Readonly<{
  schemaVersion: 1;
  graphRef: GraphRef;
  state: FrameState;
}>;

export type FrameState =
  | Readonly<{
      kind: "running";
      node: Graph;
      value: JsonValue;
      continuations: readonly FrameContinuation[];
    }>
  | Readonly<{
      kind: "awaitingCall";
      operationId: OperationId;
      abstraction: AbstractionRef;
      input: JsonValue;
      continuations: readonly FrameContinuation[];
      attempt: RetryAttempt | null;
    }>
  | Readonly<{ kind: "succeeded"; output: JsonValue }>
  | Readonly<{
      kind: "failed";
      failure: "GuardRejected" | "OperationFailed";
      detail: string | null;
    }>;

export type FrameContinuation =
  | Readonly<{
      kind: "seq";
      next: Graph;
    }>
  | Readonly<{
      kind: "retry";
      body: Graph;
      input: JsonValue;
      witness: RetryWitness;
      maxAttempts: number;
      ordinal: number;
      attemptId: AttemptId | null;
      completedAttemptIds: readonly AttemptId[];
      operationIds: readonly OperationId[];
    }>;

export type RetryAttempt = Readonly<{
  id: AttemptId;
  ordinal: number;
}>;

export type PlannedGraphOperation = Readonly<{
  operationId: OperationId;
  abstraction: AbstractionRef;
  input: JsonValue;
}> &
  Readonly<{
    attempt?: RetryAttempt;
  }>;

export type OperationObservation =
  | Readonly<{
      kind: "succeeded";
      operationId: OperationId;
      output: JsonValue;
    }>
  | Readonly<{
      kind: "failed";
      operationId: OperationId;
      failure: string;
    }>;

export type FrameStep =
  | Readonly<{ kind: "advanced"; frame: GraphFrame }>
  | Readonly<{
      kind: "operationPlanned";
      frame: GraphFrame;
      operation: PlannedGraphOperation;
    }>
  | Readonly<{ kind: "terminal"; frame: GraphFrame }>
  | Readonly<{ kind: "rejected"; reason: FrameRejection }>;

export type FrameRejection =
  | Readonly<{ kind: "OperationIdRequired" }>
  | Readonly<{ kind: "AttemptIdRequired" }>
  | Readonly<{
      kind: "AttemptIdMismatch";
      expected: AttemptId;
      actual: AttemptId;
    }>
  | Readonly<{ kind: "AttemptIdReused"; attemptId: AttemptId }>
  | Readonly<{ kind: "OperationIdReused"; operationId: OperationId }>
  | Readonly<{ kind: "FrameNotRunning"; state: FrameState["kind"] }>
  | Readonly<{ kind: "FrameNotAwaitingCall"; state: FrameState["kind"] }>
  | Readonly<{
      kind: "OperationIdMismatch";
      expected: OperationId;
      actual: OperationId;
    }>;

const exactReferencePattern =
  /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*@[1-9][0-9]*$/;

export function parseGraphRef(value: string): GraphRef | InvalidGraphRef {
  return exactReferencePattern.test(value)
    ? (value as GraphRef)
    : { kind: "InvalidGraphRef", value };
}

export function parseOperationId(
  value: string,
): OperationId | InvalidOperationId {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)
    ? (value as OperationId)
    : { kind: "InvalidOperationId", value };
}

export function parseAttemptId(value: string): AttemptId | InvalidAttemptId {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)
    ? (value as AttemptId)
    : { kind: "InvalidAttemptId", value };
}

export function isGraphRef(
  value: GraphRef | InvalidGraphRef,
): value is GraphRef {
  return typeof value === "string";
}

export function isOperationId(
  value: OperationId | InvalidOperationId,
): value is OperationId {
  return typeof value === "string";
}

export function isAttemptId(
  value: AttemptId | InvalidAttemptId,
): value is AttemptId {
  return typeof value === "string";
}

export function startGraphFrame(
  graphRef: GraphRef,
  graph: CheckedGraph,
  input: JsonValue,
): GraphFrame {
  return {
    schemaVersion: 1,
    graphRef,
    state: {
      kind: "running",
      node: graph.graph,
      value: input,
      continuations: [],
    },
  };
}

export function advanceGraphFrame(
  frame: GraphFrame,
  operationId?: OperationId,
  attemptId?: AttemptId,
): FrameStep {
  if (frame.state.kind !== "running") {
    return {
      kind: "rejected",
      reason: { kind: "FrameNotRunning", state: frame.state.kind },
    };
  }
  const { node, value, continuations } = frame.state;
  switch (node.kind) {
    case "id":
      return advanced(frame, settleValue(frame, value, continuations));
    case "wire":
      return advanced(
        frame,
        settleValue(frame, executeWire(node, value), continuations),
      );
    case "seq":
      return advanced(frame, {
        ...frame,
        state: {
          kind: "running",
          node: node.first,
          value,
          continuations: [...continuations, { kind: "seq", next: node.second }],
        },
      });
    case "route":
      return advanced(frame, {
        ...frame,
        state: {
          kind: "running",
          node: evaluatePredicate(node.predicate, value)
            ? node.whenTrue
            : node.whenFalse,
          value,
          continuations,
        },
      });
    case "guard":
      return evaluatePredicate(node.predicate, value)
        ? advanced(frame, {
            ...frame,
            state: {
              kind: "running",
              node: node.body,
              value,
              continuations,
            },
          })
        : advanceFailure(frame, "GuardRejected", null, continuations);
    case "retry":
      return advanced(frame, {
        ...frame,
        state: {
          kind: "running",
          node: node.body,
          value,
          continuations: [
            ...continuations,
            {
              kind: "retry",
              body: node.body,
              input: value,
              witness: node.witness,
              maxAttempts: node.maxAttempts,
              ordinal: 1,
              attemptId: null,
              completedAttemptIds: [],
              operationIds: [],
            },
          ],
        },
      });
    case "call": {
      if (operationId === undefined)
        return { kind: "rejected", reason: { kind: "OperationIdRequired" } };
      const retry = currentRetry(continuations);
      if (retry !== null && attemptId === undefined)
        return { kind: "rejected", reason: { kind: "AttemptIdRequired" } };
      if (
        retry !== null &&
        retry.attemptId !== null &&
        retry.attemptId !== attemptId
      )
        return {
          kind: "rejected",
          reason: {
            kind: "AttemptIdMismatch",
            expected: retry.attemptId,
            actual: attemptId as AttemptId,
          },
        };
      if (retry?.completedAttemptIds.includes(attemptId as AttemptId))
        return {
          kind: "rejected",
          reason: {
            kind: "AttemptIdReused",
            attemptId: attemptId as AttemptId,
          },
        };
      if (retry?.operationIds.includes(operationId))
        return {
          kind: "rejected",
          reason: { kind: "OperationIdReused", operationId },
        };
      const updatedContinuations =
        retry !== null
          ? recordRetryOperation(
              continuations,
              attemptId as AttemptId,
              operationId,
            )
          : continuations;
      return {
        kind: "operationPlanned",
        frame: {
          ...frame,
          state: {
            kind: "awaitingCall",
            operationId,
            abstraction: node.abstraction,
            input: value,
            continuations: updatedContinuations,
            attempt:
              retry === null
                ? null
                : { id: attemptId as AttemptId, ordinal: retry.ordinal },
          },
        },
        operation: {
          operationId,
          abstraction: node.abstraction,
          input: value,
          ...(retry === null
            ? {}
            : {
                attempt: { id: attemptId as AttemptId, ordinal: retry.ordinal },
              }),
        },
      };
    }
  }
}

export function observeGraphOperation(
  frame: GraphFrame,
  observation: OperationObservation,
): FrameStep {
  if (frame.state.kind !== "awaitingCall") {
    return {
      kind: "rejected",
      reason: { kind: "FrameNotAwaitingCall", state: frame.state.kind },
    };
  }
  if (frame.state.operationId !== observation.operationId) {
    return {
      kind: "rejected",
      reason: {
        kind: "OperationIdMismatch",
        expected: frame.state.operationId,
        actual: observation.operationId,
      },
    };
  }
  if (observation.kind === "failed") {
    return advanceFailure(
      frame,
      "OperationFailed",
      observation.failure,
      frame.state.continuations,
      frame.state.attempt?.id ?? null,
    );
  }
  return advanced(
    frame,
    settleValue(frame, observation.output, frame.state.continuations),
  );
}

function settleValue(
  frame: GraphFrame,
  value: JsonValue,
  continuations: readonly FrameContinuation[],
): GraphFrame {
  const continuation = continuations.at(-1);
  if (continuation === undefined) {
    return { ...frame, state: { kind: "succeeded", output: value } };
  }
  switch (continuation.kind) {
    case "seq":
      return {
        ...frame,
        state: {
          kind: "running",
          node: continuation.next,
          value,
          continuations: continuations.slice(0, -1),
        },
      };
    case "retry":
      return settleValue(frame, value, continuations.slice(0, -1));
  }
}

function advanceFailure(
  frame: GraphFrame,
  failure: "GuardRejected" | "OperationFailed",
  detail: string | null,
  continuations: readonly FrameContinuation[],
  completedAttemptId: AttemptId | null = null,
): FrameStep {
  const retryableFailure = failure === "GuardRejected" ? failure : detail;
  for (let index = continuations.length - 1; index >= 0; index -= 1) {
    const continuation = continuations[index];
    if (continuation === undefined || continuation.kind !== "retry") continue;
    if (
      retryableFailure === null ||
      !continuation.witness.retryableFailures.includes(retryableFailure) ||
      continuation.ordinal >= continuation.maxAttempts
    )
      continue;
    const attemptId = completedAttemptId ?? continuation.attemptId;
    const completedAttemptIds =
      attemptId === null
        ? continuation.completedAttemptIds
        : [...continuation.completedAttemptIds, attemptId];
    return advanced(frame, {
      ...frame,
      state: {
        kind: "running",
        node: continuation.body,
        value: continuation.input,
        continuations: [
          ...continuations.slice(0, index),
          {
            ...continuation,
            ordinal: continuation.ordinal + 1,
            attemptId: null,
            completedAttemptIds,
          },
        ],
      },
    });
  }
  return terminal(frame, {
    ...frame,
    state: { kind: "failed", failure, detail },
  });
}

function currentRetry(
  continuations: readonly FrameContinuation[],
): Extract<FrameContinuation, { kind: "retry" }> | null {
  for (let index = continuations.length - 1; index >= 0; index -= 1) {
    const continuation = continuations[index];
    if (continuation !== undefined && continuation.kind === "retry")
      return continuation;
  }
  return null;
}

function recordRetryOperation(
  continuations: readonly FrameContinuation[],
  attemptId: AttemptId,
  operationId: OperationId,
): readonly FrameContinuation[] {
  for (let index = continuations.length - 1; index >= 0; index -= 1) {
    const continuation = continuations[index];
    if (continuation !== undefined && continuation.kind === "retry") {
      return [
        ...continuations.slice(0, index),
        {
          ...continuation,
          attemptId: continuation.attemptId ?? attemptId,
          operationIds: [...continuation.operationIds, operationId],
        },
        ...continuations.slice(index + 1),
      ];
    }
  }
  throw new Error("retry operation requested without a retry continuation");
}

function advanced(previous: GraphFrame, frame: GraphFrame): FrameStep {
  return frame.state.kind === "running"
    ? { kind: "advanced", frame }
    : terminal(previous, frame);
}

function terminal(_previous: GraphFrame, frame: GraphFrame): FrameStep {
  return { kind: "terminal", frame };
}
