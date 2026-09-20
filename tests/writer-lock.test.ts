import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

describe("workspace writer ownership", () => {
  test("rejects a competing process while the owner holds an OS lock", async () => {
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "government-writer-lock-"),
    );
    try {
      const owner = await SqliteRunStore.open(stateDirectory);
      const diagnostic = JSON.parse(
        readFileSync(join(stateDirectory, "runtime.lock"), "utf8"),
      ) as {
        ownerPid: number;
        lockProcessPid: number;
        protocol: string;
      };
      expect(diagnostic.ownerPid).toBe(process.pid);
      expect(diagnostic.lockProcessPid).toBeNumber();
      expect(diagnostic.protocol).toBe("linux-flock-v1");
      expect(statSync(join(stateDirectory, "runtime.lock")).mode & 0o777).toBe(
        0o600,
      );

      const contender = Bun.spawn(
        [
          process.execPath,
          "run",
          "src/cli/main.ts",
          "--state-dir",
          stateDirectory,
          "init",
          "--json",
        ],
        {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
          timeout: 5_000,
        },
      );
      const [exitCode, stderr] = await Promise.all([
        contender.exited,
        new Response(contender.stderr).text(),
      ]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("workspace writer lock is held");

      await owner.close();
      const successor = await SqliteRunStore.open(stateDirectory);
      await successor.close();
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
});
