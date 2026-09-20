# M4 — Held-out promotion policy scaffold

The offline M4 scaffold separates discovery observations from held-out observations and evaluates a candidate only against its registered fixed comparator. A candidate is promoted only when the held-out sample count, success-rate delta, and cost multiplier satisfy the frozen policy. Insufficient held-out evidence produces an inconclusive result; weak benefit or excessive cost retains the fixed comparator. Every candidate declares a compatible fallback.

This module is provider-independent. It does not persist cohorts, execute coding tasks, or claim measured improvement. Those remain the next M4 integration slices. Duplicate observations and invalid costs are rejected before a decision is produced.
