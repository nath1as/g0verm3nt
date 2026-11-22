import { expect, test } from "bun:test";
import {
  publicTask,
  selectSwebenchCohort,
} from "../src/experiments/swebench-cohort.ts";

const rows = Array.from({ length: 40 }, (_, i) => ({
  instance_id: `project__repo-${i}`,
  repo: `owner/repo${i % 4}`,
  base_commit: "a".repeat(40),
  problem_statement: `Issue ${i}`,
  patch: "SECRET GOLD",
  test_patch: "SECRET TEST",
  FAIL_TO_PASS: ["SECRET IDS"],
  hints_text: "SECRET HINT",
}));
test("public boundary drops privileged and future upstream fields", () => {
  const task = publicTask({ ...rows[0], future_private_field: "PRIVATE" });
  expect(Object.keys(task).sort()).toEqual([
    "base_commit",
    "instance_id",
    "problem_statement",
    "repo",
  ]);
  expect(JSON.stringify(task)).not.toContain("SECRET");
  expect(() => publicTask({ ...rows[0], base_commit: "main" })).toThrow();
});
test("selection ignores row order and gold data with disjoint frozen phases", () => {
  const first = selectSwebenchCohort(rows);
  expect(
    selectSwebenchCohort(
      [...rows].reverse().map((row) => ({ ...row, patch: "CHANGED" })),
    ),
  ).toEqual(first);
  expect(new Set(first.selected.map((t) => t.instanceId)).size).toBe(22);
  expect(first.selected.filter((t) => t.phase === "smoke")).toHaveLength(2);
  expect(first.selected.filter((t) => t.phase === "development")).toHaveLength(
    8,
  );
  expect(first.selected.filter((t) => t.phase === "assessment")).toHaveLength(
    12,
  );
  expect(new Set(first.selected.slice(0, 4).map((t) => t.repo)).size).toBe(4);
  expect(JSON.stringify(first)).not.toContain("SECRET");
  expect(() => selectSwebenchCohort([...rows, rows[0]])).toThrow("duplicate");
  expect(() => selectSwebenchCohort(rows.slice(0, 2))).toThrow("22");
});
