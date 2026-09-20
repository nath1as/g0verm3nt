declare const runIdBrand: unique symbol;

export type RunId = string & Readonly<{ [runIdBrand]: "RunId" }>;

export type IdParseError = Readonly<{
  kind: "InvalidRunId";
  value: string;
}>;

export function parseRunId(value: string): RunId | IdParseError {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)
    ? (value as RunId)
    : { kind: "InvalidRunId", value };
}

export function isRunId(value: string | IdParseError): value is RunId {
  return typeof value === "string";
}
