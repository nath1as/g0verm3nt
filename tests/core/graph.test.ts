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
  checkGraphAgainstContract,
  decodeGraph,
  type EffectBound,
  emptyEffectBound,
  type GraphCatalogue,
  type GraphInterpreter,
  interpretGraph,
  isAbstractionRef,
  isSchemaRef,
  parseAbstractionRef,
  parseSchemaRef,
  type RetryWitness,
  type SchemaRef,
} from "../../src/core/graph.ts";

const number = requiredSchema("example/number@1");
const text = requiredSchema("example/text@1");
const sourceRecord = requiredSchema("example/source-record@1");
const targetRecord = requiredSchema("example/target-record@1");
const classificationRecord = requiredSchema("example/classification@1");
const increment = requiredAbstraction("example/increment@1");
const render = requiredAbstraction("example/render@1");
const fast = requiredAbstraction("example/fast@1");
const slow = requiredAbstraction("example/slow@1");
const flaky = requiredAbstraction("example/flaky@1");
const verifier = requiredVerifier("example/structural-verifier@1");

describe("M1 closed graph fragment", () => {
  test("decodes only the closed graph grammar", () => {
    const graph = decodeGraph({
      kind: "seq",
      first: { kind: "id", schema: "example/number@1" },
      second: { kind: "call", abstraction: "example/increment@1" },
    });

    expect(graph).toEqual({
      kind: "seq",
      first: { kind: "id", schema: number },
      second: { kind: "call", abstraction: increment },
    });
    expect(
      decodeGraph({ kind: "id", schema: "example/number@1", extra: true }),
    ).toEqual({
      kind: "InvalidGraph",
      path: ["extra"],
      reason: "UnexpectedField",
    });
    expect(decodeGraph({ kind: "unrecognized" })).toEqual({
      kind: "InvalidGraph",
      path: ["kind"],
      reason: "InvalidKind",
    });
    expect(
      decodeGraph({
        kind: "wire",
        input: "example/source-record@1",
        output: "example/target-record@1",
        fields: [{ from: "not-a-field", to: "title" }],
      }),
    ).toEqual({
      kind: "InvalidGraph",
      path: ["fields", "0"],
      reason: "InvalidWireField",
    });
  });

  test("checks identity as an effect-free exact schema identity", () => {
    const graph = { kind: "id", schema: number } as const;

    expect(checkGraph(graph, catalogue())).toEqual({
      graph,
      input: number,
      output: number,
      effect: emptyEffectBound,
      calls: [],
      failures: [],
    });
  });

  test("requires an exact registered abstraction reference", () => {
    const graph = {
      kind: "call",
      abstraction: requiredAbstraction("example/increment@2"),
    } as const;

    expect(checkGraph(graph, catalogue())).toEqual({
      kind: "UnknownAbstraction",
      path: [],
      abstraction: graph.abstraction,
    });
  });

  test("rejects an incompatible sequence before it invokes a capability", () => {
    let calls = 0;
    const graph = {
      kind: "seq",
      first: { kind: "call", abstraction: increment },
      second: { kind: "id", schema: text },
    } as const;

    const result = interpretGraph(graph, catalogue(), 1, {
      call() {
        calls += 1;
        return { kind: "succeeded", output: 0 };
      },
    });

    expect(result).toEqual({
      kind: "SequenceInterfaceMismatch",
      path: [],
      firstOutput: number,
      secondInput: text,
    });
    expect(calls).toBe(0);
  });

  test("interprets a checked sequence in order and combines its effect bound", () => {
    const graph = {
      kind: "seq",
      first: { kind: "call", abstraction: increment },
      second: { kind: "call", abstraction: render },
    } as const;
    const execution = interpretGraph(graph, catalogue(), 2, interpreter);

    expect(execution).toEqual({
      kind: "succeeded",
      output: "3",
      calls: [increment, render],
      effect: {
        capabilities: ["format", "math"],
        reads: ["input"],
        writes: ["output"],
        maxOperations: 2,
      },
    });
  });

  test("retries only declared domain failures within its witness cap", () => {
    const graph = {
      kind: "retry",
      maxAttempts: 3,
      witness: retryWitness(3),
      body: { kind: "call", abstraction: flaky },
    } as const;
    let attempts = 0;
    const execution = interpretGraph(graph, catalogue(), 2, {
      call() {
        attempts += 1;
        return attempts === 1
          ? { kind: "failed", failure: "Transient" }
          : { kind: "succeeded", output: 3 };
      },
    });

    expect(execution).toEqual({
      kind: "succeeded",
      output: 3,
      calls: [flaky, flaky],
      effect: {
        capabilities: ["math"],
        reads: ["input"],
        writes: [],
        maxOperations: 3,
      },
    });
    expect(attempts).toBe(2);
    let exhaustedAttempts = 0;
    expect(
      interpretGraph(graph, catalogue(), 2, {
        call() {
          exhaustedAttempts += 1;
          return { kind: "failed", failure: "Transient" };
        },
      }),
    ).toMatchObject({
      kind: "failed",
      failure: "OperationFailed",
      detail: "Transient",
      calls: [flaky, flaky, flaky],
    });
    expect(exhaustedAttempts).toBe(3);
    expect(
      interpretGraph(graph, catalogue(), 2, {
        call() {
          return { kind: "failed", failure: "Permanent" };
        },
      }),
    ).toEqual({
      kind: "failed",
      failure: "OperationFailed",
      detail: "Permanent",
      calls: [flaky],
      effect: {
        capabilities: ["math"],
        reads: ["input"],
        writes: [],
        maxOperations: 3,
      },
    });
  });

  test("rejects a malformed or insufficient retry witness before execution", () => {
    expect(
      decodeGraph({
        kind: "retry",
        maxAttempts: 0,
        witness: retryWitness(3),
        body: { kind: "call", abstraction: "example/flaky@1" },
      }),
    ).toEqual({
      kind: "InvalidGraph",
      path: ["maxAttempts"],
      reason: "InvalidRetry",
    });
    const graph = {
      kind: "retry",
      maxAttempts: 3,
      witness: { ...retryWitness(2), effectCeiling: incrementEffect },
      body: { kind: "call", abstraction: flaky },
    } as const;
    expect(checkGraph(graph, catalogue())).toEqual({
      kind: "RetryWitnessAttemptBoundExceeded",
      path: [],
      maxAttempts: 3,
      witnessMaximum: 2,
    });
    expect(
      checkGraph(
        {
          ...graph,
          witness: {
            ...retryWitness(3),
            retryableFailures: ["NotDeclared"],
          },
        },
        catalogue(),
      ),
    ).toEqual({
      kind: "RetryWitnessUndeclaredFailure",
      path: [],
      failure: "NotDeclared",
    });
  });

  test("wires named immutable record fields without invoking a capability", () => {
    const graph = {
      kind: "wire",
      input: sourceRecord,
      output: targetRecord,
      fields: [
        { from: "label", to: "title" },
        { from: "count", to: "amount" },
      ],
    } as const;

    expect(
      interpretGraph(
        graph,
        catalogue(),
        { count: 3, label: "three" },
        {
          call() {
            throw new Error("wire must not invoke a capability");
          },
        },
      ),
    ).toEqual({
      kind: "succeeded",
      output: { title: "three", amount: 3 },
      calls: [],
      effect: emptyEffectBound,
    });
  });

  test("rejects a wire whose field schemas do not match", () => {
    const graph = {
      kind: "wire",
      input: sourceRecord,
      output: targetRecord,
      fields: [{ from: "label", to: "amount" }],
    } as const;

    expect(checkGraph(graph, catalogue())).toEqual({
      kind: "WireFieldSchemaMismatch",
      path: [],
      from: "label",
      to: "amount",
      sourceSchema: text,
      targetSchema: number,
    });
  });

  test("routes only on a declared finite tag and charges the branch upper bound", () => {
    const graph = {
      kind: "route",
      input: classificationRecord,
      predicate: {
        kind: "and",
        left: { kind: "true" },
        right: { kind: "tagEquals", field: "kind", value: "fast" },
      },
      whenTrue: { kind: "call", abstraction: fast },
      whenFalse: { kind: "call", abstraction: slow },
    } as const;

    expect(
      interpretGraph(
        graph,
        catalogue(),
        { kind: "fast", note: "x" },
        interpreter,
      ),
    ).toEqual({
      kind: "succeeded",
      output: "fast",
      calls: [fast],
      effect: {
        capabilities: ["fast", "slow"],
        reads: [],
        writes: [],
        maxOperations: 1,
      },
    });
  });

  test("returns GuardRejected without dispatch when a declared predicate is false", () => {
    const graph = {
      kind: "guard",
      input: classificationRecord,
      predicate: { kind: "tagEquals", field: "kind", value: "fast" },
      body: { kind: "id", schema: classificationRecord },
    } as const;

    expect(
      interpretGraph(
        graph,
        catalogue(),
        { kind: "slow", note: "x" },
        interpreter,
      ),
    ).toEqual({
      kind: "failed",
      failure: "GuardRejected",
      detail: null,
      calls: [],
      effect: emptyEffectBound,
    });
    expect(
      checkGraph(
        {
          ...graph,
          predicate: { kind: "tagEquals", field: "note", value: "x" },
        },
        catalogue(),
      ),
    ).toEqual({
      kind: "PredicateUndeclaredDomain",
      path: [],
      field: "note",
    });
    expect(
      checkGraph(
        {
          ...graph,
          predicate: { kind: "tagEquals", field: "kind", value: "unknown" },
        },
        catalogue(),
      ),
    ).toEqual({
      kind: "PredicateValueOutsideDomain",
      path: [],
      field: "kind",
      value: "unknown",
    });
    expect(
      checkGraphAgainstContract(
        graph,
        catalogue(),
        contract(classificationRecord, classificationRecord, emptyEffectBound),
      ),
    ).toEqual({ kind: "GraphFailureNotAllowed", failure: "GuardRejected" });
  });
});

const incrementEffect: EffectBound = {
  capabilities: ["math"],
  reads: ["input"],
  writes: [],
  maxOperations: 1,
};

const renderEffect: EffectBound = {
  capabilities: ["format"],
  reads: [],
  writes: ["output"],
  maxOperations: 1,
};

const branchEffect: EffectBound = {
  capabilities: ["fast"],
  reads: [],
  writes: [],
  maxOperations: 1,
};

const slowEffect: EffectBound = {
  capabilities: ["slow"],
  reads: [],
  writes: [],
  maxOperations: 1,
};

const interpreter: GraphInterpreter = {
  call(abstraction, input) {
    if (abstraction.ref === increment) {
      if (typeof input !== "number")
        throw new Error("increment expects a number");
      return { kind: "succeeded", output: input + 1 };
    }
    if (abstraction.ref === render) {
      if (typeof input !== "number") throw new Error("render expects a number");
      return { kind: "succeeded", output: String(input) };
    }
    if (abstraction.ref === fast) return { kind: "succeeded", output: "fast" };
    if (abstraction.ref === slow) return { kind: "succeeded", output: "slow" };
    throw new Error(`unexpected abstraction: ${abstraction.ref}`);
  },
};

function catalogue(): GraphCatalogue {
  const entries: readonly CallableAbstraction[] = [
    {
      ref: increment,
      contract: contract(number, number, incrementEffect),
    },
    { ref: render, contract: contract(number, text, renderEffect) },
    {
      ref: fast,
      contract: contract(classificationRecord, text, branchEffect),
    },
    {
      ref: slow,
      contract: contract(classificationRecord, text, slowEffect),
    },
    {
      ref: flaky,
      contract: contract(number, number, incrementEffect, [
        "Transient",
        "Permanent",
      ]),
    },
  ];
  return {
    abstractions: new Map(entries.map((entry) => [entry.ref, entry])),
    schemas: new Map([
      [number, { kind: "atomic", ref: number }],
      [text, { kind: "atomic", ref: text }],
      [
        classificationRecord,
        {
          kind: "record",
          ref: classificationRecord,
          fields: [
            {
              name: "kind",
              schema: text,
              predicateDomain: { kind: "tag", values: ["fast", "slow"] },
            },
            { name: "note", schema: text },
          ],
        },
      ],
      [
        sourceRecord,
        {
          kind: "record",
          ref: sourceRecord,
          fields: [
            { name: "count", schema: number },
            { name: "label", schema: text },
          ],
        },
      ],
      [
        targetRecord,
        {
          kind: "record",
          ref: targetRecord,
          fields: [
            { name: "title", schema: text },
            { name: "amount", schema: number },
          ],
        },
      ],
    ]),
  };
}

function contract(
  input: SchemaRef,
  output: SchemaRef,
  effect: EffectBound,
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

function retryWitness(maxAttempts: number): RetryWitness {
  return {
    precondition: number,
    maxAttempts,
    retryableFailures: ["Transient"],
    restoration: "sameInput",
    idempotency: "required",
    effectCeiling: {
      capabilities: ["math"],
      reads: ["input"],
      writes: [],
      maxOperations: maxAttempts,
    },
  };
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

function requiredVerifier(value: string) {
  const parsed = parseVerifierRef(value);
  if (!isVerifierRef(parsed))
    throw new Error(`invalid test verifier: ${value}`);
  return parsed;
}
