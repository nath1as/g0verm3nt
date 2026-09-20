import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashCanonicalJson } from "../src/codecs/canonical.ts";
import { normalizationBaseline } from "../src/fixtures/normalization.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

const time = "2026-09-20T00:00:00.000Z";

// Reconstruct the released layouts, including the old CHECK constraint and
// the original v18 checkpoint / v19 relation numbering. Seed through the API
// first so the upgrade must preserve real referenced records, not empty tables.
async function legacyDatabase(directory: string, version: number) {
  const store = await SqliteRunStore.open(directory);
  try {
    store.registerGraphDefinition(normalizationBaseline);
    store.createGraphHead("head", normalizationBaseline.ref, time);
    store.createGraphProposal({
      proposalId: "proposal",
      headKey: "head",
      baseGraphRef: normalizationBaseline.ref,
      candidateGraphRef: normalizationBaseline.ref,
      baseVersion: 0,
      createdAt: time,
      dependencies: [{ dependencyKind: "manifest", dependencyRef: "support" }],
    });
    store.createGraphProposalReceipt({
      receiptId: "receipt",
      proposalId: "proposal",
      checkedFingerprint: "legacy-fingerprint",
      checkedAt: time,
    });
  } finally {
    await store.close();
  }
  const db = new Database(join(directory, "government.sqlite"));
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE legacy_proposals (
      proposal_id TEXT PRIMARY KEY,
      head_key TEXT NOT NULL REFERENCES graph_heads(head_key),
      base_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
      candidate_graph_ref TEXT NOT NULL REFERENCES graph_definitions(ref),
      base_version INTEGER NOT NULL CHECK (base_version >= 0),
      origin_run_id TEXT REFERENCES runs(id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'stale')),
      created_at TEXT NOT NULL,
      committed_at TEXT
    );
    INSERT INTO legacy_proposals SELECT * FROM graph_proposals;
    DROP TABLE graph_proposals;
    ALTER TABLE legacy_proposals RENAME TO graph_proposals;
  `);
  db.exec(
    "DROP TABLE graph_head_dependencies; DROP TABLE graph_head_statuses;",
  );
  db.exec("DROP TABLE composition_projection_events;");
  db.exec(
    "DROP TABLE m3_evaluation_cohort_observations; DROP TABLE m3_task_evaluations; DROP TABLE provider_attempts;",
  );
  db.query("DELETE FROM schema_migrations WHERE version > ?").run(version);
  db.exec(`
    ALTER TABLE graph_proposal_receipts DROP COLUMN admission_evidence_fingerprint;
    ALTER TABLE graph_proposal_receipts DROP COLUMN admitted_governor_run_id;
    ALTER TABLE graph_proposal_receipts DROP COLUMN admitted_origin_run_id;
    ALTER TABLE graph_proposal_receipts DROP COLUMN admission_policy_ref;
  `);
  if (version < 15) db.exec("DROP TABLE graph_proposal_dependencies");
  if (version < 16) db.exec("DROP TABLE graph_dependency_statuses");
  if (version < 17)
    db.exec(
      "ALTER TABLE graph_proposal_receipts DROP COLUMN dependency_status_fingerprint",
    );
  if (version < 21) {
    db.exec(
      "DROP TABLE graph_proposal_evidence; DROP TABLE graph_evidence; DROP TABLE m3_cohort_observations;",
    );
  } else {
    db.exec(
      "INSERT INTO graph_evidence VALUES ('legacy-evidence', 'legacy', 'subject', 'unverified', '{}', 'then'); INSERT INTO graph_proposal_evidence VALUES ('proposal', 'legacy-evidence');",
    );
  }
  if (version < 19) db.exec("DROP TABLE composition_relations");
  else
    db.exec(
      "INSERT INTO composition_relations VALUES ('relation', 'test', 'left', 'right', 'active', '{}', 'then')",
    );
  if (version < 18) db.exec("DROP TABLE composition_checkpoints");
  else
    db.exec(
      "INSERT INTO composition_checkpoints VALUES ('checkpoint', 'root', NULL, '[]', 'then')",
    );
  return db;
}

for (const version of [14, 17, 18, 19, 21]) {
  test(`upgrades historical v${version} without losing records or foreign keys`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "government-migration-"));
    try {
      const db = await legacyDatabase(directory, version);
      const preserved = ["graph_proposals", "graph_heads", "graph_definitions"];
      if (version >= 15) preserved.push("graph_proposal_dependencies");
      if (version >= 16) preserved.push("graph_dependency_statuses");
      if (version >= 21)
        preserved.push("graph_evidence", "graph_proposal_evidence");
      if (version >= 18) preserved.push("composition_checkpoints");
      if (version >= 19) preserved.push("composition_relations");
      const before = preserved.map((table) =>
        db.query(`SELECT * FROM ${table}`).all(),
      );
      db.close();
      const upgraded = await SqliteRunStore.open(directory);
      try {
        expect(upgraded.schemaVersion()).toBe(29);
        const inspection = new Database(join(directory, "government.sqlite"));
        try {
          expect(
            preserved.map((table) =>
              inspection.query(`SELECT * FROM ${table}`).all(),
            ),
          ).toEqual(before);
          expect(inspection.query("PRAGMA foreign_key_check").all()).toEqual(
            [],
          );
          expect(
            inspection
              .query("PRAGMA foreign_key_list(graph_proposal_receipts)")
              .all(),
          ).toContainEqual(
            expect.objectContaining({ table: "graph_proposals" }),
          );
          expect(
            inspection
              .query(
                "SELECT receipt_id, proposal_id, checked_fingerprint FROM graph_proposal_receipts",
              )
              .all(),
          ).toEqual([
            {
              receipt_id: "receipt",
              proposal_id: "proposal",
              checked_fingerprint: "legacy-fingerprint",
            },
          ]);
          if (version < 15) {
            inspection.exec(
              "PRAGMA foreign_keys = ON; INSERT INTO graph_proposal_dependencies VALUES ('proposal', 'manifest', 'support');",
            );
          }
        } finally {
          inspection.close();
        }
        upgraded.createGraphEvidence({
          evidenceId: "new-evidence",
          evidenceKind: "test",
          subjectRef: "subject",
          fingerprint: hashCanonicalJson({ value: 1 }),
          payload: { value: 1 },
          admittedAt: time,
        });
        expect(upgraded.getGraphEvidence("new-evidence")?.subjectRef).toBe(
          "subject",
        );
        // Both FK enforcement and the expanded status CHECK must work after repair.
        expect(() =>
          upgraded.createGraphHead(
            "invalid",
            "missing" as typeof normalizationBaseline.ref,
            time,
          ),
        ).toThrow();
        upgraded.setGraphDependencyStatus(
          "support",
          "suspended",
          "revoked",
          "v2",
          time,
        );
        expect(upgraded.getGraphProposal("proposal")?.status).toBe("suspended");
      } finally {
        await upgraded.close();
      }
      const reopened = await SqliteRunStore.open(directory);
      try {
        expect(reopened.schemaVersion()).toBe(29);
        expect(reopened.getGraphProposal("proposal")?.status).toBe("suspended");
      } finally {
        await reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("failed compatibility repair rolls back and releases the writer lock", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "government-migration-failure-"),
  );
  try {
    const db = await legacyDatabase(directory, 21);
    db.exec("UPDATE graph_proposal_receipts SET proposal_id = 'missing'");
    db.close();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(SqliteRunStore.open(directory)).rejects.toThrow(
        "database migration foreign key check failed",
      );
    }
    const inspection = new Database(join(directory, "government.sqlite"));
    try {
      expect(
        inspection
          .query("SELECT MAX(version) AS version FROM schema_migrations")
          .get(),
      ).toEqual({ version: 21 });
      expect(
        inspection
          .query("SELECT sql FROM sqlite_schema WHERE name = 'graph_proposals'")
          .get(),
      ).not.toEqual(
        expect.objectContaining({
          sql: expect.stringContaining("'suspended'"),
        }),
      );
      expect(
        inspection
          .query(
            "SELECT name FROM sqlite_schema WHERE name = 'graph_proposals_rebuilt'",
          )
          .get(),
      ).toBeNull();
      inspection.exec(
        "UPDATE graph_proposal_receipts SET proposal_id = 'proposal'",
      );
    } finally {
      inspection.close();
    }
    const repaired = await SqliteRunStore.open(directory);
    expect(repaired.schemaVersion()).toBe(29);
    await repaired.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
