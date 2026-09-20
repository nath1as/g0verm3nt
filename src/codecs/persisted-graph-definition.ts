import {
  type Contract,
  isVerifierRef,
  type PredicateDomain,
  parseVerifierRef,
  type SchemaDefinition,
} from "../core/contracts.ts";
import {
  type AbstractionRef,
  type CallableAbstraction,
  decodeGraph,
  type EffectBound,
  type GraphCatalogue,
  isAbstractionRef,
  isSchemaRef,
  type JsonValue,
  parseAbstractionRef,
  parseSchemaRef,
  type SchemaRef,
} from "../core/graph.ts";
import {
  type CatalogueManifest,
  defineGraph,
  type GraphDefinition,
  isCatalogueManifestRef,
  parseCatalogueManifestRef,
} from "../core/graph-definition.ts";
import { isGraphRef, parseGraphRef } from "../core/graph-frame.ts";

type JsonObject = Readonly<{ [key: string]: JsonValue }>;

const fieldNamePattern = /^[a-z][a-z0-9_]{0,63}$/;

export function decodePinnedGraphDefinition(
  definitionValue: JsonValue,
  catalogueValue: JsonValue,
): GraphDefinition {
  const definition = exactObject(
    definitionValue,
    ["catalogueRef", "checked", "graph", "manifest", "ref"],
    "definition",
  );
  const ref = graphRef(requiredString(definition, "ref", "definition"));
  const catalogueRef = manifestRef(
    requiredString(definition, "catalogueRef", "definition"),
  );
  const manifest = decodeManifest(requiredField(definition, "manifest"));
  if (manifest.ref !== catalogueRef)
    throw new Error(
      "definition manifest does not match its catalogue reference",
    );

  const catalogue = decodeCatalogue(catalogueValue, catalogueRef);
  const graph = decodeGraph(requiredField(definition, "graph"));
  if ("reason" in graph)
    throw new Error(`definition graph has invalid syntax: ${graph.reason}`);

  const rebuilt = defineGraph(ref, graph, manifest, catalogue);
  if ("kind" in rebuilt)
    throw new Error(`definition graph is not runnable: ${rebuilt.kind}`);
  return rebuilt;
}

function decodeManifest(value: JsonValue): CatalogueManifest {
  const object = exactObject(
    value,
    ["abstractions", "ref", "schemas"],
    "manifest",
  );
  const ref = manifestRef(requiredString(object, "ref", "manifest"));
  return Object.freeze({
    ref,
    abstractions: referenceList(
      requiredField(object, "abstractions"),
      "manifest abstractions",
      abstractionRef,
    ),
    schemas: referenceList(
      requiredField(object, "schemas"),
      "manifest schemas",
      schemaRef,
    ),
  });
}

function decodeCatalogue(
  value: JsonValue,
  expectedRef: CatalogueManifest["ref"],
): GraphCatalogue {
  const object = exactObject(
    value,
    ["abstractions", "ref", "schemas"],
    "catalogue",
  );
  const ref = manifestRef(requiredString(object, "ref", "catalogue"));
  if (ref !== expectedRef)
    throw new Error("catalogue reference does not match definition");

  const schemas = new Map<SchemaRef, SchemaDefinition>();
  for (const entry of entryList(requiredField(object, "schemas"), "schemas")) {
    const wrapper = exactObject(entry, ["ref", "schema"], "schema entry");
    const ref = schemaRef(requiredString(wrapper, "ref", "schema entry"));
    if (schemas.has(ref))
      throw new Error(`schemas contains duplicate reference ${ref}`);
    schemas.set(ref, decodeSchema(requiredField(wrapper, "schema"), ref));
  }

  for (const schema of schemas.values()) {
    if (schema.kind !== "record") continue;
    for (const field of schema.fields) {
      if (!schemas.has(field.schema))
        throw new Error(
          `record schema references an unknown field schema ${field.schema}`,
        );
    }
  }

  const abstractions = new Map<AbstractionRef, CallableAbstraction>();
  for (const entry of entryList(
    requiredField(object, "abstractions"),
    "abstractions",
  )) {
    const wrapper = exactObject(
      entry,
      ["contract", "ref"],
      "abstraction entry",
    );
    const ref = abstractionRef(
      requiredString(wrapper, "ref", "abstraction entry"),
    );
    if (abstractions.has(ref))
      throw new Error(`abstractions contains duplicate reference ${ref}`);
    abstractions.set(ref, {
      ref,
      contract: decodeContract(requiredField(wrapper, "contract"), schemas),
    });
  }

  return Object.freeze({ abstractions, schemas });
}

function decodeSchema(
  value: JsonValue,
  expectedRef: SchemaRef,
): SchemaDefinition {
  const object = objectValue(value, "schema");
  const kind = requiredString(object, "kind", "schema");
  if (kind === "atomic") {
    const atomic = exactObject(value, ["kind", "ref"], "atomic schema");
    const ref = schemaRef(requiredString(atomic, "ref", "atomic schema"));
    if (ref !== expectedRef)
      throw new Error("atomic schema reference does not match wrapper");
    return Object.freeze({ kind, ref });
  }
  if (kind !== "record") throw new Error("schema has an unsupported kind");
  const record = exactObject(value, ["fields", "kind", "ref"], "record schema");
  const ref = schemaRef(requiredString(record, "ref", "record schema"));
  if (ref !== expectedRef)
    throw new Error("record schema reference does not match wrapper");
  const fields = entryList(
    requiredField(record, "fields"),
    "record fields",
  ).map((fieldValue) => decodeSchemaField(fieldValue));
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name))
      throw new Error(`record schema contains duplicate field ${field.name}`);
    names.add(field.name);
  }
  return Object.freeze({ kind, ref, fields: Object.freeze(fields) });
}

function decodeSchemaField(value: JsonValue): {
  readonly name: string;
  readonly schema: SchemaRef;
  readonly predicateDomain?: PredicateDomain;
} {
  const object = objectValue(value, "record field");
  const keys = Object.keys(object).sort();
  const allowed = ["name", "predicateDomain", "schema"];
  if (!same(keys, ["name", "schema"]) && !same(keys, allowed))
    throw new Error("record field has an invalid shape");
  const name = requiredString(object, "name", "record field");
  if (!fieldNamePattern.test(name))
    throw new Error("record field has an invalid name");
  const schema = schemaRef(requiredString(object, "schema", "record field"));
  const domain =
    object.predicateDomain === undefined
      ? undefined
      : decodePredicateDomain(object.predicateDomain);
  return domain === undefined
    ? Object.freeze({ name, schema })
    : Object.freeze({ name, schema, predicateDomain: domain });
}

function decodePredicateDomain(value: JsonValue): PredicateDomain {
  const object = objectValue(value, "predicate domain");
  const kind = requiredString(object, "kind", "predicate domain");
  if (kind === "tag") {
    const tag = exactObject(value, ["kind", "values"], "tag predicate domain");
    const values = names(requiredField(tag, "values"), "tag predicate values");
    if (values.length === 0)
      throw new Error("tag predicate domain cannot be empty");
    return Object.freeze({ kind, values: Object.freeze(values) });
  }
  if (kind === "integer") {
    const integer = exactObject(
      value,
      ["kind", "maximum", "minimum"],
      "integer predicate domain",
    );
    const minimum = safeInteger(
      requiredField(integer, "minimum"),
      "integer predicate minimum",
    );
    const maximum = safeInteger(
      requiredField(integer, "maximum"),
      "integer predicate maximum",
    );
    if (minimum > maximum)
      throw new Error("integer predicate domain has an inverted range");
    return Object.freeze({ kind, minimum, maximum });
  }
  throw new Error("predicate domain has an unsupported kind");
}

function decodeContract(
  value: JsonValue,
  schemas: ReadonlyMap<SchemaRef, SchemaDefinition>,
): Contract {
  const object = exactObject(
    value,
    [
      "assumptions",
      "assurance",
      "effect",
      "failures",
      "input",
      "output",
      "verifier",
    ],
    "contract",
  );
  const input = schemaRef(requiredString(object, "input", "contract"));
  const output = schemaRef(requiredString(object, "output", "contract"));
  if (!schemas.has(input) || !schemas.has(output))
    throw new Error("contract references an unknown schema");
  const verifier = parseVerifierRef(
    requiredString(object, "verifier", "contract"),
  );
  if (!isVerifierRef(verifier))
    throw new Error("contract has an invalid verifier");
  const assurance = requiredString(object, "assurance", "contract");
  if (assurance !== "authored" && assurance !== "verified")
    throw new Error("contract has an invalid assurance");
  return Object.freeze({
    input,
    output,
    effect: decodeEffect(requiredField(object, "effect")),
    failures: Object.freeze(
      names(requiredField(object, "failures"), "failures"),
    ),
    verifier,
    assumptions: Object.freeze(
      names(requiredField(object, "assumptions"), "assumptions"),
    ),
    assurance,
  });
}

function decodeEffect(value: JsonValue): EffectBound {
  const object = exactObject(
    value,
    ["capabilities", "maxOperations", "reads", "writes"],
    "effect",
  );
  return Object.freeze({
    capabilities: Object.freeze(
      names(requiredField(object, "capabilities"), "effect capabilities"),
    ),
    reads: Object.freeze(names(requiredField(object, "reads"), "effect reads")),
    writes: Object.freeze(
      names(requiredField(object, "writes"), "effect writes"),
    ),
    maxOperations: nonnegativeSafeInteger(
      requiredField(object, "maxOperations"),
      "effect maxOperations",
    ),
  });
}

function exactObject(
  value: JsonValue,
  keys: readonly string[],
  label: string,
): JsonObject {
  const object = objectValue(value, label);
  if (!same(Object.keys(object).sort(), [...keys].sort()))
    throw new Error(`${label} has an invalid shape`);
  return object;
}

function objectValue(value: JsonValue, label: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function entryList(value: JsonValue, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function referenceList<T extends string>(
  value: JsonValue,
  label: string,
  parse: (value: string) => T,
): readonly T[] {
  const values = entryList(value, label).map((entry) => {
    if (typeof entry !== "string")
      throw new Error(`${label} must contain strings`);
    return parse(entry);
  });
  if (!same(values, [...values].sort()))
    throw new Error(`${label} must be sorted and unique`);
  return Object.freeze(values);
}

function names(value: JsonValue, label: string): readonly string[] {
  const values = entryList(value, label).map((entry) => {
    if (typeof entry !== "string" || entry.length === 0)
      throw new Error(`${label} must contain nonempty strings`);
    return entry;
  });
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicate names`);
  return values;
}

function requiredField(object: JsonObject, field: string): JsonValue {
  const value = object[field];
  if (value === undefined) throw new Error(`missing ${field}`);
  return value;
}

function requiredString(
  object: JsonObject,
  field: string,
  label: string,
): string {
  const value = requiredField(object, field);
  if (typeof value !== "string")
    throw new Error(`${label} ${field} must be a string`);
  return value;
}

function schemaRef(value: string): SchemaRef {
  const parsed = parseSchemaRef(value);
  if (!isSchemaRef(parsed))
    throw new Error(`invalid schema reference ${value}`);
  return parsed;
}

function abstractionRef(value: string): AbstractionRef {
  const parsed = parseAbstractionRef(value);
  if (!isAbstractionRef(parsed))
    throw new Error(`invalid abstraction reference ${value}`);
  return parsed;
}

function manifestRef(value: string): CatalogueManifest["ref"] {
  const parsed = parseCatalogueManifestRef(value);
  if (!isCatalogueManifestRef(parsed))
    throw new Error(`invalid catalogue reference ${value}`);
  return parsed;
}

function graphRef(value: string) {
  const parsed = parseGraphRef(value);
  if (!isGraphRef(parsed)) throw new Error(`invalid graph reference ${value}`);
  return parsed;
}

function safeInteger(value: JsonValue, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`${label} must be a safe integer`);
  return value;
}

function nonnegativeSafeInteger(value: JsonValue, label: string): number {
  const number = safeInteger(value, label);
  if (number < 0) throw new Error(`${label} must be nonnegative`);
  return number;
}

function same<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
