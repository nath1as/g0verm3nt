import { expect, test } from "bun:test";
import { centralTasks } from "../src/fixtures/central-hypothesis.ts";
import {
  evaluateTypescriptRefactorPatch,
  type IsolatedCommandRunner,
  makeRestrictedPatch,
} from "../src/runtime/typescript-refactor-evaluator.ts";

// Qualification executes repository-authored fixtures only. This runner is not
// the isolation profile used for untrusted provider artifacts in the experiment.
const qualificationRunner: IsolatedCommandRunner = {
  async run(workspace) {
    const child = Bun.spawn([process.execPath, "test"], {
      cwd: workspace,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, timedOut: false };
  },
};

test("central corpus separates phases and hidden files and covers declared features", () => {
  expect(centralTasks).toHaveLength(12);
  expect(new Set(centralTasks.map(({ task }) => task.ref)).size).toBe(12);
  for (const phase of ["discovery", "assessment", "reuse"] as const) {
    const tasks = centralTasks.filter((entry) => entry.phase === phase);
    expect(tasks).toHaveLength(4);
    expect(
      new Set(tasks.map(({ features }) => JSON.stringify(features))).size,
    ).toBe(4);
    for (const entry of tasks) {
      expect(entry.task.split).toBe(
        phase === "discovery" ? "development" : "held-out",
      );
      expect(
        Object.keys(entry.hiddenFiles).every(
          (path) => !(path in entry.task.files),
        ),
      ).toBe(true);
      expect(entry.task.prompt).not.toContain(entry.referenceSource);
      const source = entry.task.files[entry.task.sourcePath] ?? "";
      expect(source.includes('from "./helper.ts"')).toBe(
        entry.features.localImport,
      );
      expect((source.match(/export function /g) ?? []).length > 1).toBe(
        entry.features.multipleExports,
      );
    }
  }
});

for (const entry of centralTasks) {
  test(`qualifies ${entry.task.ref} against public and independent hidden tests`, async () => {
    const publicTask = entry.task;
    const hiddenTask = {
      ...entry.task,
      files: Object.fromEntries([
        ...Object.entries(entry.task.files).filter(
          ([path]) => !path.startsWith("test/"),
        ),
        ...Object.entries(entry.hiddenFiles),
      ]),
    };
    for (const task of [publicTask, hiddenTask]) {
      const reference = await evaluateTypescriptRefactorPatch(
        task,
        makeRestrictedPatch(task, entry.referenceSource),
        qualificationRunner,
      );
      expect(reference.outcome).toBe("verified");
      const buggy = await evaluateTypescriptRefactorPatch(
        task,
        makeRestrictedPatch(task, task.files[task.sourcePath] ?? ""),
        qualificationRunner,
      );
      expect(buggy.outcome).toBe("failed");
    }
  });
}
