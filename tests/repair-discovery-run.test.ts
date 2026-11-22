import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../src/codecs/canonical.ts";
import {
  executeRepairDiscovery,
  runRepairComparison,
} from "../src/experiments/repair-discovery-run.ts";
import { repairDiscoveryTasks } from "../src/fixtures/repair-discovery.ts";
import { centralWorkflowPrompt } from "../src/runtime/central-hypothesis-workflow.ts";
import { makeRestrictedPatch } from "../src/runtime/typescript-refactor-evaluator.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

type Behavior =
  | "good"
  | "bad"
  | "hidden-only"
  | "invalid"
  | "interrupt"
  | "over-budget"
  | "unknown";
async function scenario(
  behavior: (id: string) => Behavior,
  signal = new AbortController().signal,
) {
  const directory = mkdtempSync(join(tmpdir(), "repair-controller-test-"));
  const store = await SqliteRunStore.open(directory);
  const calls: { id: string; prompt: string }[] = [];
  const publications: unknown[] = [];
  try {
    const result = await executeRepairDiscovery({
      store,
      signal,
      manifestFingerprint: "test-manifest",
      gateway: () => ({
        complete: async (request) => {
          const index = Number(request.runId.split("/")[1]);
          const entry = repairDiscoveryTasks[index];
          if (!entry) throw new Error("unknown task");
          calls.push({ id: request.runId, prompt: request.prompt });
          const how = behavior(request.runId);
          if (how === "interrupt") throw new Error("lost connection");
          return {
            requestId: request.requestId,
            modelRef: request.modelRef,
            text:
              how === "invalid"
                ? "invalid JSON"
                : canonicalJson(
                    makeRestrictedPatch(
                      entry.task,
                      `// ${how}\n${entry.referenceSource}`,
                    ),
                  ),
            toolCalls: [],
            finish: "stop" as const,
            usage: {
              known: how !== "unknown",
              inputTokens:
                how === "unknown" ? null : how === "over-budget" ? 30_001 : 90,
              outputTokens: 10,
              totalTokens:
                how === "unknown" ? null : how === "over-budget" ? 30_011 : 100,
              cachedInputTokens: 20,
            },
            accounting: {
              executorAttempts: 1,
              modelCalls: 1,
              commandExecutions: 0,
              toolCalls: 0,
            },
          };
        },
      }),
      runner: {
        run: async (workspace) => {
          const source = readFileSync(join(workspace, "src/repair.ts"), "utf8");
          const hidden = existsSync(join(workspace, "test/hidden.test.ts"));
          const failed =
            source.startsWith("// bad") ||
            (hidden && source.startsWith("// hidden-only"));
          return {
            exitCode: failed ? 1 : 0,
            stdout: "",
            stderr: failed
              ? hidden
                ? "PRIVATE HIDDEN DIAGNOSTIC"
                : "PUBLIC ASSERTION"
              : "",
            timedOut: false,
          };
        },
      },
      persist: (value) => publications.push(JSON.parse(JSON.stringify(value))),
    });
    const attempts = calls.map((call) =>
      store.getProviderAttempt(`${call.id}/attempt/1`),
    );
    await store.close();
    const reopened = await SqliteRunStore.open(directory);
    try {
      for (const attempt of attempts) {
        if (attempt)
          expect(
            reopened.getProviderAttempt(attempt.attemptId)?.requestFingerprint,
          ).toBe(attempt.requestFingerprint);
      }
    } finally {
      await reopened.close();
    }
    return { result, calls, publications, attempts };
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("paired branches use public evidence only, preserve order, and charge shared prefixes once", async () => {
  const { result, calls, publications } = await scenario((id) =>
    id.endsWith("feedback") ? "good" : "bad",
  );
  expect(result.status).toBe("complete");
  expect(calls.map((c) => c.id)).toEqual([
    "repair-discovery/0/initial",
    "repair-discovery/1/initial",
    "repair-discovery/2/initial",
    "repair-discovery/0/feedback",
    "repair-discovery/0/fresh",
    "repair-discovery/1/fresh",
    "repair-discovery/1/feedback",
    "repair-discovery/2/feedback",
    "repair-discovery/2/fresh",
  ]);
  expect(result.actualKnownTotalTokens).toBe(900);
  expect(result.policies.feedback.totalTokens).toBe(600);
  expect(result.policies.fresh.totalTokens).toBe(600);
  expect(result.feedbackOnlyRecoveries).toBe(3);
  expect(result.policies.fresh.successes).toBe(0);
  for (const call of calls) {
    expect(call.prompt).not.toContain("PRIVATE HIDDEN DIAGNOSTIC");
    if (call.id.endsWith("feedback"))
      expect(call.prompt).toContain("PUBLIC ASSERTION");
    else {
      const entry = repairDiscoveryTasks[Number(call.id.split("/")[1])];
      if (!entry) throw new Error("task absent");
      expect(call.prompt).toBe(centralWorkflowPrompt(entry.task));
    }
  }
  const intents = JSON.stringify(publications);
  expect(intents).toContain(
    '"parentAttemptId":"repair-discovery/0/initial/attempt/1"',
  );
  expect(intents).toContain(
    '"publicEvaluationId":"repair-discovery/0/initial/attempt/1/public"',
  );
  expect(intents).toContain('"result":null');
});

test("public successes terminate both policies even when hidden scoring fails", async () => {
  const { result, calls } = await scenario((id) =>
    id.includes("/1/") ? "hidden-only" : "good",
  );
  expect(calls).toHaveLength(3);
  expect(result.publicFailures).toBe(0);
  expect(result.hiddenOnlyFailures).toBe(1);
  expect(result.decision).toBe("public-verifier-gap");
  expect(result.policies.feedback.successes).toBe(2);
  expect(result.policies.fresh.totalTokens).toBe(300);
});

test("second public failures terminate without a third attempt", async () => {
  const { result, calls } = await scenario(() => "bad");
  expect(calls).toHaveLength(9);
  expect(result.status).toBe("complete");
  expect(result.decision).toBe("no-feedback-benefit-observed");
});

test("malformed artifacts, unknown usage, ceilings and uncertain calls stop all further dispatch", async () => {
  for (const failure of [
    "invalid",
    "unknown",
    "over-budget",
    "interrupt",
  ] as const) {
    const { result, calls, attempts } = await scenario(() => failure);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("stopped");
    expect(result.decision).toBe("inconclusive");
    if (failure === "unknown" || failure === "interrupt")
      expect(result.unknownUsageAttempts).toBe(1);
    if (failure === "over-budget")
      expect(result.actualKnownTotalTokens).toBe(30_011);
    if (failure === "interrupt")
      expect(attempts[0]?.lifecycle).toBe("indeterminate");
  }
});

test("a failed branch stops its peer and pre-cancellation launches nothing", async () => {
  const { result, calls } = await scenario((id) =>
    id.endsWith("initial") ? "bad" : "invalid",
  );
  expect(calls).toHaveLength(4);
  expect(result.policies.fresh.totalTokens).toBeNull();
  expect(result.status).toBe("stopped");
  const stopped = await scenario(() => "good", AbortSignal.abort());
  expect(stopped.calls).toHaveLength(0);
  expect(stopped.result.status).toBe("stopped");
});

test("an unqualified live state is rejected before any manifest or provider attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "repair-unqualified-"));
  try {
    await expect(runRepairComparison(directory)).rejects.toThrow();
    expect(existsSync(join(directory, "manifest.json"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
