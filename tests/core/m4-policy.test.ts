import { expect, test } from "bun:test";
import {
  decideM4Promotion,
  m4PromotionPolicy,
  runM4Assessment,
  validateM4Observations,
} from "../../src/experiments/m4.ts";

const candidate = {
  ref: "m3/adaptive@1",
  comparatorRef: "m3/fixed@1",
  scope: "typescript-refactor",
  fallbackRef: "m3/fixed@1",
} as const;
const observations = [
  {
    taskRef: "t1",
    split: "held-out" as const,
    candidateRef: "m3/adaptive@1",
    outcome: "success" as const,
    costUnits: 1,
  },
  {
    taskRef: "t2",
    split: "held-out" as const,
    candidateRef: "m3/adaptive@1",
    outcome: "success" as const,
    costUnits: 1,
  },
  {
    taskRef: "t1",
    split: "held-out" as const,
    candidateRef: "m3/fixed@1",
    outcome: "failure" as const,
    costUnits: 1,
  },
  {
    taskRef: "t2",
    split: "held-out" as const,
    candidateRef: "m3/fixed@1",
    outcome: "failure" as const,
    costUnits: 1,
  },
];

test("M4 promotes only on held-out benefit", () => {
  expect(decideM4Promotion(candidate, observations)).toMatchObject({
    status: "promote",
    heldOutSamples: 2,
  });
});

test("M4 rejects leakage and cannot promote on unmatched tasks", () => {
  expect(() =>
    decideM4Promotion(candidate, [
      ...observations,
      {
        taskRef: "t1",
        candidateRef: candidate.ref,
        split: "discovery",
        outcome: "success",
        costUnits: 1,
      },
    ]),
  ).toThrow("task reused across splits");
  expect(
    decideM4Promotion(
      candidate,
      observations.map((o) => ({
        ...o,
        taskRef:
          o.candidateRef === candidate.comparatorRef
            ? `other-${o.taskRef}`
            : o.taskRef,
      })),
    ),
  ).toMatchObject({
    status: "inconclusive",
    reason: "held-out tasks are not matched",
  });
  const first = runM4Assessment("experiment", candidate, observations);
  const second = runM4Assessment("experiment", candidate, observations, {
    ...m4PromotionPolicy,
    maxCostMultiplier: 2,
  });
  expect(first.fingerprint).not.toBe(second.fingerprint);
});
test("M4 retains fixed configuration when held-out evidence is insufficient or weak", () => {
  expect(decideM4Promotion(candidate, observations.slice(0, 2))).toMatchObject({
    status: "inconclusive",
  });
  expect(
    decideM4Promotion(
      candidate,
      observations.map((o) => ({ ...o, outcome: "success" as const })),
    ),
  ).toMatchObject({ status: "retain-fixed" });
});
test("M4 rejects duplicate observations and invalid costs", () => {
  const first = observations[0];
  if (first === undefined) throw new Error("missing fixture observation");
  expect(validateM4Observations([first, first])).toContain(
    "duplicate observation: held-out:t1:m3/adaptive@1",
  );
  expect(() =>
    decideM4Promotion(candidate, [{ ...first, costUnits: -1 }]),
  ).toThrow("invalid cost");
  expect(m4PromotionPolicy.ref).toBe("m4/held-out-benefit-policy@1");
});

test("M4 assessment separates discovery and fingerprints a deterministic decision", () => {
  const assessment = runM4Assessment("m4/assessment@1", candidate, [
    {
      taskRef: "d1",
      split: "discovery",
      candidateRef: candidate.ref,
      outcome: "failure",
      costUnits: 2,
    },
    ...observations,
  ]);
  expect(assessment.discovery).toHaveLength(1);
  expect(assessment.heldOut).toHaveLength(4);
  expect(assessment.decision.status).toBe("promote");
  expect(assessment.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(
    runM4Assessment("m4/assessment@1", candidate, [
      ...observations,
      {
        taskRef: "d1",
        split: "discovery",
        candidateRef: candidate.ref,
        outcome: "failure",
        costUnits: 2,
      },
    ]).fingerprint,
  ).toBe(assessment.fingerprint);
});
