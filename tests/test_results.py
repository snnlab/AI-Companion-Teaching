# tests/test_results.py
"""Tests for results.py bundle mechanics. Run:
    python3 -m unittest tests.test_results -v
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
RESULTS = SCRIPTS / "results.py"
sys.path.insert(0, str(SCRIPTS))
import results  # noqa: E402

DEFAULT_PROFILE = (SCRIPTS.parent / "templates" / "model-profile.md").read_text(encoding="utf-8")


def make_project(root: Path):
    plans = root / "plans"
    (plans / "execution" / "02-analysis").mkdir(parents=True)
    (plans / "master-plan.md").write_text(
        "<!-- aict:master-plan -->\n# T — Master Plan\n\n"
        "## Components\n\n"
        "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n"
        "|---|-----------|--------|----------------|-----------------|--------|\n"
        "| 1 | Analysis | done | [v1](execution/02-analysis/v1.md) | — | — |\n",
        encoding="utf-8",
    )
    (plans / "execution" / "02-analysis" / "v1.md").write_text(
        "# Analysis — Execution Plan v1\n\n## Goal and success criteria\n\nG.\n",
        encoding="utf-8",
    )
    out = root / "output"
    out.mkdir()
    (out / "fig1.png").write_bytes(b"\x89PNG fake image bytes")
    (out / "table1.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    code = root / "code"
    code.mkdir()
    (code / "03_model.R").write_text("lm(y ~ x)\n", encoding="utf-8")
    return plans


def run_cli(cwd, *argv):
    return subprocess.run(
        [sys.executable, str(RESULTS), *argv],
        capture_output=True, text=True, cwd=str(cwd), timeout=60,
    )


def manifest_for(staging: Path, component="02-analysis", version=1, entries=None):
    return {
        "schemaVersion": 1,
        "component": component,
        "resultsVersion": version,
        "planVersion": 1,
        "provenance": "planned",
        "trigger": "initial",
        "capturedAt": "2026-07-03 12:00",
        "summary": "test bundle",
        "metrics": [{"label": "N", "value": "10"}],
        "artifacts": entries or [],
    }


class TestStageCopyFinalize(unittest.TestCase):
    def _stage(self, root):
        p = run_cli(root, "stage", "--component", "02-analysis")
        self.assertEqual(p.returncode, 0, p.stderr)
        staging = Path(p.stdout.strip())
        self.assertTrue(staging.is_dir())
        self.assertTrue(staging.name.startswith(".staging-"))
        self.assertTrue((staging / "artifacts").is_dir())
        self.assertTrue((staging / "scripts").is_dir())
        return staging

    def test_stage_copy_finalize_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            p = run_cli(root, "copy", "--staging", str(staging),
                        "--into", "artifacts", "output/fig1.png", "output/table1.csv")
            self.assertEqual(p.returncode, 0, p.stderr)
            recs = json.loads(p.stdout)
            self.assertEqual(recs[0]["file"], "artifacts/fig1.png")
            self.assertFalse(recs[0]["oversized"])
            self.assertEqual(recs[0]["sha256"],
                             results.sha256_file(root / "output" / "fig1.png"))
            p2 = run_cli(root, "copy", "--staging", str(staging),
                         "--into", "scripts", "code/03_model.R")
            self.assertEqual(p2.returncode, 0, p2.stderr)
            arts = [
                {"id": "fig", "kind": "figure", "title": "F",
                 "file": "artifacts/fig1.png",
                 "source": {"path": "output/fig1.png",
                            "sha256": recs[0]["sha256"],
                            "bytes": recs[0]["bytes"], "oversized": False},
                 "producedBy": {"script": "scripts/03_model.R",
                                "sourcePath": "code/03_model.R", "lang": "r"}},
            ]
            (staging / "manifest.json").write_text(
                json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
            (staging / "report.md").write_text("# Report\n\nDone.\n", encoding="utf-8")
            p3 = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p3.returncode, 0, p3.stderr)
            out = json.loads(p3.stdout)
            self.assertEqual(out["resultsVersion"], 1)
            r1 = root / "plans" / "execution" / "02-analysis" / "results" / "r1"
            self.assertTrue((r1 / "manifest.json").is_file())
            self.assertTrue((r1 / "artifacts" / "fig1.png").is_file())

    def test_finalize_tolerates_agent_curated_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            manifest = manifest_for(staging)
            manifest["curatedBy"] = "agent"
            (staging / "manifest.json").write_text(
                json.dumps(manifest), encoding="utf-8")
            (staging / "report.md").write_text("# Report\n", encoding="utf-8")

            finalized = run_cli(root, "finalize", "--staging", str(staging))

            self.assertEqual(finalized.returncode, 0, finalized.stderr)
            saved = json.loads((
                root / "plans" / "execution" / "02-analysis" /
                "results" / "r1" / "manifest.json"
            ).read_text(encoding="utf-8"))
            self.assertEqual(saved["curatedBy"], "agent")
            self.assertFalse(staging.exists())

    def test_finalize_numbers_sequentially(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            for expected in (1, 2):
                staging = self._stage(root)
                (staging / "manifest.json").write_text(
                    json.dumps(manifest_for(staging, version=99)), encoding="utf-8")
                (staging / "report.md").write_text("# R\n", encoding="utf-8")
                p = run_cli(root, "finalize", "--staging", str(staging))
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertEqual(json.loads(p.stdout)["resultsVersion"], expected)
            # finalize rewrote the manifest's resultsVersion to the real number
            m = json.loads((root / "plans" / "execution" / "02-analysis" /
                            "results" / "r2" / "manifest.json").read_text())
            self.assertEqual(m["resultsVersion"], 2)

    def test_finalize_rejects_missing_artifact_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            arts = [{"id": "x", "kind": "figure", "title": "X",
                     "file": "artifacts/nope.png",
                     "source": {"path": "output/nope.png", "sha256": "0" * 64,
                                "bytes": 1, "oversized": False},
                     "producedBy": None}]
            (staging / "manifest.json").write_text(
                json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
            (staging / "report.md").write_text("# R\n", encoding="utf-8")
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("nope.png", p.stderr)

    def test_finalize_rejects_missing_manifest_or_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._stage(root)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)

    def test_copy_applies_size_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            big = root / "output" / "big.png"
            big.write_bytes(b"\0" * (results.MAX_BYTES + 1))
            staging = self._stage(root)
            p = run_cli(root, "copy", "--staging", str(staging),
                        "--into", "artifacts", "output/big.png")
            rec = json.loads(p.stdout)[0]
            self.assertIsNone(rec["file"])
            self.assertTrue(rec["oversized"])
            self.assertFalse((staging / "artifacts" / "big.png").exists())


class TestDiscoverVerdictChanged(unittest.TestCase):
    def test_discover_lists_outputs_excludes_plans(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            r1 = root / "plans" / "execution" / "02-analysis" / "results" / "r1" / "artifacts"
            r1.mkdir(parents=True)
            (r1 / "old.png").write_bytes(b"x")
            p = run_cli(root, "discover")
            self.assertEqual(p.returncode, 0, p.stderr)
            paths = [e["path"] for e in json.loads(p.stdout)]
            self.assertIn("output/fig1.png", paths)
            self.assertIn("output/table1.csv", paths)
            self.assertFalse(any(x.startswith("plans/") for x in paths))

    def _finalized(self, root):
        p = run_cli(root, "stage", "--component", "02-analysis")
        staging = Path(p.stdout.strip())
        p = run_cli(root, "copy", "--staging", str(staging),
                    "--into", "artifacts", "output/fig1.png")
        rec = json.loads(p.stdout)[0]
        arts = [{"id": "fig", "kind": "figure", "title": "F",
                 "file": "artifacts/fig1.png",
                 "source": {"path": "output/fig1.png", "sha256": rec["sha256"],
                            "bytes": rec["bytes"], "oversized": False},
                 "producedBy": None}]
        (staging / "manifest.json").write_text(
            json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
        (staging / "report.md").write_text("# R\n", encoding="utf-8")
        run_cli(root, "finalize", "--staging", str(staging))

    def test_verdict_written_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            self._finalized(root)
            p = run_cli(root, "verdict", "--component", "02-analysis",
                        "--version", "1", "--status", "accepted",
                        "--reviewer", "BK", "--plan-version", "1")
            self.assertEqual(p.returncode, 0, p.stderr)
            vp = (root / "plans" / "execution" / "02-analysis" / "results" /
                  "r1" / "verdict.json")
            doc = json.loads(vp.read_text())
            self.assertEqual(doc["status"], "accepted")
            self.assertEqual(doc["reviewer"], "BK")
            p2 = run_cli(root, "verdict", "--component", "02-analysis",
                         "--version", "1", "--status", "accepted",
                         "--reviewer", "BK")
            self.assertEqual(p2.returncode, 1)
            self.assertIn("once", p2.stderr)

    def test_changed_detects_source_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            self._finalized(root)
            p = run_cli(root, "changed", "--component", "02-analysis")
            self.assertEqual(json.loads(p.stdout)["changed"], [])
            (root / "output" / "fig1.png").write_bytes(b"different bytes")
            p2 = run_cli(root, "changed", "--component", "02-analysis")
            out = json.loads(p2.stdout)
            self.assertEqual(out["latest"], 1)
            self.assertEqual(out["changed"][0]["path"], "output/fig1.png")


class TestDiscoverBroaden(unittest.TestCase):
    def test_discover_finds_broadened_default_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            (root / "plots").mkdir()
            (root / "plots" / "p.png").write_bytes(b"x")
            (root / "viz").mkdir()
            (root / "viz" / "v.svg").write_text("<svg/>", encoding="utf-8")
            p = run_cli(root, "discover")
            self.assertEqual(p.returncode, 0, p.stderr)
            paths = [e["path"] for e in json.loads(p.stdout)]
            self.assertIn("plots/p.png", paths)
            self.assertIn("viz/v.svg", paths)

    def test_discover_dir_adds_repo_relative_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            (root / "custom" / "sub").mkdir(parents=True)
            (root / "custom" / "sub" / "c.png").write_bytes(b"x")
            p0 = run_cli(root, "discover")
            self.assertNotIn("custom/sub/c.png",
                             [e["path"] for e in json.loads(p0.stdout)])
            p = run_cli(root, "discover", "--dir", "custom")
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn("custom/sub/c.png",
                          [e["path"] for e in json.loads(p.stdout)])

    def test_discover_dir_rejects_absolute(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            p = run_cli(root, "discover", "--dir", "/tmp")
            self.assertEqual(p.returncode, 1)
            self.assertIn("--dir", p.stderr)

    def test_discover_dir_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            p = run_cli(root, "discover", "--dir", "../escape")
            self.assertEqual(p.returncode, 1)

    def test_discover_dir_rejects_symlink_escape(self):
        with tempfile.TemporaryDirectory() as tmp, \
                tempfile.TemporaryDirectory() as outside:
            root = Path(tmp)
            make_project(root)
            target = Path(outside) / "secret"
            target.mkdir()
            (target / "s.png").write_bytes(b"x")
            (root / "link").symlink_to(target)
            p = run_cli(root, "discover", "--dir", "link")
            self.assertEqual(p.returncode, 1)


class TestXlsxDiscovery(unittest.TestCase):
    def test_discover_surfaces_xlsx(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            (root / "output" / "estimates.xlsx").write_bytes(b"PK fake xlsx")
            p = run_cli(root, "discover")
            self.assertEqual(p.returncode, 0, p.stderr)
            paths = [e["path"] for e in json.loads(p.stdout)]
            self.assertIn("output/estimates.xlsx", paths)


class TestTexDataFields(unittest.TestCase):
    """Table artifacts may carry tex/data source files (v0.10) — finalize
    requires them to exist in the staging dir when declared."""

    def _staged_with_table(self, root, tex=True, data=True, declare=True):
        p = run_cli(root, "stage", "--component", "02-analysis")
        staging = Path(p.stdout.strip())
        (root / "output" / "table1.png").write_bytes(b"\x89PNG table render")
        (root / "output" / "table1.tex").write_text(
            "\\begin{tabular}\\end{tabular}\n", encoding="utf-8")
        sources = ["output/table1.png", "output/table1.csv", "output/table1.tex"]
        p = run_cli(root, "copy", "--staging", str(staging),
                    "--into", "artifacts", *sources)
        recs = {Path(r["path"]).name: r for r in json.loads(p.stdout)}
        art = {"id": "tbl", "kind": "table", "title": "T",
               "file": "artifacts/table1.png",
               "source": {"path": "output/table1.png",
                          "sha256": recs["table1.png"]["sha256"],
                          "bytes": recs["table1.png"]["bytes"],
                          "oversized": False},
               "producedBy": None}
        if declare:
            if tex:
                art["tex"] = "artifacts/table1.tex"
            if data:
                art["data"] = "artifacts/table1.csv"
        (staging / "manifest.json").write_text(
            json.dumps(manifest_for(staging, entries=[art])), encoding="utf-8")
        (staging / "report.md").write_text("# R\n", encoding="utf-8")
        return staging

    def test_finalize_accepts_present_tex_and_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged_with_table(root)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 0, p.stderr)

    def test_finalize_rejects_missing_tex_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged_with_table(root)
            (staging / "artifacts" / "table1.tex").unlink()
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("tex", p.stderr)

    def test_finalize_rejects_missing_data_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged_with_table(root)
            (staging / "artifacts" / "table1.csv").unlink()
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("data", p.stderr)


VALID_VALIDATION = {
    "status": "conforms-with-amendments",
    "validatedAt": "2026-07-09 12:00",
    "planVersion": 1,
    "validator": "subagent",
    "steps": [
        {"planStep": "build panel", "verdict": "followed", "evidence": "03_model.R ran"},
        {"planStep": "add controls", "verdict": "amended", "evidence": "v2 supersedes"},
    ],
    "criteria": [
        {"criterion": "model converges", "verdict": "met", "evidence": "log line 40"},
    ],
    "notes": "",
}


class TestValidationBlock(unittest.TestCase):
    def _staged(self, root, validation, write_validation_md):
        p = run_cli(root, "stage", "--component", "02-analysis")
        staging = Path(p.stdout.strip())
        manifest = manifest_for(staging)
        if validation is not None:
            manifest["validation"] = validation
        (staging / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8")
        (staging / "report.md").write_text("# R\n", encoding="utf-8")
        if write_validation_md:
            (staging / "validation.md").write_text(
                "# Validation\n\nconforms-with-amendments\n", encoding="utf-8")
        return staging

    def test_valid_block_with_validation_md_finalizes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged(root, VALID_VALIDATION, True)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 0, p.stderr)

    def test_invalid_status_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged(root, {"status": "nonsense"}, True)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("status", p.stderr)

    def test_invalid_step_verdict_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            bad = dict(VALID_VALIDATION,
                       steps=[{"planStep": "x", "verdict": "sorta-did-it"}])
            staging = self._staged(root, bad, True)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("verdict", p.stderr)

    def test_real_verdict_requires_validation_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged(root, VALID_VALIDATION, False)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 1)
            self.assertIn("validation.md", p.stderr)

    def test_skipped_status_needs_no_validation_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged(
                root, {"status": "skipped", "reason": "headless"}, False)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 0, p.stderr)

    def test_absent_validation_still_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            staging = self._staged(root, None, False)
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 0, p.stderr)


class TestFinalizeProvenance(unittest.TestCase):
    def _stage_and_finalize(self, root, *extra, profile=True):
        if profile:
            (root / "plans" / "model-profile.md").write_text(DEFAULT_PROFILE, encoding="utf-8")
        p = run_cli(root, "stage", "--component", "02-analysis")
        staging = Path(p.stdout.strip())
        (staging / "manifest.json").write_text(json.dumps(manifest_for(staging)), encoding="utf-8")
        (staging / "report.md").write_text("# Report\n", encoding="utf-8")
        p2 = run_cli(root, "finalize", "--staging", str(staging), *extra)
        self.assertEqual(p2.returncode, 0, p2.stderr)
        r1 = root / "plans" / "execution" / "02-analysis" / "results" / "r1"
        return json.loads((r1 / "manifest.json").read_text())

    def test_prescribed_from_execute_stage_and_reported_from_arg(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            m = self._stage_and_finalize(root, "--reported-model", "claude-opus-4-8")
            self.assertEqual(m["modelUsage"]["prescribed"], {"model": "sonnet", "effort": None})
            self.assertEqual(m["modelUsage"]["reported"], {"model": "claude-opus-4-8", "effort": None})

    def test_prescribed_only_when_no_reported_arg(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            m = self._stage_and_finalize(root)
            self.assertEqual(m["modelUsage"]["prescribed"], {"model": "sonnet", "effort": None})
            self.assertIsNone(m["modelUsage"]["reported"])

    def test_no_modelusage_when_no_profile(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            m = self._stage_and_finalize(root, profile=False)
            self.assertNotIn("modelUsage", m)

    def test_reported_only_when_no_profile_but_arg_given(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            m = self._stage_and_finalize(root, "--reported-model", "sonnet", profile=False)
            self.assertIsNone(m["modelUsage"]["prescribed"])
            self.assertEqual(m["modelUsage"]["reported"], {"model": "sonnet", "effort": None})

    def test_profile_read_error_is_advisory_but_visible(self):
        import contextlib
        import io
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); make_project(root)
            p = run_cli(root, "stage", "--component", "02-analysis")
            staging = Path(p.stdout.strip())
            (staging / "manifest.json").write_text(
                json.dumps(manifest_for(staging)), encoding="utf-8")
            (staging / "report.md").write_text("# Report\n", encoding="utf-8")
            original = results.models.load_profile
            results.models.load_profile = lambda *_args: (_ for _ in ()).throw(
                OSError("profile unreadable"))
            self.addCleanup(setattr, results.models, "load_profile", original)
            stderr = io.StringIO()

            with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
                results.cmd_finalize(
                    root, SimpleNamespace(staging=str(staging), reported_model="sonnet"))

            manifest = json.loads((root / "plans" / "execution" / "02-analysis" /
                                   "results" / "r1" / "manifest.json").read_text())
            self.assertIsNone(manifest["modelUsage"]["prescribed"])
            self.assertIn("profile unreadable", stderr.getvalue())


class TestSubstantiveFindings(unittest.TestCase):
    def test_is_substantive_rule(self):
        yes = [
            {"label": "a", "value": "1", "status": "robust"},
            {"label": "a", "value": "1", "status": "marginal"},
            {"label": "a", "value": "1", "statement": "Effect is positive."},
        ]
        no = [
            {"label": "a", "value": "1", "status": "descriptive", "statement": "Count is 10."},
            {"label": "a", "value": "1", "status": "retracted", "statement": "x"},
            {"label": "a", "value": "1", "status": "superseded", "statement": "x"},
            {"label": "a", "value": "1"},
            {"label": "a", "value": "1", "statement": "   "},
        ]
        for mt in yes:
            self.assertTrue(results.is_substantive(mt), mt)
        for mt in no:
            self.assertFalse(results.is_substantive(mt), mt)

    def test_has_substantive_findings(self):
        self.assertTrue(results.has_substantive_findings(
            {"metrics": [{"label": "x", "value": "1"}, {"label": "y", "value": "2", "status": "robust"}]}))
        self.assertFalse(results.has_substantive_findings(
            {"metrics": [{"label": "x", "value": "1", "status": "descriptive", "statement": "c"}]}))
        self.assertFalse(results.has_substantive_findings({"metrics": []}))
        self.assertFalse(results.has_substantive_findings({}))


class TestIntegrity(unittest.TestCase):
    def _staging_with_fig(self, tmp):
        staging = Path(tmp)
        (staging / "artifacts").mkdir()
        f = staging / "artifacts" / "fig.png"
        f.write_bytes(b"fake image bytes")
        return staging, results.sha256_file(f)

    def test_all_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging, sha = self._staging_with_fig(tmp)
            manifest = {
                "metrics": [{"label": "N", "value": "1", "status": "robust",
                             "artifactIds": ["fig"]}],
                "artifacts": [{"id": "fig", "file": "artifacts/fig.png",
                               "source": {"sha256": sha}}],
            }
            integ = results.compute_integrity(manifest, staging, now="2026-07-13 10:00")
            self.assertEqual(integ["status"], "passed")
            self.assertEqual(integ["checkedAt"], "2026-07-13 10:00")
            verdicts = {c["name"]: c["verdict"] for c in integ["checks"]}
            self.assertEqual(verdicts, {"checksums": "pass", "artifacts-present": "pass",
                                        "artifact-refs": "pass", "findings-sourced": "pass"})

    def test_flags_unsourced_substantive_finding(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging, _ = self._staging_with_fig(tmp)
            manifest = {  # robust finding with no artifactIds
                "metrics": [{"label": "Effect", "value": "0.3", "status": "robust"}],
                "artifacts": [],
            }
            integ = results.compute_integrity(manifest, staging, now="t")
            self.assertEqual(integ["status"], "failed")
            fs = next(c for c in integ["checks"] if c["name"] == "findings-sourced")
            self.assertEqual(fs["verdict"], "fail")
            self.assertIn("Effect", fs["detail"])

    def test_descriptive_metric_need_not_be_sourced(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging, _ = self._staging_with_fig(tmp)
            manifest = {  # descriptive count is not substantive → not required to source
                "metrics": [{"label": "N", "value": "1234", "status": "descriptive"}],
                "artifacts": [],
            }
            integ = results.compute_integrity(manifest, staging, now="t")
            self.assertEqual(integ["status"], "passed")

    def test_missing_sha256_is_a_checksum_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging, _ = self._staging_with_fig(tmp)
            manifest = {  # artifact present but no recorded sha256 → cannot verify
                "metrics": [],
                "artifacts": [{"id": "fig", "file": "artifacts/fig.png", "source": {}}],
            }
            integ = results.compute_integrity(manifest, staging, now="t")
            cs = next(c for c in integ["checks"] if c["name"] == "checksums")
            self.assertEqual(cs["verdict"], "fail")
            self.assertEqual(integ["status"], "failed")

    def test_flags_dangling_artifact_ref(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging, sha = self._staging_with_fig(tmp)
            manifest = {
                "metrics": [{"label": "N", "value": "1", "status": "robust",
                             "artifactIds": ["ghost"]}],
                "artifacts": [{"id": "fig", "file": "artifacts/fig.png",
                               "source": {"sha256": sha}}],
            }
            integ = results.compute_integrity(manifest, staging, now="t")
            refs = next(c for c in integ["checks"] if c["name"] == "artifact-refs")
            self.assertEqual(refs["verdict"], "fail")
            self.assertEqual(integ["status"], "failed")

    def test_finalize_seals_integrity_into_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            p = run_cli(root, "stage", "--component", "02-analysis")
            staging = Path(p.stdout.strip())
            p = run_cli(root, "copy", "--staging", str(staging),
                        "--into", "artifacts", "output/fig1.png")
            rec = json.loads(p.stdout)[0]
            arts = [{"id": "fig", "kind": "figure", "title": "F",
                     "file": "artifacts/fig1.png",
                     "source": {"path": "output/fig1.png", "sha256": rec["sha256"],
                                "bytes": rec["bytes"], "oversized": False},
                     "producedBy": None}]
            (staging / "manifest.json").write_text(
                json.dumps(manifest_for(staging, entries=arts)), encoding="utf-8")
            (staging / "report.md").write_text("# R\n", encoding="utf-8")
            p = run_cli(root, "finalize", "--staging", str(staging))
            self.assertEqual(p.returncode, 0, p.stderr)
            doc = json.loads((root / "plans" / "execution" / "02-analysis" /
                              "results" / "r1" / "manifest.json").read_text())
            self.assertIn("integrity", doc)
            self.assertEqual(doc["integrity"]["status"], "passed")
            self.assertTrue(any(c["name"] == "findings-sourced"
                                for c in doc["integrity"]["checks"]))

    def test_validate_staged_accepts_sealed_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging, sha = self._staging_with_fig(tmp)
            (staging / "report.md").write_text("# R\n", encoding="utf-8")
            base = {"component": "02-analysis", "provenance": "planned",
                    "trigger": "initial", "capturedAt": "t",
                    "metrics": [], "artifacts": []}
            good = dict(base, integrity={"status": "passed", "checkedAt": "t",
                                         "checks": [{"name": "checksums", "verdict": "pass"}]})
            (staging / "manifest.json").write_text(json.dumps(good), encoding="utf-8")
            m, err = results.validate_staged(staging)
            self.assertIsNone(err, err)
            bad = dict(base, integrity={"status": "bogus", "checks": []})
            (staging / "manifest.json").write_text(json.dumps(bad), encoding="utf-8")
            m, err = results.validate_staged(staging)
            self.assertIsNotNone(err)
            self.assertIn("integrity", err)




class TestResultsCommandDocs(unittest.TestCase):
    def test_adopt_reconcile_and_regeneration_route_to_reference(self):
        repo = Path(__file__).resolve().parents[1]
        command = (repo / "commands" / "results.md").read_text(encoding="utf-8")
        reference = (repo / "skills" / "managing-aict" / "references" /
                     "results-adopt.md").read_text(encoding="utf-8")

        self.assertIn("references/results-adopt.md", command)
        for heading in ("Adopt existing results", "Reconcile missing results",
                        "Regeneration and run recipes", "Summary-only bundles"):
            self.assertIn(heading, command)
            self.assertIn(heading, reference)
        self.assertNotIn("8. **Adopt mode", command)
        self.assertNotIn("9. **Reconcile mode", command)
        self.assertNotIn("## Regeneration,", command)
        self.assertIn("inline steps 4 through 7", reference)
        self.assertIn("inline steps 2 through 7", reference)
        for field in ("`command`", "`cwd`", "`args`", "`expectedOutputs`",
                      "`approvedHash`"):
            self.assertIn(field, reference)


if __name__ == "__main__":
    unittest.main()
