import { expect, test } from "bun:test";
import { FakeTypedModelGateway } from "../../src/adapters/models/fake-typed.ts";

test("typed fake provider is deterministic and reports known usage", async () => {
  const gateway = new FakeTypedModelGateway("offline");
  const request = {
    requestId: "req-1",
    runId: "run-1",
    modelRef: "model/fake@1",
    prompt: "repair function",
    tools: [{ name: "read", description: "read a file" }],
  } as const;
  const first = await gateway.complete(request, new AbortController().signal);
  const second = await gateway.complete(request, new AbortController().signal);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    requestId: "req-1",
    modelRef: "model/fake@1",
    text: "offline: repair function",
    finish: "stop",
    toolCalls: [],
    usage: { known: true },
  });
});

test("typed fake provider honors cancellation before dispatch", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(
    new FakeTypedModelGateway().complete(
      { requestId: "r", runId: "run", modelRef: "fake", prompt: "x" },
      controller.signal,
    ),
  ).rejects.toThrow("cancelled");
});
