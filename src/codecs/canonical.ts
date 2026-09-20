import { createHash } from "node:crypto";
import type { JsonValue } from "../core/graph.ts";

declare const contentHashBrand: unique symbol;

export type ContentHash = string &
  Readonly<{ [contentHashBrand]: "ContentHash" }>;

/** Stable JSON for content-addressed M2 records. */
export function canonicalJson(value: JsonValue): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value))
        throw new Error("canonical JSON forbids non-finite numbers");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value))
        return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
      const object = value as Readonly<{ [key: string]: JsonValue }>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => {
          const entry = object[key];
          if (entry === undefined)
            throw new Error(
              `canonical JSON object changed during encoding: ${key}`,
            );
          return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
        })
        .join(",")}}`;
    }
  }
}

export function hashCanonicalJson(value: JsonValue): ContentHash {
  return createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex") as ContentHash;
}
