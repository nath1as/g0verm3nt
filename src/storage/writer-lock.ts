import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lockCommand = "/usr/bin/flock";
const shellCommand = "/bin/sh";
const catCommand = "/usr/bin/cat";

export class WorkspaceWriterLock {
  readonly #process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  #closed = false;

  private constructor(
    readonly path: string,
    process: Bun.Subprocess<"pipe", "pipe", "pipe">,
  ) {
    this.#process = process;
  }

  static async acquire(stateDirectory: string): Promise<WorkspaceWriterLock> {
    mkdirSync(stateDirectory, { recursive: true });
    const path = join(stateDirectory, "runtime.lock");
    const child = Bun.spawn(
      [
        lockCommand,
        "--exclusive",
        "--nonblock",
        path,
        shellCommand,
        "-c",
        `printf acquired; exec ${catCommand}`,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    const ready = await readLockReady(child.stdout);

    if (ready !== "acquired") {
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      throw new Error(
        `workspace writer lock is held for ${stateDirectory}${formatLockFailure(exitCode, stderr)}`,
      );
    }

    try {
      writeFileSync(
        path,
        `${JSON.stringify({
          ownerPid: process.pid,
          lockProcessPid: child.pid,
          acquiredAt: new Date().toISOString(),
          protocol: "linux-flock-v1",
        })}
`,
        "utf8",
      );
      chmodSync(path, 0o600);
      return new WorkspaceWriterLock(path, child);
    } catch (error) {
      child.stdin.end();
      await child.exited;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#process.stdin.end();
    const exitCode = await this.#process.exited;
    if (exitCode !== 0)
      throw new Error(
        `workspace writer lock process exited unexpectedly with code ${exitCode}`,
      );
  }
}

function formatLockFailure(exitCode: number, stderr: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) return ` (flock exited with code ${exitCode})`;
  return ` (${detail})`;
}

async function readLockReady(
  stdout: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let marker = "";
  try {
    while (marker.length < "acquired".length) {
      const chunk = await reader.read();
      if (chunk.done || chunk.value === undefined) break;
      marker += decoder.decode(chunk.value, { stream: true });
    }
    return marker;
  } finally {
    reader.releaseLock();
  }
}
