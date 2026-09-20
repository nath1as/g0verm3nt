import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "../src/core/model.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

describe("M2-C durable run ownership", () => {
  test("prevents a parent from settling before its owned child closes", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-owner-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createRun(run("parent", "parent-task", "2026-09-19T00:00:00.000Z"));
      expect(() =>
        store.createOwnedChildRun(
          "missing-parent",
          run("orphan", "child-task", "2026-09-19T00:00:00.500Z"),
        ),
      ).toThrow("does not exist");
      expect(store.getRun("orphan")).toBeNull();
      store.createOwnedChildRun(
        "parent",
        run("child-1", "child-task", "2026-09-19T00:00:01.000Z"),
      );
      store.createOwnedChildRun(
        "parent",
        run("child-2", "child-task", "2026-09-19T00:00:02.000Z"),
      );
      expect(store.listOwnedChildren("parent")).toEqual([
        {
          parentRunId: "parent",
          child: run("child-1", "child-task", "2026-09-19T00:00:01.000Z"),
          spawnOrder: 1,
        },
        {
          parentRunId: "parent",
          child: run("child-2", "child-task", "2026-09-19T00:00:02.000Z"),
          spawnOrder: 2,
        },
      ]);
      expect(() =>
        store.completeRun(
          "parent",
          "succeeded",
          "parent outcome",
          "2026-09-19T00:00:03.000Z",
        ),
      ).toThrow("has an active owned child");
      store.completeRun(
        "child-1",
        "succeeded",
        "child one outcome",
        "2026-09-19T00:00:04.000Z",
      );
      expect(() =>
        store.completeRun(
          "parent",
          "succeeded",
          "parent outcome",
          "2026-09-19T00:00:05.000Z",
        ),
      ).toThrow("has an active owned child");
      store.completeRun(
        "child-2",
        "cancelled",
        null,
        "2026-09-19T00:00:06.000Z",
      );
      store.observeOwnedChildOutcome(
        "parent",
        "child-2",
        "2026-09-19T00:00:06.500Z",
      );
      store.completeRun(
        "parent",
        "succeeded",
        "parent outcome",
        "2026-09-19T00:00:07.000Z",
      );
      expect(() =>
        store.createOwnedChildRun(
          "parent",
          run("late-child", "child-task", "2026-09-19T00:00:08.000Z"),
        ),
      ).toThrow("is not running");
      expect(store.getRun("late-child")).toBeNull();
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getRun("parent")?.run.status).toBe("succeeded");
      expect(
        reopened.listOwnedChildren("parent").map((item) => item.child.status),
      ).toEqual(["succeeded", "cancelled"]);
      expect(
        reopened.getRun("parent")?.events.map((event) => event.kind),
      ).toEqual([
        "RunRequested",
        "RunChildSpawned",
        "RunChildSpawned",
        "RunChildOutcomeObserved",
        "RunCompleted",
      ]);
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
  test("propagates the earliest unobserved non-success child at close", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-owner-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createRun(run("parent", "parent-task", "2026-09-19T00:00:00.000Z"));
      store.createOwnedChildRun(
        "parent",
        run("child-1", "child-task", "2026-09-19T00:00:01.000Z"),
      );
      store.createOwnedChildRun(
        "parent",
        run("child-2", "child-task", "2026-09-19T00:00:02.000Z"),
      );
      store.completeRun(
        "child-2",
        "failed",
        "second child failure",
        "2026-09-19T00:00:03.000Z",
      );
      store.completeRun(
        "child-1",
        "failed",
        "first child failure",
        "2026-09-19T00:00:04.000Z",
      );
      store.completeRun(
        "parent",
        "succeeded",
        "ignored parent outcome",
        "2026-09-19T00:00:05.000Z",
      );
      expect(store.getRun("parent")?.run).toEqual({
        ...run("parent", "parent-task", "2026-09-19T00:00:00.000Z"),
        status: "failed",
        completedAt: "2026-09-19T00:00:05.000Z",
        outcome: "owned child child-1 failed",
      });
      expect(
        store.getRun("parent")?.events.map((event) => ({
          kind: event.kind,
          payload: event.payload,
        })),
      ).toEqual([
        { kind: "RunRequested", payload: { taskType: "parent-task" } },
        { kind: "RunChildSpawned", payload: { childRunId: "child-1" } },
        { kind: "RunChildSpawned", payload: { childRunId: "child-2" } },
        {
          kind: "RunChildOutcomePropagated",
          payload: {
            childRunId: "child-1",
            status: "failed",
            spawnOrder: "1",
          },
        },
        {
          kind: "RunFailed",
          payload: {
            childRunId: "child-1",
            status: "failed",
            spawnOrder: "1",
            outcome: "owned child child-1 failed",
          },
        },
      ]);
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getRun("parent")?.run.status).toBe("failed");
      expect(reopened.listObservedOwnedChildOutcomes("parent")).toEqual([]);
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("permits a parent success after it durably observes a failed child", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-owner-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createRun(run("parent", "parent-task", "2026-09-19T00:00:00.000Z"));
      store.createOwnedChildRun(
        "parent",
        run("child", "child-task", "2026-09-19T00:00:01.000Z"),
      );
      expect(() =>
        store.observeOwnedChildOutcome(
          "parent",
          "child",
          "2026-09-19T00:00:02.000Z",
        ),
      ).toThrow("is still running");
      expect(() =>
        store.observeOwnedChildOutcome(
          "parent",
          "missing",
          "2026-09-19T00:00:02.000Z",
        ),
      ).toThrow("is not owned");
      store.completeRun(
        "child",
        "failed",
        "handled failure",
        "2026-09-19T00:00:03.000Z",
      );
      store.observeOwnedChildOutcome(
        "parent",
        "child",
        "2026-09-19T00:00:04.000Z",
      );
      expect(store.listObservedOwnedChildOutcomes("parent")).toEqual([
        {
          parentRunId: "parent",
          childRunId: "child",
          status: "failed",
          observedAt: "2026-09-19T00:00:04.000Z",
        },
      ]);
      expect(() =>
        store.observeOwnedChildOutcome(
          "parent",
          "child",
          "2026-09-19T00:00:05.000Z",
        ),
      ).toThrow("UNIQUE constraint failed");
      store.completeRun(
        "parent",
        "succeeded",
        "handled outcome",
        "2026-09-19T00:00:06.000Z",
      );
      expect(store.getRun("parent")?.run.status).toBe("succeeded");
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.listObservedOwnedChildOutcomes("parent")).toEqual([
        {
          parentRunId: "parent",
          childRunId: "child",
          status: "failed",
          observedAt: "2026-09-19T00:00:04.000Z",
        },
      ]);
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
  test("enforces fixed child-count and ownership-depth limits atomically", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-limits-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createRun(run("root", "root-task", "2026-09-19T00:00:00.000Z"));
      store.createOwnedChildRun(
        "root",
        run("sibling-1", "child-task", "2026-09-19T00:00:01.000Z"),
      );
      store.createOwnedChildRun(
        "root",
        run("sibling-2", "child-task", "2026-09-19T00:00:02.000Z"),
      );
      expect(() =>
        store.createOwnedChildRun(
          "root",
          run("sibling-3", "child-task", "2026-09-19T00:00:03.000Z"),
        ),
      ).toThrow("child limit");
      expect(store.getRun("sibling-3")).toBeNull();

      let parentId = "depth-root";
      store.createRun(run(parentId, "depth-task", "2026-09-19T00:01:00.000Z"));
      for (let depth = 1; depth <= 4; depth += 1) {
        const childId = `depth-${depth}`;
        store.createOwnedChildRun(
          parentId,
          run(childId, "depth-task", `2026-09-19T00:01:0${depth}.000Z`),
        );
        parentId = childId;
      }
      expect(() =>
        store.createOwnedChildRun(
          parentId,
          run("depth-5", "depth-task", "2026-09-19T00:01:05.000Z"),
        ),
      ).toThrow("ownership depth limit");
      expect(store.getRun("depth-5")).toBeNull();
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getRun("depth-4")?.run.status).toBe("running");
      expect(reopened.listOwnedChildren("root")).toHaveLength(2);
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  test("releases the ownership-tree permit while a parent waits", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "government-permit-"));
    try {
      const store = await SqliteRunStore.open(stateDirectory);
      store.createRun(run("parent", "parent-task", "2026-09-19T00:00:00.000Z"));
      store.createOwnedChildRun(
        "parent",
        run("child", "child-task", "2026-09-19T00:00:01.000Z"),
      );
      store.acquireRunnableOperationPermit(
        "parent",
        "parent-op",
        "2026-09-19T00:00:02.000Z",
      );
      expect(() =>
        store.acquireRunnableOperationPermit(
          "child",
          "child-op",
          "2026-09-19T00:00:03.000Z",
        ),
      ).toThrow("UNIQUE constraint failed");
      store.releaseRunnableOperationPermit(
        "parent",
        "parent-op",
        "2026-09-19T00:00:04.000Z",
      );
      store.acquireRunnableOperationPermit(
        "child",
        "child-op",
        "2026-09-19T00:00:05.000Z",
      );
      expect(store.getRunnableOperationPermit("parent")).toEqual({
        rootRunId: "parent",
        holderRunId: "child",
        operationId: "child-op",
        acquiredAt: "2026-09-19T00:00:05.000Z",
      });
      expect(() =>
        store.releaseRunnableOperationPermit(
          "parent",
          "child-op",
          "2026-09-19T00:00:06.000Z",
        ),
      ).toThrow("does not hold runnable operation permit");
      store.releaseRunnableOperationPermit(
        "child",
        "child-op",
        "2026-09-19T00:00:07.000Z",
      );
      expect(store.getRunnableOperationPermit("child")).toBeNull();
      await store.close();

      const reopened = await SqliteRunStore.open(stateDirectory);
      expect(reopened.getRunnableOperationPermit("parent")).toBeNull();
      await reopened.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
});

function run(id: string, taskType: string, createdAt: string): Run {
  return {
    id,
    taskType,
    status: "running",
    createdAt,
    completedAt: null,
    outcome: null,
  };
}
