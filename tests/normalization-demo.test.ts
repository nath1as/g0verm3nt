import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizationRefs } from "../src/fixtures/normalization.ts";
import { runNormalizationDemo } from "../src/runtime/normalization-demo.ts";
import { SqliteRunStore } from "../src/storage/sqlite.ts";

test("offline normalization demo survives restart and rejects revoked support", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "government-normalization-demo-"),
  );
  try {
    const store = await SqliteRunStore.open(directory);
    const demo = runNormalizationDemo(store, "2026-09-20T00:00:00.000Z");
    await store.close();
    expect(demo).toMatchObject({
      headBefore: normalizationRefs.baseline,
      headAfter: normalizationRefs.revised,
      subsequentCandidateRef: normalizationRefs.revised,
      revokedSupportRejection: "proposal dependency is not active",
      revokedExecutionRejection: "graph head is not active",
    });
    expect(demo.evidenceExecutionIds).toHaveLength(5);
    const reopened = await SqliteRunStore.open(directory);
    try {
      expect(reopened.getGraphHead("normalization")).toMatchObject({
        graphRef: normalizationRefs.revised,
        version: 1,
      });
      expect(
        reopened.getGraphExecution(demo.subsequentExecutionId)?.frame.state,
      ).toMatchObject({ kind: "succeeded" });
      for (const executionId of demo.evidenceExecutionIds)
        expect(
          reopened.getGraphExecution(executionId)?.frame.state,
        ).toMatchObject({ kind: "succeeded" });
      expect(reopened.getGraphProposal("normalization-revoked")?.status).toBe(
        "pending",
      );
      expect(
        reopened.getGraphDependencyStatus(normalizationRefs.manifest),
      ).toMatchObject({
        status: "suspended",
      });
      expect(reopened.getGraphHeadStatus("normalization")).toMatchObject({
        status: "suspended",
      });
      expect(
        reopened.getCompositionRelation(
          "normalization-relation/normalization-revision",
        ),
      ).toMatchObject({
        relationKind: "normalization-revision",
        leftRef: `graph:${normalizationRefs.baseline}`,
        rightRef: `graph:${normalizationRefs.revised}`,
        status: "suspended",
        scope: {
          proposalId: "normalization-revision",
          evidenceIds: ["normalization-evidence"],
        },
      });
      expect(reopened.getSharedCompositionView()).toMatchObject({
        revision: expect.any(Number),
        items: expect.arrayContaining([
          {
            kind: "head",
            ref: "normalization",
            status: "suspended",
          },
          {
            kind: "proposal",
            ref: "normalization-revoked",
            status: "pending",
          },
          {
            kind: "relation",
            ref: "normalization-relation/normalization-revision",
            status: "suspended",
          },
        ]),
      });
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
