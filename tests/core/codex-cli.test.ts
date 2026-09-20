import { expect, test } from "bun:test";
import {
  CodexCliGateway,
  type CodexCliProcess,
} from "../../src/adapters/models/codex-cli.ts";

const encoder = new TextEncoder();

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function processFixture(
  stdout: string,
  options: Readonly<{
    stderr?: string;
    exitCode?: number;
    exited?: Promise<number>;
    onKill?: () => void;
  }> = {},
): CodexCliProcess {
  return {
    stdout: textStream(stdout),
    stderr: textStream(options.stderr ?? ""),
    exited: options.exited ?? Promise.resolve(options.exitCode ?? 0),
    kill: () => options.onKill?.(),
  };
}

const request = {
  requestId: "request-1",
  runId: "run-1",
  modelRef: "gpt-6-astra",
  prompt: "inspect this fixture",
} as const;

test("Codex CLI gateway parses complete JSONL and retains observed accounting", async () => {
  const calls: string[][] = [];
  const gateway = new CodexCliGateway({
    workingDirectory: "/tmp/government-codex-fixture",
    spawn: (command, options) => {
      calls.push([...command]);
      expect(options).toEqual({
        cwd: "/tmp/government-codex-fixture",
        stdout: "pipe",
        stderr: "pipe",
      });
      return processFixture(
        [
          '{"type":"item.completed","item":{"id":"command-1","type":"command_execution","command":"pwd"}}',
          '{"type":"item.completed","item":{"id":"command-1","type":"command_execution","command":"pwd"}}',
          '{"type":"item.completed","item":{"id":"tool-1","type":"mcp_tool_call","name":"workspace.read"}}',
          '{"type":"item.completed","item":{"id":"tool-2","type":"web_search"}}',
          '{"type":"item.completed","item":{"id":"message-1","type":"agent_message","text":"first"}}',
          '{"type":"turn.completed","usage":{"input_tokens":3,"cached_input_tokens":2,"output_tokens":5}}',
          '{"type":"item.completed","item":{"id":"message-2","type":"agent_message","text":"second"}}',
          '{"type":"turn.completed","usage":{"input_tokens":7,"cached_input_tokens":4,"output_tokens":11}}',
        ].join("\n"),
      );
    },
  });

  const response = await gateway.complete(
    request,
    new AbortController().signal,
  );

  expect(calls).toEqual([
    [
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "-m",
      "gpt-6-astra",
      "inspect this fixture",
    ],
  ]);
  expect(response.text).toBe("second");
  expect(response.usage).toEqual({
    inputTokens: 10,
    cachedInputTokens: 6,
    outputTokens: 16,
    totalTokens: 26,
    known: true,
  });
  expect(response.accounting).toEqual({
    executorAttempts: 1,
    modelCalls: null,
    commandExecutions: 1,
    toolCalls: 2,
  });
  expect(response.toolCalls.map((call) => call.name)).toEqual([
    "workspace.read",
    "web_search",
  ]);
  expect(response.rawArtifact?.truncated).toBe(false);
});

test("Codex CLI gateway pins explicitly requested reasoning effort", async () => {
  for (const reasoningEffort of ["low", "medium", "high"] as const) {
    const calls: string[][] = [];
    const gateway = new CodexCliGateway({
      workingDirectory: "/tmp/government-codex-fixture",
      reasoningEffort,
      spawn: (command) => {
        calls.push([...command]);
        return processFixture('{"type":"turn.completed"}');
      },
    });
    await gateway.complete(request, new AbortController().signal);
    expect(calls).toEqual([
      [
        "codex",
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-m",
        "gpt-6-astra",
        "-c",
        `model_reasoning_effort="${reasoningEffort}"`,
        "inspect this fixture",
      ],
    ]);
  }
});

test("Codex CLI gateway rejects malformed, failed, and incomplete event streams", async () => {
  const fixtures = [
    { stdout: "not json", error: "invalid Codex JSONL event at line 1" },
    {
      stdout: '{"type":"turn.failed","error":{"message":"quota exhausted"}}',
      error: "quota exhausted",
    },
    {
      stdout:
        '{"type":"item.completed","item":{"type":"agent_message","text":"missing"}}',
      error: "without turn.completed",
    },
  ];
  for (const fixture of fixtures) {
    const gateway = new CodexCliGateway({
      workingDirectory: "/tmp/government-codex-fixture",
      spawn: () => processFixture(fixture.stdout),
    });
    await expect(
      gateway.complete(request, new AbortController().signal),
    ).rejects.toThrow(fixture.error);
  }
});

test("Codex CLI gateway keeps partial usage unknown and bounds raw artifacts", async () => {
  const gateway = new CodexCliGateway({
    workingDirectory: "/tmp/government-codex-fixture",
    maxArtifactChars: 8,
    spawn: () =>
      processFixture(
        '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":5}}',
      ),
  });
  const response = await gateway.complete(
    request,
    new AbortController().signal,
  );
  expect(response.usage).toEqual({
    inputTokens: 3,
    cachedInputTokens: null,
    outputTokens: 5,
    totalTokens: 8,
    known: false,
  });
  expect(response.rawArtifact).toMatchObject({
    format: "codex-cli-jsonl@1",
    truncated: true,
  });
});

test("Codex CLI gateway does not spawn when already cancelled", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled before dispatch"));
  let spawned = false;
  const gateway = new CodexCliGateway({
    workingDirectory: "/tmp/government-codex-fixture",
    spawn: () => {
      spawned = true;
      return processFixture("");
    },
  });
  await expect(gateway.complete(request, controller.signal)).rejects.toThrow(
    "cancelled before dispatch",
  );
  expect(spawned).toBe(false);
});

test("Codex CLI gateway kills and drains a cancelled or timed-out process", async () => {
  for (const mode of ["cancel", "timeout"] as const) {
    const completed = Promise.withResolvers<number>();
    let kills = 0;
    const gateway = new CodexCliGateway({
      workingDirectory: "/tmp/government-codex-fixture",
      timeoutMs: mode === "timeout" ? 1 : 1_000,
      spawn: () =>
        processFixture("", {
          exited: completed.promise,
          onKill: () => {
            kills += 1;
            completed.resolve(143);
          },
        }),
    });
    const controller = new AbortController();
    const completion = gateway.complete(request, controller.signal);
    if (mode === "cancel")
      controller.abort(new Error("cancelled while running"));
    await expect(completion).rejects.toThrow(
      mode === "cancel" ? "cancelled while running" : "timed out after 1ms",
    );
    expect(kills).toBe(1);
  }
});
