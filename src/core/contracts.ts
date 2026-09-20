import type { EffectBound, SchemaRef } from "./graph.ts";

declare const verifierRefBrand: unique symbol;

export type VerifierRef = string &
  Readonly<{ [verifierRefBrand]: "VerifierRef" }>;

export type InvalidVerifierRef = Readonly<{
  kind: "InvalidVerifierRef";
  value: string;
}>;

export type Contract = Readonly<{
  input: SchemaRef;
  output: SchemaRef;
  effect: EffectBound;
  failures: readonly string[];
  verifier: VerifierRef;
  assumptions: readonly string[];
  assurance: "authored" | "verified";
}>;

export type RecordSchema = Readonly<{
  kind: "record";
  ref: SchemaRef;
  fields: readonly SchemaField[];
}>;

export type AtomicSchema = Readonly<{
  kind: "atomic";
  ref: SchemaRef;
}>;

export type SchemaDefinition = RecordSchema | AtomicSchema;

export type SchemaField = Readonly<{
  name: string;
  schema: SchemaRef;
  predicateDomain?: PredicateDomain;
}>;

export type PredicateDomain =
  | Readonly<{ kind: "tag"; values: readonly string[] }>
  | Readonly<{ kind: "integer"; minimum: number; maximum: number }>;

export type SchemaCatalogue = ReadonlyMap<SchemaRef, SchemaDefinition>;

const exactReferencePattern =
  /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*@[1-9][0-9]*$/;

export function parseVerifierRef(
  value: string,
): VerifierRef | InvalidVerifierRef {
  return exactReferencePattern.test(value)
    ? (value as VerifierRef)
    : { kind: "InvalidVerifierRef", value };
}

export function isVerifierRef(
  value: VerifierRef | InvalidVerifierRef,
): value is VerifierRef {
  return typeof value === "string";
}
