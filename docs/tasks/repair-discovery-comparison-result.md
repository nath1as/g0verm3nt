# Repair discovery comparison — 2026-09-20

Result: **no retry opportunity observed**. All three direct initial attempts by `gpt-5.6-luna` at explicit low reasoning passed public and hidden verification. The frozen controller completed after three of its maximum nine attempts; no feedback or fresh-retry branch was eligible or executed.

| Development task | Public | Hidden | Input tokens | Cached input (included) | Output tokens | Total |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Nested atomic table | Pass | Pass | 12,198 | 8,960 | 582 | 12,780 |
| Single-flight invalidation | Pass | Pass | 12,192 | 8,960 | 607 | 12,799 |
| Reentrant turn scheduler | Pass | Pass | 12,113 | 8,960 | 622 | 12,735 |
| Total | | | 36,503 | 26,880 | 1,811 | 38,314 |

Actual observed experiment spend was **38,314 tokens**. Both policy totals are also 38,314 because both terminate at the same shared initial attempts; summing those policy totals would double-count the experiment. These are identical shared outcomes, not independent workflow trials. All usage was known, all provider attempts completed, and observed commands/tools were zero. Monetary billing, underlying model-call counts, and engineering costs remain unknown or outside this execution total. No attempt exceeded its observed token ceilings.

The exact controller/corpus qualification passed 30 reference/mutant checks before launch. Real candidate evaluation then passed the public suite separately and the public-plus-hidden suite for each task. The latter suites contained 120, 36, and 17 assertions respectively. Finite test success does not establish complete correctness or precise reliability.

State: `.government/repair-comparison-ready-2026-09-20/` (gitignored). The immutable launch manifest, protocol and implementation snapshots, corpus, qualification, atomic report and SQLite provider/evaluation records are retained there.

- Qualification identity: `7353340ab0e6050398f01f8cd6939f758860292c0b3733a621b16779e5c402d7`.
- Launch manifest fingerprint: `e0914bd8070a7f515950b85d96e6f8ebbd685a91ac54552ef73b5344acebe117`.
- Final canonical report fingerprint: `fe0d431f5d86612c558a716634141bc92aaedc29134df03f61e4a5b33b517046`.

The [protocol](repair-discovery-protocol.md) stops on this outcome. It provides no estimate of feedback benefit, fresh-retry recovery, learned routing, or amortization. Assessment and promotion were not attempted. These three new contracts still did not expose failures in the configured model. Any continuation should change the task regime using a separately frozen protocol, rather than repeat this successful batch or force feedback on passing artifacts. A repository-scale task with incomplete localization would test a different practical workload; that remains a proposal, not an executed experiment.
