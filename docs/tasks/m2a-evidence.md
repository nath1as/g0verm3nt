# M2a: durable evidence binding

Evidence is now an immutable SQLite record with an exact subject reference, kind, fingerprint, bounded JSON payload, and admission timestamp. Proposals may link admitted evidence IDs; proposal creation rejects missing evidence and stores the links transactionally.

New normalization revisions require one version-3 persisted-domain envelope. It fixes all five ordered fixture inputs, their independent canonical results, the expected fast/slow capability dispatch, and distinct terminal executions owned by the originating child. Version-1 and version-2 records remain readable but cannot mint a new normalization receipt. Admission and commit independently recheck the complete bundle.

The CLI can inspect heads, proposals, dependencies, checkpoints, and relations. The normalization fixture has a deterministic evaluator and evidence admission rule requiring complete one-to-one audit coverage.
