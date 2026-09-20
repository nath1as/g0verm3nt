import type { RunId } from "./ids.ts";
import type { RuntimeState } from "./runtime-state.ts";

export type StartRun = Readonly<{
  kind: "StartRun";
  runId: RunId;
  taskType: string;
}>;

export type SettleRun = Readonly<{
  kind: "SettleRun";
  runId: RunId;
}>;

export type RuntimeInput = StartRun | SettleRun;

export type RunStarted = Readonly<{
  kind: "RunStarted";
  runId: RunId;
  taskType: string;
}>;

export type RunSettled = Readonly<{
  kind: "RunSettled";
  runId: RunId;
}>;

export type DomainEvent = RunStarted | RunSettled;

export type DomainRejection =
  | Readonly<{ kind: "EmptyTaskType" }>
  | Readonly<{ kind: "RunAlreadyExists"; runId: RunId }>
  | Readonly<{ kind: "RunNotActive"; runId: RunId }>;

export type Decision = Readonly<{ events: readonly DomainEvent[] }>;

export function decide(
  state: RuntimeState,
  input: RuntimeInput,
): Decision | DomainRejection {
  switch (input.kind) {
    case "StartRun":
      if (input.taskType.trim().length === 0) return { kind: "EmptyTaskType" };
      if (state.runs.has(input.runId)) {
        return { kind: "RunAlreadyExists", runId: input.runId };
      }
      return {
        events: [
          { kind: "RunStarted", runId: input.runId, taskType: input.taskType },
        ],
      };
    case "SettleRun":
      if (!state.runs.has(input.runId)) {
        return { kind: "RunNotActive", runId: input.runId };
      }
      return { events: [{ kind: "RunSettled", runId: input.runId }] };
  }
}
