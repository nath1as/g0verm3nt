# M4 live held-out assessment

Audit correction (2026-09-20): this is a policy smoke artifact built from provider-completion flags, not verified task outcomes. The trim task had already been used in earlier smoke work, and latency was supplied as cost without a frozen monetary interpretation. The retain-fixed output does not establish a valid held-out M4 assessment. Exclude these observations from promotion evidence.

Two held-out TypeScript tasks were run through the authenticated Codex CLI using the default candidate and planning comparator. All four runs succeeded, with usage unknown at the CLI boundary.

The candidate accumulated 29,486 latency units and the comparator 27,418. Both had a 100% held-out success rate, so the frozen policy returned retain-fixed: the candidate did not exceed the required success-rate delta. Assessment fingerprint: 8ad6762b094286563fcc9941956707bc01dcd6feacd23aa873060a944e0a15ea.

This is a small smoke cohort, not a general performance claim.

## Current decision boundary

The later verified M3 development cohort selected `m3/harness-default@1`: the only implemented intervention produced the same verified patch while using 19 more total tokens. It therefore did not create an eligible candidate for this M4 policy, and `strip-suffix@1` remains untouched. No M4 held-out assessment or promotion decision has been run from that result. A future assessment needs a new, predeclared intervention, task scope, and budget.
