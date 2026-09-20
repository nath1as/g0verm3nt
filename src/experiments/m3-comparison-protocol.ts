import { hashCanonicalJson } from "../codecs/canonical.ts";

export type M3ComparisonCell = Readonly<{
  taskRef: string;
  sourceFingerprint: string;
  split: "development" | "held-out";
  variantRef: string;
}>;

export type M3ComparisonProtocol = Readonly<{
  ref: string;
  experimentRef: string;
  modelRef: string;
  executorRef: string;
  configurationFingerprint: string;
  evaluatorRef: string;
  evaluatorFingerprint: string;
  profileRef: string;
  repetitions: 1;
  requireKnownUsage: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxObservedCommands: number;
  maxObservedTools: number;
  baselineVariantRef: string;
  candidateVariantRef: string;
  cells: readonly M3ComparisonCell[];
}>;

export type M3ComparisonObservation = Readonly<{
  taskRef: string;
  sourceFingerprint: string;
  split: "development" | "held-out";
  variantRef: string;
  modelRef: string;
  executorRef: string;
  configurationFingerprint: string;
  evaluatorRef: string;
  evaluatorFingerprint: string;
  profileRef: string;
  outcome: "success" | "failure";
  usage: Readonly<{
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    known: boolean;
  }>;
  commandExecutions: number;
  toolCalls: number;
}>;

export type M3ComparisonReport = Readonly<{
  protocolRef: string;
  protocolFingerprint: string;
  observations: readonly M3ComparisonObservation[];
  pairedDevelopment: number;
  pairedHeldOut: number;
  fingerprint: string;
}>;

function cellKey(
  cell: Pick<M3ComparisonCell, "taskRef" | "variantRef">,
): string {
  return `${cell.taskRef}\u0000${cell.variantRef}`;
}

function taskKey(
  cell: Pick<M3ComparisonCell, "taskRef" | "sourceFingerprint" | "split">,
): string {
  return `${cell.taskRef}\u0000${cell.sourceFingerprint}\u0000${cell.split}`;
}

export function comparisonProtocolFingerprint(
  protocol: M3ComparisonProtocol,
): string {
  return hashCanonicalJson(protocol);
}

export function validateM3ComparisonProtocol(
  protocol: M3ComparisonProtocol,
): readonly string[] {
  const errors: string[] = [];
  if (!protocol.ref || !protocol.experimentRef)
    errors.push("protocol references are required");
  if (protocol.baselineVariantRef === protocol.candidateVariantRef)
    errors.push("baseline and candidate variants must differ");
  if (protocol.cells.length === 0) errors.push("comparison schedule is empty");
  const cells = new Set<string>();
  for (const cell of protocol.cells) {
    const key = cellKey(cell);
    if (cells.has(key)) errors.push(`duplicate comparison cell: ${key}`);
    cells.add(key);
    if (
      cell.variantRef !== protocol.baselineVariantRef &&
      cell.variantRef !== protocol.candidateVariantRef
    )
      errors.push(`unrelated comparison variant: ${cell.variantRef}`);
  }
  for (const task of new Set(protocol.cells.map(taskKey))) {
    const variants = protocol.cells
      .filter((cell) => taskKey(cell) === task)
      .map((cell) => cell.variantRef);
    if (
      !variants.includes(protocol.baselineVariantRef) ||
      !variants.includes(protocol.candidateVariantRef)
    )
      errors.push(`unmatched comparison task: ${task}`);
  }
  for (const limit of [
    protocol.maxInputTokens,
    protocol.maxOutputTokens,
    protocol.maxObservedCommands,
    protocol.maxObservedTools,
  ])
    if (!Number.isSafeInteger(limit) || limit < 0)
      errors.push("comparison budget must be a non-negative safe integer");
  return errors;
}

function observationError(
  protocol: M3ComparisonProtocol,
  observation: M3ComparisonObservation,
): string | null {
  if (observation.modelRef !== protocol.modelRef)
    return "model reference differs";
  if (observation.executorRef !== protocol.executorRef)
    return "executor reference differs";
  if (
    observation.configurationFingerprint !== protocol.configurationFingerprint
  )
    return "configuration fingerprint differs";
  if (observation.evaluatorRef !== protocol.evaluatorRef)
    return "evaluator reference differs";
  if (observation.evaluatorFingerprint !== protocol.evaluatorFingerprint)
    return "evaluator fingerprint differs";
  if (observation.profileRef !== protocol.profileRef)
    return "profile reference differs";
  if (
    protocol.requireKnownUsage &&
    (!observation.usage.known ||
      observation.usage.inputTokens === null ||
      observation.usage.outputTokens === null)
  )
    return "known usage is required";
  if (
    observation.usage.inputTokens !== null &&
    observation.usage.inputTokens > protocol.maxInputTokens
  )
    return "input-token budget exceeded";
  if (
    observation.usage.outputTokens !== null &&
    observation.usage.outputTokens > protocol.maxOutputTokens
  )
    return "output-token budget exceeded";
  if (observation.commandExecutions > protocol.maxObservedCommands)
    return "command budget exceeded";
  if (observation.toolCalls > protocol.maxObservedTools)
    return "tool budget exceeded";
  return null;
}

/** Fail closed unless every frozen task × variant cell has exactly one record. */
export function assembleM3ComparisonReport(
  protocol: M3ComparisonProtocol,
  observations: readonly M3ComparisonObservation[],
): M3ComparisonReport {
  const protocolErrors = validateM3ComparisonProtocol(protocol);
  if (protocolErrors.length > 0) throw new Error(protocolErrors.join("; "));
  const scheduled = new Map(
    protocol.cells.map((cell) => [cellKey(cell), cell]),
  );
  const observed = new Map<string, M3ComparisonObservation>();
  for (const observation of observations) {
    const key = cellKey(observation);
    const cell = scheduled.get(key);
    if (cell === undefined)
      throw new Error(`observation is not scheduled: ${key}`);
    if (
      cell.sourceFingerprint !== observation.sourceFingerprint ||
      cell.split !== observation.split
    )
      throw new Error(`observation lineage differs: ${key}`);
    if (observed.has(key)) throw new Error(`duplicate observation: ${key}`);
    const error = observationError(protocol, observation);
    if (error !== null) throw new Error(`${error}: ${key}`);
    observed.set(key, observation);
  }
  if (observed.size !== scheduled.size)
    throw new Error("comparison has unobserved scheduled cells");
  const ordered = Object.freeze(
    [...observed.values()].sort((left, right) =>
      cellKey(left).localeCompare(cellKey(right)),
    ),
  );
  const paired = (split: M3ComparisonCell["split"]) =>
    new Set(protocol.cells.filter((cell) => cell.split === split).map(taskKey))
      .size;
  const body = {
    protocolFingerprint: comparisonProtocolFingerprint(protocol),
    observations: ordered,
  };
  return Object.freeze({
    protocolRef: protocol.ref,
    protocolFingerprint: comparisonProtocolFingerprint(protocol),
    observations: ordered,
    pairedDevelopment: paired("development"),
    pairedHeldOut: paired("held-out"),
    fingerprint: hashCanonicalJson(body),
  });
}
