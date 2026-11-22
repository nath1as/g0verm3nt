import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("SWE-bench controls reject missing observations and infrastructure failures", () => {
  const result = spawnSync(
    "python",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "tools",
      "-p",
      "test_swebench_smoke.py",
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
