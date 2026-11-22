"""Offline boundary tests; no Docker, dataset download, or model calls."""
import copy
import unittest
from unittest.mock import patch

from swebench_smoke import PARQUET_HASH, canonical, digest, qualify, smoke_rows


class SmokeQualificationTests(unittest.TestCase):
    def setUp(self):
        self.report = {"example": {"resolved": False, "patch_successfully_applied": True}}
        self.statuses = {"target": "FAILED", "regression": "PASSED"}

    def check(self, control="base", report=None, statuses=None):
        return qualify(self.report if report is None else report, "example", control,
                       self.statuses if statuses is None else statuses, ["target"], ["regression"])

    def test_base_requires_observed_target_failure_and_preserved_regressions(self):
        self.assertTrue(self.check()["qualified"])
        for statuses in ({}, {"regression": "PASSED"},
                         {"target": "PASSED", "regression": "PASSED"},
                         {"target": "FAILED", "regression": "FAILED"},
                         {"target": "SKIPPED", "regression": "PASSED"}):
            with self.subTest(statuses=statuses), self.assertRaises(ValueError):
                self.check(statuses=statuses)

    def test_gold_requires_official_resolution_and_all_test_observations(self):
        self.report["example"]["resolved"] = True
        self.statuses["target"] = "PASSED"
        self.assertTrue(self.check("gold")["resolved"])
        with self.assertRaises(ValueError):
            self.check("gold", statuses={"regression": "PASSED"})
        with self.assertRaises(ValueError):
            self.check("base")

    def test_missing_misattributed_or_failed_application_is_not_a_negative_control(self):
        for report in ({}, {"different": self.report["example"]},
                       {"example": {"resolved": False}},
                       {"example": {"resolved": False, "patch_successfully_applied": False}}):
            with self.subTest(report=report), self.assertRaises(ValueError):
                self.check(report=report)

    def test_altered_cohort_rejected_before_reading_task_rows(self):
        with self.assertRaises(ValueError):
            smoke_rows({"fingerprint": "0" * 64}, [])

    def test_only_exact_smoke_rows_are_projected_from_the_frozen_pool(self):
        rows = [{"instance_id": name, "base_commit": "a" * 40, "repo": "org/repo",
                 "problem_statement": "problem " + name} for name in ("first", "second", "reserved")]
        cohort = {"parquetSha256": PARQUET_HASH, "selected": [
            {"instanceId": row["instance_id"], "baseCommit": row["base_commit"], "repo": row["repo"],
             "phase": "assessment" if row["instance_id"] == "reserved" else "smoke",
             "problemFingerprint": digest(canonical(row["problem_statement"]).encode())}
            for row in rows]}
        fingerprint = digest(canonical(cohort).encode())
        cohort["fingerprint"] = fingerprint
        with patch("swebench_smoke.COHORT_HASH", fingerprint):
            self.assertEqual([row["instance_id"] for row in smoke_rows(cohort, rows)], ["first", "second"])
            for key in ("base_commit", "repo", "problem_statement"):
                changed = copy.deepcopy(rows)
                changed[0][key] = "altered"
                with self.subTest(key=key), self.assertRaises(ValueError):
                    smoke_rows(cohort, changed)
            with self.assertRaises(ValueError):
                smoke_rows(cohort, [*rows, rows[0]])
            changed = copy.deepcopy(cohort)
            changed["selected"][0]["phase"] = "assessment"
            with self.assertRaises(ValueError):
                smoke_rows(changed, rows)


if __name__ == "__main__":
    unittest.main()
