# Workflow opportunity screen

Status: proposed, 2026-10-05. No harness, sample or model run exists yet. This document decides whether the central hypothesis has anything to learn before more Government runtime is built.

## Why this comes first

Every live result so far either went against adaptation or showed nothing for it to work with. M3 was negative. Repair discovery and both Luna calibrations were too easy, so the model passed almost everything and no retry branch ran. The central hypothesis needs two conditions to hold. First, different workflows must succeed on different tasks, or cost different amounts on them. Second, task features visible before execution must predict which workflow to use. If either fails, Government's admission, revision and reuse machinery has no benefit to preserve.

This screen measures both conditions directly. It deliberately uses less rigor than an admission experiment. It uses no Government runtime, no durable frames and no promotion path. It can only end the line of work or justify resuming it. It cannot support an improvement claim.

## Question

On repository issue repair with one fixed executor, does choosing a workflow per task beat the best single fixed workflow by more than seed noise? Can a simple rule over issue-visible features capture a meaningful share of that gap?

The primary framing is cost: a cheap configuration versus an expensive configuration at equal verified success. Quality gains are reported, but they are not the main bet.

## Arms

Both arms use the native Codex agent through `codex exec`, with the same model (`gpt-5.6-luna`), prompt, tools, sandbox and caps. Only the reasoning effort differs.

- **A (cheap):** low reasoning effort.
- **B (expensive):** high reasoning effort.

A third arm runs only if the main stage passes. **C** is A followed by one verification continuation through `codex exec resume`, using a fixed prompt to re-check the patch against repository-visible tests. This is the checkpoint intervention from the [repository benchmark plan](repository-benchmark-plan.md). Gold or grader output never reaches any arm.

## Sample

- **Pool:** SWE-bench Verified at the pinned revision `c104f840…`. Exclude all 22 IDs in the frozen cohort (`d15a54fb…`); its 12 assessment tasks stay unopened.
- **Strata:** use the dataset's `difficulty` annotation. Keep only `15 min - 1 hour` and `1-4 hours`, because the trivial stratum is where earlier runs had no headroom. This is the maintainers' annotation, not an observation of our worker, so the selection stays outcome-blind with respect to our runs.
- **Selection:** reuse `src/experiments/swebench-cohort.ts` ranking with the new seed `government-opportunity-screen-v1`, sampling round-robin across repositories. Take 10 pilot tasks plus 40 main tasks, disjoint, and freeze the manifest before any run.
- Report repository correlation. Never replace tasks after outcomes.

## Environment

The network blocks local execution. Image pulls measured about 90 KB/s, and 50 instance images are tens of GiB, so they can't be downloaded locally. **Decision D1** below chooses the venue.

Per rollout:

1. Start a fresh container from the instance image.
2. Remove the repository's git history and re-initialise it at the base commit, because upstream images can retain future fix commits.
3. Confirm that no gold, test-patch or hint fields exist in the container.
4. Run `codex exec` inside the container with web search disabled and a 20-minute wall limit.
5. Capture the diff and the Codex JSONL output, including usage.

Grade each diff once, in a separate fresh container, through the existing official `run_instance` path in `tools/swebench_smoke.py`. Treat environment errors as indeterminate, never as failures. Start by running the bridge's four empty/gold controls on the two smoke IDs to qualify the venue.

Isolation is screen-grade only. The container has network access for the provider, and credentials sit inside the worker. Record this, and do not reuse these runs as admission evidence.

## Engineering scope

Write one Python runner of roughly 300–400 lines under `tools/`. It reuses the smoke bridge's grading and provenance code and appends one JSONL row per rollout with these fields: task, arm, seed, diff hash, resolution, tokens (input, cached, output), wall time and error class. Analysis is a separate offline script. Make no changes to `src/core`, `src/runtime` or `src/storage`.

## Stages and ceilings

0. **Venue qualification:** no model calls. Run the four smoke controls, then one A rollout on one smoke task to confirm the executor, usage capture and patch extraction end to end.
1. **Pilot:** 10 tasks × arm A × 1 seed = 10 rollouts. Measure the solve rate, tokens per rollout and wall time.
   - **Stop and switch pools:** if A solves 9–10 tasks, the pool has no headroom. Move to a pinned SWE-bench Live release under a new manifest.
   - **Stop:** if A solves 0–1 tasks, or if more than 2 rollouts end indeterminate from the environment.
   - Otherwise, set the main token ceiling at 1.5 × the pilot mean × 160. The user approves that ceiling before stage 2.
2. **Main:** 40 tasks × arms A and B × 2 seeds = 160 rollouts. Alternate arm order by task index. Stop dispatch if any rollout exceeds 3 × the pilot mean or reports unknown usage, keeping the rollout's cost on record.
3. **Optional:** arm C on the same 40 tasks × 2 seeds, only if stage 2 passes and the user approves a new ceiling.

## Analysis (frozen before the pilot)

- **Per-task solve rate per arm:** 0, ½ or 1 across the two seeds.
- **Noise:** the rate at which seeds disagree within an arm. An across-arm difference only counts when both seeds agree within each arm.
- **Cost oracle:** use A when A solved both seeds, otherwise B. Compare its solves and tokens with always-A and always-B.
- **Quality oracle:** count tasks B solves on both seeds and A on neither, and the reverse.
- **Predictability:** use predeclared issue-visible features only:
  - problem-statement length in tokens
  - whether a traceback is present
  - whether a code block is present
  - number of file paths mentioned
  - repository

  Fit a depth-1 rule and an L2 logistic regression with leave-one-repository-out evaluation. Compare the share of the oracle gap each recovers. Do not use the difficulty label as a feature, because it isn't available at run time.

## Decision rules

- **Go.** All three conditions must hold:
  - the cost oracle saves at least 30% of always-B tokens at no loss of solves;
  - that saving comes from discordant tasks beyond the measured seed noise;
  - an issue-visible rule recovers at least half of it out of repository.

  Then resume the M3/M4 path on this opportunity. Freeze a learned route against best-fixed and authored controls on fresh tasks, and only then bring back Government admission and reuse.
- **Weak.** The oracle gap is real, but no rule recovers it. Report this. A richer selector, such as the [semantic decision contract](semantic-decision-contract.md), needs its own prospective data plan. Do not run it on this sample.
- **No-go.** A and B are indistinguishable beyond noise, or one arm dominates on both cost and quality. Report that workflow selection does not pay in this regime. Shelve the coding branch of the central hypothesis rather than add mechanism.

Results are a feasibility screen over 40 correlated tasks. They are not a benchmark score and not evidence of improvement.

## Open decisions

- **D1 — venue.** Option (a) is a rented x86-64 VM with fast egress, roughly 16 vCPU, 64 GiB RAM and 500 GiB of disk, which needs a bounded hourly spend. Option (b) is local execution on a faster connection. A hosted evaluator would grade, but it can't host the worker's test-running environment, so it can't replace (a) or (b).
- **D2 — provider allowance.** 170 Codex rollouts on a subscription may hit rate limits. The pilot measures usage. If limits apply, the main stage runs over several days with no change to the protocol.
