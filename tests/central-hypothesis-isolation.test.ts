import { expect, test } from "bun:test";
import {
  centralIsolationCommand,
  centralIsolationProfile,
  qualifyCentralIsolation,
} from "../src/runtime/central-hypothesis-isolation.ts";

test("central resource bounds apply inside the isolated namespace", () => {
  const command = centralIsolationCommand("/tmp/central-fixture");
  expect(command[0]).toBe("/usr/bin/bwrap");
  expect(command).toContain("--unshare-all");
  expect(command).toContain("--disable-userns");
  expect(command.indexOf("/usr/bin/prlimit")).toBeGreaterThan(
    command.indexOf("--chdir"),
  );
  expect(command).toContain("--nproc=64:64");
  expect(command.slice(-2)).toEqual(["/usr/bin/bun", "test"]);
  expect(centralIsolationProfile.maxOutputBytes).toBe(65536);
});

test.skipIf(process.env.CENTRAL_ISOLATION_INTEGRATION !== "1")(
  "central sandbox passes actual host isolation and termination probes",
  async () => {
    const report = await qualifyCentralIsolation();
    for (const check of report.checks)
      expect({ name: check.name, passed: check.passed }).toEqual({
        name: check.name,
        passed: true,
      });
    expect(report.qualified).toBe(true);
  },
  30000,
);
