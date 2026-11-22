import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";
import type { JsonValue } from "../core/graph.ts";
import { repairDiscoveryTasks } from "../fixtures/repair-discovery.ts";
import {
  CentralHypothesisRunner,
  centralIsolationProfile,
} from "../runtime/central-hypothesis-isolation.ts";
import { centralWorkflowPrompt } from "../runtime/central-hypothesis-workflow.ts";
import {
  evaluateTypescriptRefactorPatch,
  type IsolatedCommandRunner,
  makeRestrictedPatch,
} from "../runtime/typescript-refactor-evaluator.ts";

export async function qualifyRepairDiscovery(runner: IsolatedCommandRunner) {
  const checks = [];
  for (const entry of repairDiscoveryTasks) {
    const prompt = centralWorkflowPrompt(entry.task);
    if (
      prompt.includes(entry.referenceSource) ||
      Object.values(entry.hiddenFiles).some((source) => prompt.includes(source))
    )
      throw new Error("private oracle in public prompt");
    const original = entry.task.files[entry.task.sourcePath];
    if (original === undefined) throw new Error("missing original source");
    const variants = [
      { id: "reference", source: entry.referenceSource },
      { id: "combined", source: original },
      ...entry.mutants,
    ];
    for (const phase of ["public", "hidden"] as const) {
      const task =
        phase === "public"
          ? entry.task
          : {
              ...entry.task,
              files: {
                ...Object.fromEntries(
                  Object.entries(entry.task.files).filter(
                    ([path]) => !path.startsWith("test/"),
                  ),
                ),
                ...entry.hiddenFiles,
              },
            };
      for (const variant of variants) {
        const evaluation = await evaluateTypescriptRefactorPatch(
          task,
          makeRestrictedPatch(task, variant.source),
          runner,
        );
        checks.push({
          taskRef: task.ref,
          phase,
          variant: variant.id,
          evaluation,
        });
      }
    }
  }
  // Every single mutation must be killed by hidden tests on its own. Public
  // coverage is reported, not required for every defect; combined sources must
  // have a visible failure so the proposed retry gate can be exercised.
  const qualified = checks.every(({ phase, variant, evaluation }) => {
    if (variant === "reference") return evaluation.outcome === "verified";
    if (variant === "combined" || phase === "hidden")
      return evaluation.outcome === "failed";
    return evaluation.outcome === "verified" || evaluation.outcome === "failed";
  });
  return { qualified, checks };
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg)
    throw new Error(
      "usage: bun src/experiments/repair-discovery-qualification.ts <new-output-directory>",
    );
  const directory = resolve(arg);
  const implementation = Object.fromEntries(
    [
      "src/fixtures/repair-discovery.ts",
      "src/experiments/repair-discovery-qualification.ts",
      "src/runtime/central-hypothesis-isolation.ts",
      "src/runtime/typescript-refactor-evaluator.ts",
      "src/runtime/central-hypothesis-workflow.ts",
      "docs/tasks/repair-discovery-protocol.md",
    ].map((path) => [path, readFileSync(path, "utf8")]),
  );
  const corpus = JSON.parse(JSON.stringify(repairDiscoveryTasks)) as JsonValue;
  const identity = hashCanonicalJson({
    corpus,
    implementation,
    profile: centralIsolationProfile,
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    canonicalJson({
      ref: "repair-discovery/offline-qualification@1",
      identity,
      profile: centralIsolationProfile,
      providerAttempts: 0,
    }),
    { flag: "wx" },
  );
  writeFileSync(join(directory, "corpus.json"), canonicalJson(corpus), {
    flag: "wx",
  });
  writeFileSync(
    join(directory, "implementation.json"),
    canonicalJson(implementation),
    { flag: "wx" },
  );
  const result = await qualifyRepairDiscovery(new CentralHypothesisRunner());
  writeFileSync(
    join(directory, "qualification.json"),
    canonicalJson(JSON.parse(JSON.stringify({ identity, ...result }))),
    { flag: "wx" },
  );
  for (const check of result.checks)
    process.stdout.write(
      `${JSON.stringify({ task: check.taskRef, phase: check.phase, variant: check.variant, outcome: check.evaluation.outcome })}\n`,
    );
  process.stdout.write(
    `${JSON.stringify({ identity, qualified: result.qualified, checks: result.checks.length, providerAttempts: 0 })}\n`,
  );
  if (!result.qualified) process.exitCode = 1;
}
