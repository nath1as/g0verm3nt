# M3 live provider smoke run

Audit correction (2026-09-20): the success labels below mean provider response completion, not independently evaluated TypeScript correctness. The summary retry used a different prompt. These runs are not a matched coding comparison and must not enter promotion evidence. These historical records have no retained terminal JSONL artifact, so their usage remains unknown.

The local authenticated Codex CLI was exercised through CodexCliGateway with model gpt-6-astra. The fixed TypeScript normalization task was run through all three frozen harness variants:

- m3/harness-default@1: success, 15.6 s, response fingerprint 48a3cf3e
- m3/harness-planning@1: success, 13.1 s, response fingerprint 9ad28ccd
- m3/harness-summary@1: success, 11.0 s, response fingerprint 78ce2d6e

The CLI adapter reports usage as unknown because the subprocess boundary does not expose token counts. These are live smoke measurements, not a statistically meaningful comparison; repeated held-out tasks and persisted cohort records are still required before promotion.
