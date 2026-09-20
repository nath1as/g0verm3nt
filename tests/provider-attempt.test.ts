import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeTypedModelGateway } from "../src/adapters/models/fake-typed.ts";
import type { TypedModelGateway } from "../src/adapters/models/typed.ts";
import { executeDurableProviderAttempt } from "../src/runtime/provider-attempt.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "government-provider-attempt-"));
  directories.push(value);
  return value;
}

function request(runId: string) {
  return {
    requestId: `${runId}/request/1`,
    runId,
    modelRef: "model/fake@1",
    prompt: "repair the isolated fixture",
  } as const;
}

function createRunningRun(store: SqliteRunStore, runId: string): void {
  store.createRun({
    id: runId,
    taskType: "provider-fixture",
    status: "running",
    createdAt: "2026-09-20T00:00:00.000Z",
    completedAt: null,
    outcome: null,
  });
}

test("durable provider attempt persists intent, terminal response, and usage", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    createRunningRun(store, "provider-run-1");
    let tick = 0;
    const response = await executeDurableProviderAttempt(
      store,
      new FakeTypedModelGateway("fixture"),
      {
        attemptId: "provider-attempt-1",
        runId: "provider-run-1",
        executorRef: "fake-typed@1",
        configurationFingerprint: "fake-config@1",
        request: request("provider-run-1"),
        occurredAt: () => `2026-09-20T00:00:0${tick++}.000Z`,
      },
      new AbortController().signal,
    );
    const attempt = store.getProviderAttempt("provider-attempt-1");
    expect(response.text).toContain("fixture");
    expect(attempt).toMatchObject({
      lifecycle: "completed",
      executorRef: "fake-typed@1",
      requestId: "provider-run-1/request/1",
      terminal: {
        usage: { cachedInputTokens: 0, known: true },
        accounting: { modelCalls: 1 },
      },
    });
    expect(
      store.getRun("provider-run-1")?.events.map((event) => event.kind),
    ).toEqual([
      "RunRequested",
      "ProviderAttemptPlanned",
      "ProviderAttemptDispatched",
      "ProviderAttemptCompleted",
    ]);
  } finally {
    await store.close();
  }
});

test("a failed provider completion remains indeterminate and cannot be replayed", async () => {
  const store = await SqliteRunStore.open(directory());
  try {
    createRunningRun(store, "provider-run-2");
    let calls = 0;
    const failingGateway: TypedModelGateway = {
      complete: async () => {
        calls += 1;
        throw new Error("connection lost after dispatch");
      },
    };
    const input = {
      attemptId: "provider-attempt-2",
      runId: "provider-run-2",
      executorRef: "fixture-executor@1",
      configurationFingerprint: "fixture-config@1",
      request: request("provider-run-2"),
      occurredAt: () => "2026-09-20T00:00:00.000Z",
    } as const;
    await expect(
      executeDurableProviderAttempt(
        store,
        failingGateway,
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow("connection lost after dispatch");
    expect(store.getProviderAttempt(input.attemptId)).toMatchObject({
      lifecycle: "indeterminate",
      failure: "connection lost after dispatch",
    });
    await expect(
      executeDurableProviderAttempt(
        store,
        failingGateway,
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    await store.close();
  }
});

test("recovery marks dispatched provider attempts indeterminate without invoking a gateway", async () => {
  const stateDirectory = directory();
  const first = await SqliteRunStore.open(stateDirectory);
  createRunningRun(first, "provider-run-3");
  first.createProviderAttempt({
    attemptId: "provider-attempt-3",
    runId: "provider-run-3",
    executorRef: "fixture-executor@1",
    requestId: "provider-run-3/request/1",
    modelRef: "model/fake@1",
    requestFingerprint: "request@1",
    configurationFingerprint: "config@1",
    createdAt: "2026-09-20T00:00:00.000Z",
  });
  first.markProviderAttemptDispatched(
    "provider-attempt-3",
    "2026-09-20T00:00:01.000Z",
  );
  await first.close();

  const restarted = await SqliteRunStore.open(stateDirectory);
  try {
    expect(
      restarted.reconcileProviderAttempts("2026-09-20T00:00:02.000Z"),
    ).toMatchObject([
      {
        attemptId: "provider-attempt-3",
        lifecycle: "indeterminate",
        failure:
          "provider attempt was interrupted before a durable terminal observation",
      },
    ]);
    expect(
      restarted.reconcileProviderAttempts("2026-09-20T00:00:03.000Z"),
    ).toEqual([]);
  } finally {
    await restarted.close();
  }
});
