# Government

Government is an experimental local runtime for evidence-backed changes to agent composition. This checkout currently implements an offline CLI, deterministic fake model, durable run events in SQLite, cancellation, saved-run inspection, command receipts, a checked graph fragment (`id`, exact `call`, `wire`, `seq`, `route`, `guard`, and bounded `retry`), immutable in-memory graph definitions with exact catalogue manifests, serializable execution frames, and atomic SQLite persistence for graph operation intents and observations.

The formal scope is in [plan.md](plan.md). The lean, gate-driven delivery order is in [docs/lean-execution-plan.md](docs/lean-execution-plan.md).

## Commands

```text
bun install
bun run check
bun run demo
bun run src/cli/main.ts --state-dir /tmp/government-normalization-demo normalization-demo --json
bun run run fake-task --json
bun run run fake-task --cancel-after-ms 1 --json
bun run runs --json
bun run inspect <run-id> --json
bun run src/cli/main.ts --state-dir /tmp/government-provider-smoke provider-smoke --model gpt-6-astra --provider-timeout-ms 60000 --json
bun run src/cli/main.ts --state-dir /tmp/government-provider-smoke inspect attempt <attempt-id> --json
bun run src/cli/main.ts --state-dir /tmp/government-m3 m3-refactor m3/harness-default@1 m3/typescript-refactor/trim-prefix@1 --model gpt-6-astra --provider-timeout-ms 60000 --json
bun run src/cli/main.ts --state-dir /tmp/government-m3 inspect evaluation <evaluation-id> --json
bun run src/cli/main.ts --state-dir /tmp/government-m3 m3-cohort-record m3/development-pilot@1 <evaluation-id> --json
bun run src/cli/main.ts --state-dir /tmp/government-m3 inspect m3-cohort m3/development-pilot@1 --json
bun run src/cli/main.ts --state-dir /tmp/government-m3 m3-development-report m3/development-comparison@1 --json
```

The default state directory is `.government/`. Pass `--state-dir <path>` before the command to select another local state directory.

The runtime has an offline normalization mutation demonstration with durable graph frames, owned child runs, evidence, receipts, a head transition, restart inspection, and revoked-support rejection. It remains a bounded fixture rather than a general executor or provider integration. The fake model is a deterministic, cancellable boundary used to exercise durable terminal outcomes.

`provider-smoke` is an opt-in live Codex transport check. It creates a disposable read-only work directory, records the provider attempt before dispatch, and retains its bounded terminal JSONL artifact. An interrupted call stays indeterminate and is never replayed automatically. It records token counts when the CLI exposes them, while monetary cost and Codex's internal model-call count remain unknown.

`m3-refactor [variant-ref] [task-ref]` is a separate opt-in live coding experiment for a pinned TypeScript fixture. It accepts only a canonical restricted JSON patch, evaluates it in a fresh Bubblewrap workspace, and records the source, patch, evaluator/profile hashes, output, outcome, and provider attempt under one run. A malformed artifact or unsuccessful evaluation produces a visible failed run; it does not establish coding success. `m3-development-report` assembles the frozen development cohort and applies its checked-in selection rule; it never calls a provider.

`m3-cohort-record` derives a comparison observation from an existing evaluated run. It cannot supply a manual success result, token total, or cost: the row retains the completed provider attempt's exact usage artifact and terminal fingerprint.
