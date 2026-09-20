import { describe, expect, test } from "bun:test";
import {
  type Contract,
  isVerifierRef,
  parseVerifierRef,
} from "../../src/core/contracts.ts";
import {
  type AbstractionRef,
  type CallableAbstraction,
  type EffectBound,
  type GraphCallResult,
  type GraphCatalogue,
  type GraphExecution,
  type GraphInterpreter,
  interpretGraph,
  isAbstractionRef,
  isSchemaRef,
  parseAbstractionRef,
  parseSchemaRef,
  type RetryWitness,
  type SchemaRef,
} from "../../src/core/graph.ts";
import {
  createCatalogueManifest,
  defineGraph,
  emptyGraphDefinitionRegistry,
  isCatalogueManifestRef,
  parseCatalogueManifestRef,
  registerGraphDefinition,
  resolveGraphDefinition,
} from "../../src/core/graph-definition.ts";
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
const increment = requiredAbstraction("example/increment@1");
const flaky = requiredAbstraction("example/flaky@1");
const verifier = requiredVerifier("example/definition-verifier@1");

describe("M1 graph definitions and manifest conformance", () => {
  test("snapshots an exact catalogue manifest and rejects a mismatched one", () => {
    const catalogue = fixtureCatalogue();
    const manifest = createCatalogueManifest(
      requiredManifestRef("example/catalogue@1"),
      catalogue,
    );
    const graph = { kind: "call", abstraction: increment } as const;
    const definition = defineGraph(
      requiredGraphRef("example/increment-graph@1"),
      graph,
      manifest,
      catalogue,
    );
    if ("kind" in definition)
      throw new Error(`definition failed: ${definition.kind}`);

    (
      catalogue.abstractions as Map<AbstractionRef, CallableAbstraction>
    ).clear();
    expect(definition.manifest).toEqual({
      ref: requiredManifestRef("example/catalogue@1"),
      abstractions: [flaky, increment],
      schemas: [number],
    });
    expect(definition.catalogue.abstractions.has(increment)).toBe(true);
    expect(
      defineGraph(
        requiredGraphRef("example/mismatch@1"),
        graph,
        { ...manifest, abstractions: [increment] },
        fixtureCatalogue(),
      ),
    ).toMatchObject({ kind: "ManifestDoesNotMatchCatalogue" });
  });

  test("registers immutable exact definitions without a mutable head", () => {
    const definition = requiredDefinition(
      requiredGraphRef("example/registry-graph@1"),
      { kind: "call", abstraction: increment },
    );
    const registered = registerGraphDefinition(
      emptyGraphDefinitionRegistry,
      definition,
    );
    if (registered.kind !== "registered")
      throw new Error("expected registration");

    expect(resolveGraphDefinition(registered.registry, definition.ref)).toBe(
      definition,
    );
    expect(emptyGraphDefinitionRegistry.definitions.size).toBe(0);
    expect(registerGraphDefinition(registered.registry, definition)).toEqual({
      kind: "duplicate",
      ref: definition.ref,
    });
  });

  test("frame stepping agrees with the reference interpreter for bounded retry", () => {
    const definition = requiredDefinition(
      requiredGraphRef("example/retry-pipeline@1"),
      {
        kind: "seq",
        first: {
          kind: "retry",
          maxAttempts: 2,
          witness: retryWitness(),
          body: { kind: "call", abstraction: flaky },
        },
        second: { kind: "call", abstraction: increment },
      },
    );

    const reference = interpretGraph(
      definition.graph,
      definition.catalogue,
      1,
      flakyThenIncrementInterpreter(),
    );
    if ("path" in reference)
      throw new Error(`reference failed: ${reference.kind}`);
    const framed = runFrame(definition, 1, flakyThenIncrementInterpreter());

    expect(framed).toEqual(reference);
    expect(framed).toEqual({
      kind: "succeeded",
      output: 7,
      calls: [flaky, flaky, increment],
      effect: definition.checked.effect,
    });
  });
});

function runFrame(
  definition: Exclude<ReturnType<typeof defineGraph>, { kind: string }>,
  input: number,
  interpreter: GraphInterpreter,
): GraphExecution {
  let frame = startGraphFrame(definition.ref, definition.checked, input);
  const calls: AbstractionRef[] = [];
  let operationNumber = 0;
  for (let steps = 0; steps < 100; steps += 1) {
    if (frame.state.kind === "running") {
      operationNumber += 1;
      const retry = [...frame.state.continuations]
        .reverse()
        .find((continuation) => continuation.kind === "retry");
      const operationId = requiredOperationId(`operation-${operationNumber}`);
      const attemptId =
        retry === undefined
          ? undefined
          : (retry.attemptId ?? requiredAttemptId(`attempt-${retry.ordinal}`));
      const step = advanceGraphFrame(frame, operationId, attemptId);
      if (step.kind === "advanced") {
        frame = step.frame;
        continue;
      }
      if (step.kind === "terminal") {
        frame = step.frame;
        continue;
      }
      if (step.kind === "rejected")
        throw new Error(`frame rejected: ${step.reason.kind}`);
      calls.push(step.operation.abstraction);
      const abstraction = definition.catalogue.abstractions.get(
        step.operation.abstraction,
      );
      if (abstraction === undefined)
        throw new Error(`missing abstraction: ${step.operation.abstraction}`);
      const result = interpreter.call(abstraction, step.operation.input);
      const observed = observeGraphOperation(
        step.frame,
        result.kind === "succeeded"
          ? {
              kind: "succeeded",
              operationId: step.operation.operationId,
              output: result.output,
            }
          : {
              kind: "failed",
              operationId: step.operation.operationId,
              failure: result.failure,
            },
      );
      if (observed.kind === "rejected")
        throw new Error(`observation rejected: ${observed.reason.kind}`);
      frame = observed.frame;
      continue;
    }
    if (frame.state.kind === "succeeded") {
      return {
        kind: "succeeded",
        output: frame.state.output,
        calls,
        effect: definition.checked.effect,
      };
    }
    if (frame.state.kind === "failed") {
      return {
        kind: "failed",
        failure: frame.state.failure,
        detail: frame.state.detail,
        calls,
        effect: definition.checked.effect,
      };
    }
    throw new Error("driver always observes a planned operation immediately");
  }
  throw new Error("frame did not terminate within its bounded step limit");
}

function requiredDefinition(
  ref: ReturnType<typeof requiredGraphRef>,
  graph: Parameters<typeof defineGraph>[1],
) {
  const catalogue = fixtureCatalogue();
  const definition = defineGraph(
    ref,
    graph,
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
  const entries: readonly CallableAbstraction[] = [
    { ref: increment, contract: contract(number, number, []) },
    { ref: flaky, contract: contract(number, number, ["Transient"]) },
  ];
  return {
    abstractions: new Map(entries.map((entry) => [entry.ref, entry])),
    schemas: new Map([[number, { kind: "atomic", ref: number }]]),
  };
}

function contract(
  input: SchemaRef,
  output: SchemaRef,
  failures: readonly string[],
): Contract {
  const effect: EffectBound = {
    capabilities: ["math"],
    reads: ["input"],
    writes: [],
    maxOperations: 1,
  };
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
    effectCeiling: {
      capabilities: ["math"],
      reads: ["input"],
      writes: [],
      maxOperations: 2,
    },
  };
}

function flakyThenIncrementInterpreter(): GraphInterpreter {
  let flakyCalls = 0;
  return {
    call(abstraction, input): GraphCallResult {
      if (typeof input !== "number") throw new Error("fixture expects numbers");
      if (abstraction.ref === flaky) {
        flakyCalls += 1;
        return flakyCalls === 1
          ? { kind: "failed", failure: "Transient" }
          : { kind: "succeeded", output: input + 5 };
      }
      if (abstraction.ref === increment)
        return { kind: "succeeded", output: input + 1 };
      throw new Error(`unexpected abstraction: ${abstraction.ref}`);
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

function requiredGraphRef(value: string) {
  const parsed = parseGraphRef(value);
  if (!isGraphRef(parsed)) throw new Error(`invalid test graph ref: ${value}`);
  return parsed;
}

function requiredManifestRef(value: string) {
  const parsed = parseCatalogueManifestRef(value);
  if (!isCatalogueManifestRef(parsed))
    throw new Error(`invalid test manifest ref: ${value}`);
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

import {
  admitNormalizationEvidence,
  evaluateNormalization,
  normalizationBaseline,
  normalizationCapabilityFor,
  normalizationFiniteDomain,
  normalizationRefs,
  normalizationRevised,
} from "../../src/fixtures/normalization.ts";

test("normalization fixture evaluates a complete deterministic ordering", () => {
  expect(
    evaluateNormalization("batch-1", [
      { id: "b", value: "zeta" },
      { id: "a", value: "alpha" },
    ]),
  ).toEqual({
    batchId: "batch-1",
    records: [
      { id: "a", value: "alpha" },
      { id: "b", value: "zeta" },
    ],
    complete: true,
    audit: [
      { inputId: "a", outputIndex: 0 },
      { inputId: "b", outputIndex: 1 },
    ],
  });
  expect(() =>
    evaluateNormalization("batch-1", [
      { id: "a", value: "x" },
      { id: "a", value: "y" },
    ]),
  ).toThrow("duplicate normalization record");
});

test("normalization evidence admission requires a complete audit", () => {
  const result = evaluateNormalization("batch-2", [{ id: "a", value: "x" }]);
  expect(admitNormalizationEvidence(result)).toBe(true);
  expect(admitNormalizationEvidence({ ...result, audit: [] })).toBe(false);
});

test("normalization revision routes the complete finite domain", () => {
  expect(normalizationBaseline.graph).toEqual({
    kind: "call",
    abstraction: normalizationRefs.slowCapability,
  });
  expect(normalizationRevised.graph).toMatchObject({
    kind: "route",
    predicate: { kind: "integerAtMost", field: "record_count", value: 1 },
  });
  expect(normalizationRevised.checked.calls).toEqual([
    normalizationRefs.fastCapability,
    normalizationRefs.slowCapability,
  ]);
  for (const records of normalizationFiniteDomain) {
    expect(evaluateNormalization("finite", records)).toEqual(
      evaluateNormalization("finite", records),
    );
    expect(normalizationCapabilityFor(records)).toBe(
      records.length <= 1
        ? normalizationRefs.fastCapability
        : normalizationRefs.slowCapability,
    );
  }
  expect(() =>
    normalizationCapabilityFor([
      { id: "a", value: "a" },
      { id: "b", value: "b" },
      { id: "c", value: "c" },
    ]),
  ).toThrow("exceeds finite domain");
});
