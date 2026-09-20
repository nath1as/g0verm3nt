import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  IsolatedCommandResult,
  IsolatedCommandRunner,
} from "./typescript-refactor-evaluator.ts";

export const centralIsolationProfile = Object.freeze({
  ref: "central/linux-bwrap-bun@1",
  bubblewrapPath: "/usr/bin/bwrap",
  bunPath: "/usr/bin/bun",
  cpuSeconds: 5,
  memoryBytes: 1_073_741_824,
  maxProcesses: 64,
  maxWallTimeMs: 10_000,
  maxOutputBytes: 65_536,
  network: "disabled" as const,
  workspace: "read-only" as const,
  resourceScope: "per-process; nproc per user namespace" as const,
});

export function centralIsolationCommand(workspace: string): string[] {
  return [
    centralIsolationProfile.bubblewrapPath,
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    resolve(workspace),
    "/workspace",
    "--tmpfs",
    "/tmp",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--chdir",
    "/workspace",
    "/usr/bin/prlimit",
    `--as=${centralIsolationProfile.memoryBytes}:${centralIsolationProfile.memoryBytes}`,
    `--cpu=${centralIsolationProfile.cpuSeconds}:${centralIsolationProfile.cpuSeconds}`,
    `--nproc=${centralIsolationProfile.maxProcesses}:${centralIsolationProfile.maxProcesses}`,
    "--core=0:0",
    "--",
    centralIsolationProfile.bunPath,
    "test",
  ];
}

/** Limits apply after namespace setup. Killing bwrap tears down its PID namespace. */
export class CentralHypothesisRunner implements IsolatedCommandRunner {
  async run(workspace: string): Promise<IsolatedCommandResult> {
    const child = Bun.spawn(centralIsolationCommand(workspace), {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    let timedOut = false;
    let outputExceeded = false;
    let remaining = centralIsolationProfile.maxOutputBytes;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, centralIsolationProfile.maxWallTimeMs);
    const read = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const accepted = Math.min(remaining, part.value.byteLength);
          if (accepted > 0) chunks.push(part.value.slice(0, accepted));
          remaining -= accepted;
          if (accepted < part.value.byteLength && !outputExceeded) {
            outputExceeded = true;
            child.kill("SIGKILL");
          }
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      let text = bytes.toString("utf8");
      // A partial final UTF-8 sequence must not expand beyond the byte budget.
      while (Buffer.byteLength(text) > bytes.byteLength)
        text = text.slice(0, -1);
      return text;
    };
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        read(child.stdout),
        read(child.stderr),
      ]);
      if (exitCode !== 0 && /^(bwrap|prlimit):/m.test(stderr))
        throw new Error(
          `isolated evaluator setup failed: ${stderr.slice(0, 4096)}`,
        );
      return {
        exitCode: outputExceeded ? 137 : exitCode,
        stdout,
        stderr,
        timedOut,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type CentralIsolationQualification = Readonly<{
  qualified: boolean;
  profile: typeof centralIsolationProfile;
  checks: readonly Readonly<{
    name: string;
    passed: boolean;
    result: IsolatedCommandResult;
  }>[];
}>;

/** Real local probes, never simulated success. Does not contact a provider. */
export async function qualifyCentralIsolation(): Promise<CentralIsolationQualification> {
  const runner = new CentralHypothesisRunner();
  const checks: {
    name: string;
    passed: boolean;
    result: IsolatedCommandResult;
  }[] = [];
  const probes = [
    {
      name: "filesystem-network-resource-process",
      source: `
import { test, expect } from "bun:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
test("actual isolation", async () => {
  expect(existsSync("/etc/passwd")).toBe(false);
  expect(() => writeFileSync("/workspace/escape", "x")).toThrow();
  const routes = readFileSync("/proc/net/route", "utf8").trim().split("\\n");
  expect(routes.length).toBe(1);
  const limits = readFileSync("/proc/self/limits", "utf8");
  expect(limits).toMatch(/Max processes\\s+64\\s+64/);
  expect(limits).toMatch(/Max address space\\s+1073741824\\s+1073741824/);
  expect(limits).toMatch(/Max cpu time\\s+5\\s+5/);
  const children = [];
  let blocked = false;
  try {
    for (let i = 0; i < 80; i++) {
      try { children.push(Bun.spawn(["/bin/sleep", "2"], {stdout:"ignore", stderr:"ignore"})); }
      catch { blocked = true; break; }
    }
    expect(blocked).toBe(true);
    expect(children.length).toBeGreaterThan(0);
  } finally {
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(children.map(child => child.exited));
  }
});`,
      expected: "success",
    },
    {
      name: "bounded-output",
      source: `import { test } from "bun:test"; test("flood", () => { while (true) process.stdout.write("x".repeat(8192)); });`,
      expected: "output",
    },
    {
      name: "wall-time",
      source: `import { test } from "bun:test"; test("wait", async () => { await Bun.sleep(60000); }, 65000);`,
      expected: "timeout",
    },
  ];
  for (const probe of probes) {
    const workspace = mkdtempSync(join(tmpdir(), "central-isolation-"));
    try {
      writeFileSync(join(workspace, "probe.test.ts"), probe.source);
      let result: IsolatedCommandResult;
      try {
        result = await runner.run(workspace);
      } catch (error) {
        result = {
          exitCode: -1,
          stdout: "",
          stderr: String(error),
          timedOut: false,
        };
      }
      const bytes =
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
      const passed =
        probe.expected === "timeout"
          ? result.timedOut && result.exitCode !== 0
          : probe.expected === "success"
            ? result.exitCode === 0 && !result.timedOut
            : result.exitCode === 137 &&
              !result.timedOut &&
              bytes === centralIsolationProfile.maxOutputBytes;
      checks.push({ name: probe.name, passed, result });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
  return {
    qualified: checks.every((check) => check.passed),
    profile: centralIsolationProfile,
    checks,
  };
}
