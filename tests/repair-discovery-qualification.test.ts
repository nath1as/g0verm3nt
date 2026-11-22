import { expect, test } from "bun:test";
import { qualifyRepairDiscovery } from "../src/experiments/repair-discovery-qualification.ts";

// Only repository-authored reference/mutant fixtures run here. Real
// qualification uses the isolated runner; provider artifacts never use this.
test("new contracts hold and hidden tests independently kill every named mutation", async () => {
  const result = await qualifyRepairDiscovery({
    async run(workspace) {
      const child = Bun.spawn([process.execPath, "test"], {
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 5_000);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        return { exitCode, stdout, stderr, timedOut };
      } finally {
        clearTimeout(timer);
      }
    },
  });
  for (const check of result.checks) {
    if (check.variant === "reference")
      expect(check.evaluation.outcome).toBe("verified");
    else if (check.phase === "hidden" || check.variant === "combined")
      expect(check.evaluation.outcome).toBe("failed");
  }
  expect(result.checks).toHaveLength(30);
  expect(result.qualified).toBe(true);
}, 30_000);
