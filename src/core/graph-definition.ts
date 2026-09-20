import type { SchemaCatalogue } from "./contracts.ts";
import {
  type AbstractionRef,
  type CheckedGraph,
  checkGraph,
  type Graph,
  type GraphCatalogue,
  type GraphCheckError,
  type SchemaRef,
} from "./graph.ts";
import type { GraphRef } from "./graph-frame.ts";

declare const catalogueManifestRefBrand: unique symbol;

export type CatalogueManifestRef = string &
  Readonly<{ [catalogueManifestRefBrand]: "CatalogueManifestRef" }>;

export type InvalidCatalogueManifestRef = Readonly<{
  kind: "InvalidCatalogueManifestRef";
  value: string;
}>;

/** Exact dependencies available to one immutable graph definition. */
export type CatalogueManifest = Readonly<{
  ref: CatalogueManifestRef;
  abstractions: readonly AbstractionRef[];
  schemas: readonly SchemaRef[];
}>;

export type GraphDefinition = Readonly<{
  ref: GraphRef;
  graph: Graph;
  catalogue: GraphCatalogue;
  manifest: CatalogueManifest;
  checked: CheckedGraph;
}>;

export type GraphDefinitionError =
  | GraphCheckError
  | Readonly<{
      kind: "ManifestDoesNotMatchCatalogue";
      manifest: CatalogueManifest;
      actual: CatalogueManifest;
    }>;

export type GraphDefinitionRegistry = Readonly<{
  definitions: ReadonlyMap<GraphRef, GraphDefinition>;
}>;

export type RegisterGraphDefinition =
  | Readonly<{ kind: "registered"; registry: GraphDefinitionRegistry }>
  | Readonly<{ kind: "duplicate"; ref: GraphRef }>;

const exactReferencePattern =
  /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*@[1-9][0-9]*$/;

export function parseCatalogueManifestRef(
  value: string,
): CatalogueManifestRef | InvalidCatalogueManifestRef {
  return exactReferencePattern.test(value)
    ? (value as CatalogueManifestRef)
    : { kind: "InvalidCatalogueManifestRef", value };
}

export function isCatalogueManifestRef(
  value: CatalogueManifestRef | InvalidCatalogueManifestRef,
): value is CatalogueManifestRef {
  return typeof value === "string";
}

export function createCatalogueManifest(
  ref: CatalogueManifestRef,
  catalogue: GraphCatalogue,
): CatalogueManifest {
  return Object.freeze({
    ref,
    abstractions: Object.freeze([...catalogue.abstractions.keys()].sort()),
    schemas: Object.freeze([...catalogue.schemas.keys()].sort()),
  });
}

/**
 * Checks and snapshots a graph with precisely the catalogue it was authored
 * against. This is intentionally in-memory; M2 gives these records canonical
 * encodings and durable identities.
 */
export function defineGraph(
  ref: GraphRef,
  graph: Graph,
  manifest: CatalogueManifest,
  catalogue: GraphCatalogue,
): GraphDefinition | GraphDefinitionError {
  const actual = createCatalogueManifest(manifest.ref, catalogue);
  if (!sameManifest(manifest, actual)) {
    return { kind: "ManifestDoesNotMatchCatalogue", manifest, actual };
  }
  const snapshotGraph = deepFreeze(structuredClone(graph));
  const snapshotCatalogue = snapshotCatalogueOf(catalogue);
  const checked = checkGraph(snapshotGraph, snapshotCatalogue);
  if (isGraphCheckError(checked)) return checked;
  return Object.freeze({
    ref,
    graph: snapshotGraph,
    catalogue: snapshotCatalogue,
    manifest: Object.freeze({
      ref: manifest.ref,
      abstractions: Object.freeze([...manifest.abstractions]),
      schemas: Object.freeze([...manifest.schemas]),
    }),
    checked: deepFreeze(checked),
  });
}

export const emptyGraphDefinitionRegistry: GraphDefinitionRegistry =
  Object.freeze({
    definitions: new Map(),
  });

export function registerGraphDefinition(
  registry: GraphDefinitionRegistry,
  definition: GraphDefinition,
): RegisterGraphDefinition {
  if (registry.definitions.has(definition.ref))
    return { kind: "duplicate", ref: definition.ref };
  return {
    kind: "registered",
    registry: Object.freeze({
      definitions: new Map([
        ...registry.definitions,
        [definition.ref, definition],
      ]),
    }),
  };
}

export function resolveGraphDefinition(
  registry: GraphDefinitionRegistry,
  ref: GraphRef,
): GraphDefinition | null {
  return registry.definitions.get(ref) ?? null;
}

function snapshotCatalogueOf(catalogue: GraphCatalogue): GraphCatalogue {
  return Object.freeze({
    abstractions: new Map(
      [...catalogue.abstractions].map(([ref, abstraction]) => [
        ref,
        deepFreeze(structuredClone(abstraction)),
      ]),
    ),
    schemas: snapshotSchemas(catalogue.schemas),
  });
}

function snapshotSchemas(catalogue: SchemaCatalogue): SchemaCatalogue {
  return new Map(
    [...catalogue].map(([ref, schema]) => [
      ref,
      deepFreeze(structuredClone(schema)),
    ]),
  );
}

function sameManifest(
  expected: CatalogueManifest,
  actual: CatalogueManifest,
): boolean {
  return (
    expected.ref === actual.ref &&
    sameReferences(expected.abstractions, actual.abstractions) &&
    sameReferences(expected.schemas, actual.schemas)
  );
}

function sameReferences(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isGraphCheckError(
  value: CheckedGraph | GraphCheckError,
): value is GraphCheckError {
  return "path" in value;
}
