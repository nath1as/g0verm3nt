import { describe, expect, test } from "bun:test";
import {
  type Contract,
  isVerifierRef,
  parseVerifierRef,
} from "../../src/core/contracts.ts";
import {
  type AbstractionRef,
  type CallableAbstraction,
  checkGraph,
  type EffectBound,
  type GraphCatalogue,
  isAbstractionRef,
  isSchemaRef,
  parseAbstractionRef,
  parseSchemaRef,
  type RetryWitness,
  type SchemaRef,
} from "../../src/core/graph.ts";
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
} from "../../src/core/graph-frame.ts";

const number = requiredSchema("example/number@1");
const text = requiredSchema("example/text@1");
const increment = requiredAbstraction("example/increment@1");
const render = requiredAbstraction("example/render@1");
const flaky = requiredAbstraction("example/flaky@1");
const verifier = requiredVerifier("example/frame-verifier@1");

describe("M1 graph execution frames", () => {
  test("stores sequence continuation and resumes exactly after each observed call", () => {
    const graph = checkedGraph({
      kind: "seq",
      first: { kind: "call", abstraction: increment },
      second: { kind: "call", abstraction: render },
    } as const);
    const initial = startGraphFrame(
      requiredGraphRef("example/pipeline@1"),
      graph,
      2,
    );

    const enteredFirst = requireAdvanced(advanceGraphFrame(initial));
    const firstPlan = requirePlan(
      advanceGraphFrame(enteredFirst, requiredOperationId("operation-1")),
    );
    const afterFirst = requireAdvanced(
      observeGraphOperation(firstPlan.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-1"),
        output: 3,
      }),
    );
    const secondPlan = requirePlan(
      advanceGraphFrame(afterFirst, requiredOperationId("operation-2")),
    );
    const done = requireTerminal(
      observeGraphOperation(secondPlan.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-2"),
        output: "3",
      }),
    );

    expect(firstPlan.operation).toEqual({
      operationId: requiredOperationId("operation-1"),
      abstraction: increment,
      input: 2,
    });
    expect(secondPlan.operation.input).toBe(3);
    expect(done.state).toEqual({ kind: "succeeded", output: "3" });
  });

  test("does not advance a pending frame for a conflicting or duplicate observation", () => {
    const graph = checkedGraph({
      kind: "call",
      abstraction: increment,
    } as const);
    const planned = requirePlan(
      advanceGraphFrame(
        startGraphFrame(requiredGraphRef("example/call@1"), graph, 1),
        requiredOperationId("operation-3"),
      ),
    );

    expect(
      observeGraphOperation(planned.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("wrong-operation"),
        output: 2,
      }),
    ).toEqual({
      kind: "rejected",
      reason: {
        kind: "OperationIdMismatch",
        expected: requiredOperationId("operation-3"),
        actual: requiredOperationId("wrong-operation"),
      },
    });
    const terminal = requireTerminal(
      observeGraphOperation(planned.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-3"),
        output: 2,
      }),
    );
    expect(
      observeGraphOperation(terminal, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-3"),
        output: 2,
      }),
    ).toEqual({
      kind: "rejected",
      reason: { kind: "FrameNotAwaitingCall", state: "succeeded" },
    });
  });

  test("records GuardRejected as a terminal frame without planning the body", () => {
    const graph = checkedGraph({
      kind: "guard",
      input: number,
      predicate: { kind: "false" },
      body: { kind: "call", abstraction: increment },
    } as const);
    const frame = startGraphFrame(
      requiredGraphRef("example/guard@1"),
      graph,
      1,
    );

    expect(advanceGraphFrame(frame)).toEqual({
      kind: "terminal",
      frame: {
        schemaVersion: 1,
        graphRef: requiredGraphRef("example/guard@1"),
        state: { kind: "failed", failure: "GuardRejected", detail: null },
      },
    });
  });

  test("retains bounded retry attempts and restores the original input", () => {
    const graph = checkedGraph({
      kind: "retry",
      maxAttempts: 2,
      witness: retryWitness(),
      body: { kind: "call", abstraction: flaky },
    } as const);
    const entered = requireAdvanced(
      advanceGraphFrame(
        startGraphFrame(requiredGraphRef("example/retry@1"), graph, 2),
      ),
    );
    const first = requirePlan(
      advanceGraphFrame(
        entered,
        requiredOperationId("operation-retry-1"),
        requiredAttemptId("attempt-1"),
      ),
    );
    expect(first.operation).toEqual({
      operationId: requiredOperationId("operation-retry-1"),
      abstraction: flaky,
      input: 2,
      attempt: { id: requiredAttemptId("attempt-1"), ordinal: 1 },
    });
    const retrying = requireAdvanced(
      observeGraphOperation(first.frame, {
        kind: "failed",
        operationId: requiredOperationId("operation-retry-1"),
        failure: "Transient",
      }),
    );
    expect(
      advanceGraphFrame(
        retrying,
        requiredOperationId("operation-retry-1"),
        requiredAttemptId("attempt-2"),
      ),
    ).toEqual({
      kind: "rejected",
      reason: {
        kind: "OperationIdReused",
        operationId: requiredOperationId("operation-retry-1"),
      },
    });
    expect(
      advanceGraphFrame(
        retrying,
        requiredOperationId("operation-retry-2"),
        requiredAttemptId("attempt-1"),
      ),
    ).toEqual({
      kind: "rejected",
      reason: {
        kind: "AttemptIdReused",
        attemptId: requiredAttemptId("attempt-1"),
      },
    });
    const second = requirePlan(
      advanceGraphFrame(
        retrying,
        requiredOperationId("operation-retry-2"),
        requiredAttemptId("attempt-2"),
      ),
    );
    expect(second.operation.attempt).toEqual({
      id: requiredAttemptId("attempt-2"),
      ordinal: 2,
    });
    const done = requireTerminal(
      observeGraphOperation(second.frame, {
        kind: "succeeded",
        operationId: requiredOperationId("operation-retry-2"),
        output: 3,
      }),
    );
    expect(done.state).toEqual({ kind: "succeeded", output: 3 });
  });
});

const effect: EffectBound = {
  capabilities: ["example"],
  reads: [],
  writes: [],
  maxOperations: 1,
};

function checkedGraph(graph: Parameters<typeof checkGraph>[0]) {
  const checked = checkGraph(graph, catalogue());
  if ("kind" in checked) throw new Error(`graph check failed: ${checked.kind}`);
  return checked;
}

function catalogue(): GraphCatalogue {
  const abstractions: readonly CallableAbstraction[] = [
    { ref: increment, contract: contract(number, number) },
    { ref: render, contract: contract(number, text) },
    { ref: flaky, contract: contract(number, number, ["Transient"]) },
  ];
  return {
    abstractions: new Map(abstractions.map((item) => [item.ref, item])),
    schemas: new Map([
      [number, { kind: "atomic", ref: number }],
      [text, { kind: "atomic", ref: text }],
    ]),
  };
}

function contract(
  input: SchemaRef,
  output: SchemaRef,
  failures: readonly string[] = [],
): Contract {
  return {
    input,
    output,
    effect,
    failures,
    verifier,
    assumptions: [],
    assurance: "authored",
  };
}

function retryWitness(): RetryWitness {
  return {
    precondition: number,
    maxAttempts: 2,
    retryableFailures: ["Transient"],
    restoration: "sameInput",
    idempotency: "required",
    effectCeiling: { ...effect, maxOperations: 2 },
  };
}

function requireAdvanced(step: ReturnType<typeof advanceGraphFrame>) {
  if (step.kind !== "advanced")
    throw new Error(`expected advance: ${step.kind}`);
  return step.frame;
}

function requirePlan(step: ReturnType<typeof advanceGraphFrame>) {
  if (step.kind !== "operationPlanned")
    throw new Error(`expected operation plan: ${step.kind}`);
  return step;
}

function requireTerminal(step: ReturnType<typeof observeGraphOperation>) {
  if (step.kind !== "terminal")
    throw new Error(`expected terminal: ${step.kind}`);
  return step.frame;
}

function requiredSchema(value: string): SchemaRef {
  const parsed = parseSchemaRef(value);
  if (!isSchemaRef(parsed)) throw new Error(`invalid test schema: ${value}`);
  return parsed;
}

function requiredAbstraction(value: string): AbstractionRef {
  const parsed = parseAbstractionRef(value);
  if (!isAbstractionRef(parsed))
    throw new Error(`invalid test abstraction: ${value}`);
  return parsed;
}

function requiredGraphRef(value: string) {
  const parsed = parseGraphRef(value);
  if (!isGraphRef(parsed)) throw new Error(`invalid test graph ref: ${value}`);
  return parsed;
}

function requiredOperationId(value: string) {
  const parsed = parseOperationId(value);
  if (!isOperationId(parsed))
    throw new Error(`invalid test operation ID: ${value}`);
  return parsed;
}

function requiredAttemptId(value: string) {
  const parsed = parseAttemptId(value);
  if (!isAttemptId(parsed))
    throw new Error(`invalid test attempt ID: ${value}`);
  return parsed;
}

function requiredVerifier(value: string) {
  const parsed = parseVerifierRef(value);
  if (!isVerifierRef(parsed))
    throw new Error(`invalid test verifier: ${value}`);
  return parsed;
}
