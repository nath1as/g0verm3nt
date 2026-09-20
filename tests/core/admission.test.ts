import { describe, expect, test } from "bun:test";
import { type Decision, decide } from "../../src/core/decide.ts";
import { evolve } from "../../src/core/evolve.ts";
import { isRunId, parseRunId } from "../../src/core/ids.ts";
import { emptyRuntimeState } from "../../src/core/runtime-state.ts";

describe("M1 run admission", () => {
  test("rejects malformed identities before constructing a start input", () => {
    const parsed = parseRunId("run with spaces");

    expect(isRunId(parsed)).toBe(false);
    expect(parsed).toEqual({ kind: "InvalidRunId", value: "run with spaces" });
  });

  test("decides and evolves one start without mutating the original state", () => {
    const runId = requiredRunId("run-1");
    const empty = emptyRuntimeState();

    const decision = requireDecision(
      decide(empty, { kind: "StartRun", runId, taskType: "normalization" }),
    );
    const next = evolve(empty, decision.events[0] ?? failMissingEvent());

    expect(empty.runs.size).toBe(0);
    expect(next.runs.get(runId)).toEqual({
      id: runId,
      taskType: "normalization",
      status: "running",
      revision: 0,
    });
  });

  test("rejects an empty task and a duplicate run", () => {
    const runId = requiredRunId("run-2");
    const empty = emptyRuntimeState();
    const started = requireDecision(
      decide(empty, { kind: "StartRun", runId, taskType: "normalization" }),
    );
    const state = evolve(empty, started.events[0] ?? failMissingEvent());

    expect(decide(empty, { kind: "StartRun", runId, taskType: "  " })).toEqual({
      kind: "EmptyTaskType",
    });
    expect(
      decide(state, { kind: "StartRun", runId, taskType: "normalization" }),
    ).toEqual({
      kind: "RunAlreadyExists",
      runId,
    });
  });

  test("removes a settled run from the active projection without mutating it", () => {
    const runId = requiredRunId("run-3");
    const started = requireDecision(
      decide(emptyRuntimeState(), {
        kind: "StartRun",
        runId,
        taskType: "normalization",
      }),
    );
    const active = evolve(
      emptyRuntimeState(),
      started.events[0] ?? failMissingEvent(),
    );
    const settled = requireDecision(
      decide(active, { kind: "SettleRun", runId }),
    );
    const next = evolve(active, settled.events[0] ?? failMissingEvent());

    expect(active.runs.has(runId)).toBe(true);
    expect(next.runs.has(runId)).toBe(false);
    expect(decide(next, { kind: "SettleRun", runId })).toEqual({
      kind: "RunNotActive",
      runId,
    });
  });
});

function requiredRunId(value: string) {
  const parsed = parseRunId(value);
  if (!isRunId(parsed)) throw new Error(`invalid test run ID: ${value}`);
  return parsed;
}

function requireDecision(value: ReturnType<typeof decide>): Decision {
  if (!("events" in value))
    throw new Error(`unexpected rejection: ${value.kind}`);
  return value;
}

function failMissingEvent(): never {
  throw new Error("expected start event");
}
