/** Offline M4 policy and deterministic assessment runner. */
import { hashCanonicalJson } from "../codecs/canonical.ts";
export type M4Outcome = "success" | "failure";
export type M4Split = "discovery" | "held-out";

export type M4Observation = Readonly<{
  taskRef: string;
  split: M4Split;
  candidateRef: string;
  outcome: M4Outcome;
  costUnits: number;
}>;

export type M4Candidate = Readonly<{
  ref: string;
  comparatorRef: string;
  scope: string;
  fallbackRef: string;
}>;

export type M4PromotionPolicy = Readonly<{
  ref: string;
  minHeldOutSamples: number;
  minSuccessRateDelta: number;
  maxCostMultiplier: number;
}>;

export type M4PromotionDecision = Readonly<{
  candidateRef: string;
  comparatorRef: string;
  fallbackRef: string;
  status: "promote" | "retain-fixed" | "inconclusive";
  reason: string;
  heldOutSamples: number;
  candidateSuccessRate: number;
  comparatorSuccessRate: number;
  candidateCost: number;
  comparatorCost: number;
}>;

export type M4Assessment = Readonly<{
  manifestRef: string;
  candidate: M4Candidate;
  policy: M4PromotionPolicy;
  discovery: readonly M4Observation[];
  heldOut: readonly M4Observation[];
  decision: M4PromotionDecision;
  fingerprint: string;
}>;

export const m4PromotionPolicy: M4PromotionPolicy = Object.freeze({
  ref: "m4/held-out-benefit-policy@1",
  minHeldOutSamples: 2,
  minSuccessRateDelta: 0.1,
  maxCostMultiplier: 1.25,
});

export function validateM4Observations(
  observations: readonly M4Observation[],
): readonly string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const taskSplits = new Map<string, M4Split>();
  for (const observation of observations) {
    const previous = taskSplits.get(observation.taskRef);
    if (previous !== undefined && previous !== observation.split)
      errors.push(`task reused across splits: ${observation.taskRef}`);
    taskSplits.set(observation.taskRef, observation.split);
    const key = `${observation.split}:${observation.taskRef}:${observation.candidateRef}`;
    if (keys.has(key)) errors.push(`duplicate observation: ${key}`);
    keys.add(key);
    if (observation.taskRef.length === 0)
      errors.push("task references must be non-empty");
    if (observation.candidateRef.length === 0)
      errors.push("candidate references must be non-empty");
    if (!Number.isFinite(observation.costUnits) || observation.costUnits < 0)
      errors.push(`invalid cost for ${key}`);
  }
  return errors;
}

function rate(observations: readonly M4Observation[]): number {
  return observations.length === 0
    ? 0
    : observations.filter((observation) => observation.outcome === "success")
        .length / observations.length;
}

function cost(observations: readonly M4Observation[]): number {
  return observations.reduce(
    (sum, observation) => sum + observation.costUnits,
    0,
  );
}

export function decideM4Promotion(
  candidate: M4Candidate,
  observations: readonly M4Observation[],
  policy: M4PromotionPolicy = m4PromotionPolicy,
): M4PromotionDecision {
  const errors = validateM4Observations(observations);
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (candidate.ref === candidate.comparatorRef)
    throw new Error("candidate and comparator must differ");
  if (
    observations.some(
      (o) =>
        o.candidateRef !== candidate.ref &&
        o.candidateRef !== candidate.comparatorRef,
    )
  )
    throw new Error("observation belongs to an unrelated candidate");
  const heldOut = observations.filter(
    (observation) => observation.split === "held-out",
  );
  const candidateHeldOut = heldOut.filter(
    (observation) => observation.candidateRef === candidate.ref,
  );
  const comparatorHeldOut = heldOut.filter(
    (observation) => observation.candidateRef === candidate.comparatorRef,
  );
  const candidateRate = rate(candidateHeldOut);
  const comparatorRate = rate(comparatorHeldOut);
  const candidateCost = cost(candidateHeldOut);
  const comparatorCost = cost(comparatorHeldOut);
  const base = {
    candidateRef: candidate.ref,
    comparatorRef: candidate.comparatorRef,
    fallbackRef: candidate.fallbackRef,
    heldOutSamples: candidateHeldOut.length,
    candidateSuccessRate: candidateRate,
    comparatorSuccessRate: comparatorRate,
    candidateCost,
    comparatorCost,
  };
  const comparatorTasks = new Set(comparatorHeldOut.map((o) => o.taskRef));
  if (
    candidateHeldOut.length !== comparatorHeldOut.length ||
    candidateHeldOut.some((o) => !comparatorTasks.has(o.taskRef))
  )
    return Object.freeze({
      ...base,
      status: "inconclusive",
      reason: "held-out tasks are not matched",
    });
  if (
    candidateHeldOut.length < policy.minHeldOutSamples ||
    comparatorHeldOut.length < policy.minHeldOutSamples
  )
    return Object.freeze({
      ...base,
      status: "inconclusive",
      reason: "insufficient held-out evidence",
    });
  if (candidateRate - comparatorRate < policy.minSuccessRateDelta)
    return Object.freeze({
      ...base,
      status: "retain-fixed",
      reason: "held-out benefit threshold not met",
    });
  if (
    comparatorCost > 0 &&
    candidateCost > comparatorCost * policy.maxCostMultiplier
  )
    return Object.freeze({
      ...base,
      status: "retain-fixed",
      reason: "held-out cost threshold exceeded",
    });
  return Object.freeze({
    ...base,
    status: "promote",
    reason: "held-out benefit policy satisfied",
  });
}

/**
 * Assemble one immutable assessment artifact. Discovery is retained for
 * accounting and diagnosis, while the decision is calculated only from the
 * held-out cohort. The result is provider-independent and therefore suitable
 * for persistence as evidence after a real runner supplies observations.
 */
export function runM4Assessment(
  manifestRef: string,
  candidate: M4Candidate,
  observations: readonly M4Observation[],
  policy: M4PromotionPolicy = m4PromotionPolicy,
): M4Assessment {
  const errors = validateM4Observations(observations);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const discovery = Object.freeze(
    observations
      .filter((observation) => observation.split === "discovery")
      .slice()
      .sort(observationOrder),
  );
  const heldOut = Object.freeze(
    observations
      .filter((observation) => observation.split === "held-out")
      .slice()
      .sort(observationOrder),
  );
  const decision = decideM4Promotion(
    candidate,
    [...discovery, ...heldOut],
    policy,
  );
  const body = {
    manifestRef,
    candidate,
    policy,
    discovery,
    heldOut,
    decision,
  } as never;
  return Object.freeze({
    manifestRef,
    candidate,
    policy,
    discovery,
    heldOut,
    decision,
    fingerprint: hashCanonicalJson(body),
  });
}

function observationOrder(a: M4Observation, b: M4Observation): number {
  return `${a.taskRef}\u0000${a.candidateRef}`.localeCompare(
    `${b.taskRef}\u0000${b.candidateRef}`,
  );
}
