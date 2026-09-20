import type { CentralTask } from "./central-hypothesis.ts";
import { lunaLogicTasks } from "./luna-logic-tasks.ts";
import { lunaStateTasks } from "./luna-state-tasks.ts";

type Replacement = readonly [before: string, after: string];

function revised(
  entry: CentralTask,
  name: string,
  mutations: readonly Replacement[],
): CentralTask {
  const original = entry.task.files[entry.task.sourcePath];
  if (original === undefined) throw new Error(`missing source: ${name}`);
  let source = original;
  for (const [before, after] of mutations) {
    if (!source.includes(before))
      throw new Error(`missing v2 mutation boundary: ${name}`);
    source = source.replace(before, after);
  }
  return Object.freeze({
    ...entry,
    task: Object.freeze({
      ...entry.task,
      ref: `luna-v2/${name}@1`,
      prompt: `${entry.task.prompt}\nThis revision contains several interacting defects; preserve every stated invariant, including edge cases not demonstrated by the public tests.`,
      files: Object.freeze({
        ...entry.task.files,
        [entry.task.sourcePath]: source,
      }),
    }),
  });
}

const parser = lunaLogicTasks[0];
const queue = lunaLogicTasks[1];
const merge = lunaLogicTasks[2];
const cache = lunaStateTasks[0];
const replay = lunaStateTasks[1];
const allocator = lunaStateTasks[2];
if (!parser || !queue || !merge || !cache || !replay || !allocator)
  throw new Error("v2 calibration requires the original six tasks");

/**
 * A new development-only cohort. It preserves contracts, but adds independent
 * defects outside the old public examples so outcomes cannot be reused.
 */
export const lunaCalibrationV2Tasks: readonly CentralTask[] = Object.freeze([
  revised(parser, "streaming-records", [
    [
      'if (char === "\\r" || char === "\\n") {',
      'if (char === "\\r" || char === "\\n") {\n        this.field = "";',
    ],
    [
      'if (this.mode === "closed") this.fail();',
      'if (this.mode === "closed" && this.field.length > 0) this.fail();',
    ],
  ]),
  revised(queue, "async-work-queue", [
    [
      'signal?.addEventListener("abort", cancel, { once: true });',
      "// Abort listener intentionally omitted.",
    ],
    ["active -= 1;\n      pump();", "active -= 1;\n      if (ok) pump();"],
  ]),
  revised(merge, "layered-config", [
    ["const copy: Config = {};", "const copy: Config = Object.create(null);"],
    [
      'return value !== null && typeof value === "object" && !Array.isArray(value);',
      'return value !== null && typeof value === "object";',
    ],
  ]),
  revised(cache, "lru-ttl", [
    [
      "return [...this.entries.keys()];",
      "return [...this.entries.keys()].reverse();",
    ],
    [
      "return this.entries.delete(key);",
      "this.entries.delete(key);\n    return true;",
    ],
  ]),
  revised(replay, "event-replay", [
    ["return this.cursor;", "return this.events.size;"],
    [
      "balances: [...this.balances].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),",
      "balances: [...this.balances],",
    ],
  ]),
  revised(allocator, "interval-allocator", [
    ["return total;", "return Math.max(0, total - 1);"],
    ["this.reservations.clear();", "// clear is a no-op."],
  ]),
]);
