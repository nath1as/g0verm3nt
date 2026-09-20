import type { RunId } from "./ids.ts";

export type CoreRun = Readonly<{
  id: RunId;
  taskType: string;
  status: "running";
  revision: 0;
}>;

export type RuntimeState = Readonly<{
  runs: ReadonlyMap<RunId, CoreRun>;
}>;

export const emptyRuntimeState = (): RuntimeState => ({ runs: new Map() });

export function runtimeStateFromActiveRuns(
  activeRuns: Iterable<CoreRun>,
): RuntimeState {
  const runs = new Map<RunId, CoreRun>();
  for (const run of activeRuns) {
    if (runs.has(run.id))
      throw new Error(`duplicate active run in projection: ${run.id}`);
    runs.set(run.id, run);
  }
  return { runs };
}
