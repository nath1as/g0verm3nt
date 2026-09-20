import { expect, test } from "bun:test";
import {
  type DiscoveryCell,
  discoveryDecision,
} from "../src/experiments/central-hypothesis-run.ts";
import { centralTasks } from "../src/fixtures/central-hypothesis.ts";

function cells(): DiscoveryCell[] {
  return centralTasks
    .filter((entry) => entry.phase === "discovery")
    .flatMap((entry) =>
      (["direct", "feedback"] as const).map((workflow) => ({
        taskRef: entry.task.ref,
        ...entry.features,
        workflow,
        outcome: "verified",
        totalTokens: workflow === "direct" ? 100 : 200,
      })),
    );
}

test("discovery stops on a ceiling effect without pretending assessment ran", () => {
  expect(discoveryDecision(cells()).status).toBe("no-useful-tradeoff");
  expect(discoveryDecision([]).status).toBe("incomplete");
});

test("discovery requires complete paired known-cost evidence", () => {
  const observations = cells();
  const first = observations[0];
  if (!first) throw new Error("fixture missing");
  expect(
    discoveryDecision([
      { ...first, totalTokens: null },
      ...observations.slice(1),
    ]).status,
  ).toBe("inconclusive");
  expect(() =>
    discoveryDecision([first, first, ...observations.slice(2)]),
  ).toThrow("uniquely paired");
});

test("a heterogeneous discovery signal permits only candidate generation", () => {
  const observations = cells();
  const first = observations[0];
  if (!first) throw new Error("fixture missing");
  expect(
    discoveryDecision([
      { ...first, outcome: "failed" },
      ...observations.slice(1),
    ]).status,
  ).toBe("candidate-needed");
});
