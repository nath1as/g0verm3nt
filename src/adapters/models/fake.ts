import type { ModelGateway } from "../../core/model.ts";

export class FakeModelGateway implements ModelGateway {
  async *stream(
    input: Readonly<{ runId: string; taskType: string }>,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    for (const chunk of [`fake:${input.taskType}`, `run:${input.runId}`]) {
      await delay(5, signal);
      yield chunk;
    }
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
