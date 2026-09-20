import type { DomainEvent } from "./decide.ts";
import type { RuntimeState } from "./runtime-state.ts";

export function evolve(state: RuntimeState, event: DomainEvent): RuntimeState {
  switch (event.kind) {
    case "RunStarted": {
      const runs = new Map(state.runs);
      runs.set(event.runId, {
        id: event.runId,
        taskType: event.taskType,
        status: "running",
        revision: 0,
      });
      return { runs };
    }
    case "RunSettled": {
      const runs = new Map(state.runs);
      runs.delete(event.runId);
      return { runs };
    }
  }
}
