import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { FakeModelGateway } from "../src/adapters/models/fake.ts";
import {
  isCommandId,
  isWorkspaceId,
  makeStartRunCommand,
  parseCommandId,
  parseWorkspaceId,
} from "../src/codecs/commands.ts";
import type { ModelGateway, Run } from "../src/core/model.ts";
import { GovernmentApplication } from "../src/runtime/application.ts";
import { type CommandReceipt, SqliteRunStore } from "../src/storage/sqlite.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("M0 fake run", () => {
  test("runs the selected Effect version under Bun", async () => {
    await expect(
      Effect.runPromise(Effect.succeed("effect-ready")),
    ).resolves.toBe("effect-ready");
  });

  test("opening the same state directory twice preserves the bootstrap state", async () => {
    const directory = temporaryDirectory();
    const first = await SqliteRunStore.open(directory);
    await first.close();

    const second = await SqliteRunStore.open(directory);
    expect(second.listRuns()).toEqual([]);
    await second.close();
  });

  test("persists an ordered successful outcome that a new store can inspect", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    const application = new GovernmentApplication(
      store,
      new FakeModelGateway(),
      fixedClock,
      () => "run-1",
    );

    const result = await application.run("fake-task");
    await store.close();

    const restartedStore = await SqliteRunStore.open(directory);
    const restored = restartedStore.getRun("run-1");
    await restartedStore.close();

    expect(result.run.status).toBe("succeeded");
    expect(restored?.run.outcome).toBe("fake:fake-task run:run-1");
    expect(restored?.events.map((event) => event.kind)).toEqual([
      "RunRequested",
      "OperationPlanned",
      "OperationObserved",
      "RunCompleted",
    ]);
  });

  test("cancellation wins over a pending fake model stream", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    const application = new GovernmentApplication(
      store,
      blockingModel,
      fixedClock,
      () => "run-2",
    );

    const running = application.run("fake-task");
    await Promise.resolve();
    application.cancel("run-2");
    const result = await running;
    await store.close();

    expect(result.run.status).toBe("cancelled");
    expect(result.events.map((event) => event.kind)).toEqual([
      "RunRequested",
      "OperationPlanned",
      "RunCancelled",
    ]);
  });

  test("returns the original receipt for an identical command after restart", async () => {
    const directory = temporaryDirectory();
    const firstStore = await SqliteRunStore.open(directory);
    const command = startCommand("command-1", "fake-task");
    const first = await new GovernmentApplication(
      firstStore,
      new FakeModelGateway(),
      fixedClock,
      () => "run-3",
    ).submitStartRun(command);
    await firstStore.close();

    const restartedStore = await SqliteRunStore.open(directory);
    const repeated = await new GovernmentApplication(
      restartedStore,
      failingModel,
      fixedClock,
      () => "should-not-run",
    ).submitStartRun(command);
    await restartedStore.close();

    expect(first.kind).toBe("accepted");
    expect(repeated).toMatchObject({
      kind: "duplicate",
      detail: { run: { id: "run-3", status: "succeeded" } },
    });
  });

  test("rejects a reused command ID with different payload content", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    const application = new GovernmentApplication(
      store,
      new FakeModelGateway(),
      fixedClock,
      () => "run-4",
    );

    await application.submitStartRun(startCommand("command-2", "first-task"));
    const conflict = await application.submitStartRun(
      startCommand("command-2", "second-task"),
    );
    await store.close();

    expect(conflict).toEqual({
      kind: "conflict",
      commandId: requiredCommandId("command-2"),
    });
  });

  test("rejects a command whose payload no longer matches its declared hash", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    const application = new GovernmentApplication(
      store,
      new FakeModelGateway(),
      fixedClock,
      () => "must-not-run",
    );
    const original = startCommand("command-3", "fake-task");

    const result = await application.submitStartRun({
      ...original,
      payload: { taskType: "modified-after-hashing" },
    });
    await store.close();

    expect(result).toEqual({
      kind: "invalid",
      error: { kind: "PayloadHashMismatch" },
    });
  });

  test("uses pure admission to reject an empty task before storing a receipt", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    const application = new GovernmentApplication(
      store,
      new FakeModelGateway(),
      fixedClock,
      () => "run-5",
    );

    const result = await application.submitStartRun(
      startCommand("command-4", " "),
    );
    const runs = application.runs();
    await store.close();

    expect(result).toEqual({
      kind: "rejected",
      error: { kind: "EmptyTaskType" },
    });
    expect(runs).toEqual([]);
  });

  test("rehydrates only active runs into the runtime projection", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    store.createRun({
      id: "active-1",
      taskType: "pending-task",
      status: "running",
      createdAt: fixedClock().toISOString(),
      completedAt: null,
      outcome: null,
    });

    const application = new GovernmentApplication(
      store,
      failingModel,
      fixedClock,
      () => "must-not-run",
    );
    await store.close();

    expect(
      [...application.runtimeState().runs.values()].map((run) => ({
        ...run,
        id: String(run.id),
      })),
    ).toEqual([
      {
        id: "active-1",
        taskType: "pending-task",
        status: "running",
        revision: 0,
      },
    ]);
  });

  test("serializes simultaneous retries so only the receipt owner dispatches", async () => {
    const directory = temporaryDirectory();
    const store = await SqliteRunStore.open(directory);
    let modelCalls = 0;
    const model: ModelGateway = {
      async *stream() {
        modelCalls += 1;
        yield "only-once";
      },
    };
    const application = new GovernmentApplication(
      store,
      model,
      fixedClock,
      () => "run-serial",
    );
    const command = startCommand("command-serial", "fake-task");

    const submissions = await Promise.all([
      application.submitStartRun(command),
      application.submitStartRun(command),
    ]);
    await store.close();

    expect(submissions.map((submission) => submission.kind).sort()).toEqual([
      "accepted",
      "duplicate",
    ]);
    expect(modelCalls).toBe(1);
  });

  test("does not advance the active projection or dispatch when the start transaction fails", async () => {
    const directory = temporaryDirectory();
    const store = failingReceiptStore(await SqliteRunStore.open(directory));
    let modelCalls = 0;
    const application = new GovernmentApplication(
      store,
      {
        async *stream() {
          modelCalls += 1;
          yield "unreachable";
        },
      },
      fixedClock,
      () => "run-failed-commit",
    );

    await expect(
      application.submitStartRun(startCommand("command-failed", "fake-task")),
    ).rejects.toThrow("injected receipt transaction failure");
    const state = application.runtimeState();
    const receipt = store.getCommandReceipt("command-failed");
    await store.close();

    expect(state.runs.size).toBe(0);
    expect(receipt).toBeNull();
    expect(modelCalls).toBe(0);
  });

  test("does not settle the active projection when terminal persistence fails", async () => {
    const directory = temporaryDirectory();
    const store = failingCompletionStore(await SqliteRunStore.open(directory));
    const application = new GovernmentApplication(
      store,
      new FakeModelGateway(),
      fixedClock,
      () => "run-failed-settlement",
    );

    await expect(application.run("fake-task")).rejects.toThrow(
      "injected completion transaction failure",
    );
    const state = application.runtimeState();
    await store.close();

    expect([...state.runs.keys()].map(String)).toEqual([
      "run-failed-settlement",
    ]);
  });
});

function failingReceiptStore(store: SqliteRunStore): SqliteRunStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === "createRunWithReceipt")
        return (_run: Run, _receipt: CommandReceipt): void => {
          throw new Error("injected receipt transaction failure");
        };
      return boundStoreMember(target, property);
    },
  });
}

function failingCompletionStore(store: SqliteRunStore): SqliteRunStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === "completeRun")
        return (
          _id: string,
          _status: Extract<Run["status"], "succeeded" | "cancelled">,
          _outcome: string | null,
          _completedAt: string,
        ): void => {
          throw new Error("injected completion transaction failure");
        };
      return boundStoreMember(target, property);
    },
  });
}

function boundStoreMember(
  target: SqliteRunStore,
  property: string | symbol,
): unknown {
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
}

const blockingModel: ModelGateway = {
  async *stream(_input, signal) {
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
    yield "unreachable";
  },
};

const failingModel: ModelGateway = {
  async *stream() {
    yield await Promise.reject(
      new Error("a duplicate command must not call the model"),
    );
  },
};

function fixedClock(): Date {
  return new Date("2026-09-19T12:00:00.000Z");
}

function temporaryDirectory(): string {
  const directory = join(import.meta.dir, ".tmp", crypto.randomUUID());
  mkdirSync(directory, { recursive: true });
  directories.push(directory);
  return directory;
}

function startCommand(commandId: string, taskType: string) {
  return makeStartRunCommand(
    requiredCommandId(commandId),
    requiredWorkspaceId("local"),
    taskType,
  );
}

function requiredCommandId(value: string) {
  const parsed = parseCommandId(value);
  if (!isCommandId(parsed))
    throw new Error(`invalid test command ID: ${value}`);
  return parsed;
}

function requiredWorkspaceId(value: string) {
  const parsed = parseWorkspaceId(value);
  if (!isWorkspaceId(parsed))
    throw new Error(`invalid test workspace ID: ${value}`);
  return parsed;
}
