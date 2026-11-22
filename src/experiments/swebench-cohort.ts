import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, hashCanonicalJson } from "../codecs/canonical.ts";

export const swebenchDataset = {
  name: "princeton-nlp/SWE-bench_Verified",
  revision: "c104f840cc67f8b6eec6f759ebc8b2693d585d4a",
  upstreamSplit: "test",
  file: "data/test-00000-of-00001.parquet",
} as const;
export const cohortSeed = "government-repository-pilot-v1";
type Task = {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
};

/** Explicit field projection: gold patches, test patches, hints and test IDs
 * never become part of an agent input, even if future upstream fields appear. */
export function publicTask(value: unknown): Task {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid task");
  const row = value as Record<string, unknown>;
  for (const field of [
    "instance_id",
    "repo",
    "base_commit",
    "problem_statement",
  ])
    if (typeof row[field] !== "string" || !row[field].trim())
      throw new Error(`missing ${field}`);
  const task = {
    instance_id: String(row.instance_id),
    repo: String(row.repo),
    base_commit: String(row.base_commit),
    problem_statement: String(row.problem_statement),
  };
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(task.repo) ||
    !/^[a-f0-9]{40}$/.test(task.base_commit) ||
    !/^[A-Za-z0-9_.-]+$/.test(task.instance_id)
  )
    throw new Error("invalid repository, commit or instance ID");
  return task;
}

export function selectSwebenchCohort(rows: readonly unknown[]) {
  const tasks = rows.map(publicTask);
  if (new Set(tasks.map((t) => t.instance_id)).size !== tasks.length)
    throw new Error("duplicate instance ID");
  const rank = (key: string) => hashCanonicalJson({ seed: cohortSeed, key });
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const group = groups.get(task.repo) ?? [];
    group.push(task);
    groups.set(task.repo, group);
  }
  const repositories = [...groups.keys()].sort((a, b) =>
    compare(rank(a), rank(b)),
  );
  for (const group of groups.values())
    group.sort((a, b) => compare(rank(a.instance_id), rank(b.instance_id)));
  const ordered: Task[] = [];
  for (let depth = 0; ordered.length < tasks.length; depth++) {
    for (const repo of repositories) {
      const task = groups.get(repo)?.[depth];
      if (task) ordered.push(task);
    }
  }
  if (ordered.length < 22) throw new Error("requires 22 distinct tasks");
  // No model outcomes, reference patch lengths, or changed-file labels enter selection.
  const selected = ordered.slice(0, 22).map((task, index) => ({
    phase: index < 2 ? "smoke" : index < 10 ? "development" : "assessment",
    instanceId: task.instance_id,
    repo: task.repo,
    baseCommit: task.base_commit,
    problemFingerprint: hashCanonicalJson(task.problem_statement),
  }));
  return {
    dataset: swebenchDataset,
    seed: cohortSeed,
    selection:
      "hash-ranked repositories and IDs, round-robin repository sampling",
    counts: { smoke: 2, development: 8, assessment: 12 },
    poolSize: tasks.length,
    publicPoolFingerprint: hashCanonicalJson(
      [...tasks].sort((a, b) => compare(a.instance_id, b.instance_id)),
    ),
    selected,
  };
}

if (import.meta.main) {
  const [inputPath, outputDirectory, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputDirectory || extra.length)
    throw new Error(
      "usage: bun src/experiments/swebench-cohort.ts <public-rows.json> <new-directory>",
    );
  const bytes = readFileSync(inputPath);
  const input = JSON.parse(bytes.toString("utf8"));
  if (
    !Array.isArray(input.rows) ||
    canonicalJson(input.dataset) !== canonicalJson(swebenchDataset) ||
    !/^[a-f0-9]{64}$/.test(input.parquetSha256 ?? "")
  )
    throw new Error("missing pinned dataset provenance");
  const cohort = selectSwebenchCohort(input.rows);
  const manifest = {
    ...cohort,
    parquetSha256: input.parquetSha256,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    selectorFingerprint: hashCanonicalJson(
      readFileSync(new URL(import.meta.url), "utf8"),
    ),
    launchReady: false,
    providerAttempts: 0,
  };
  const directory = resolve(outputDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "cohort.json"),
    canonicalJson({ ...manifest, fingerprint: hashCanonicalJson(manifest) }),
    { flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify({ tasks: cohort.selected.length, counts: cohort.counts, poolSize: cohort.poolSize, launchReady: false })}\n`,
  );
}
