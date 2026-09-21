# tests/test_gate_legacy.py
"""Sign-off gate: pre-AICT ("papertrail") marker projects must deny LOUDLY.

find_project_root fails OPEN by design — an unrecognized marker returns None
and every gate that rides it stops firing, silently. The AICT rename dropped
the papertrail markers, so without the LEGACY path a student repo initialized
before the rename would run with no sign-off gate and no immutability
enforcement, and nothing would say so. These tests pin that it denies instead.

Run: python3 -m unittest tests.test_gate_legacy -v
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GATE = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts" / "signoff_gate.py"
)

LEGACY_MASTER = "<!-- papertrail:master-plan -->"
LEGACY_CLAUDE = "<!-- papertrail:start -->"
AICT_MASTER = "<!-- aict:master-plan -->"
AICT_CLAUDE = "<!-- aict:start -->"


def make_repo(master_marker, claude_marker):
    """A repo with a finalized bundle, an archive, and a signed plan version."""
    root = Path(tempfile.mkdtemp())
    plans = root / "plans"
    rdir = plans / "execution" / "02-analysis" / "results" / "r1"
    rdir.mkdir(parents=True)
    (rdir / "report.md").write_text("# R\n", encoding="utf-8")
    (plans / "execution" / "02-analysis" / "v1.md").write_text(
        "# v1\n", encoding="utf-8")
    (plans / "archive").mkdir()
    (plans / "archive" / "master-plan-2026-01-01.md").write_text(
        "# old\n", encoding="utf-8")
    (plans / "master-plan.md").write_text(
        master_marker + "\n# MP\n", encoding="utf-8")
    if claude_marker is not None:
        (root / "CLAUDE.md").write_text(
            claude_marker + "\nconventions\n", encoding="utf-8")
    return root


def run_gate(root, tool, path):
    event = {"tool_name": tool, "cwd": str(root),
             "tool_input": {"file_path": str(path), "content": "x"}}
    p = subprocess.run([sys.executable, str(GATE)], input=json.dumps(event),
                       capture_output=True, text=True, timeout=30)
    if not p.stdout.strip():
        return None, None
    out = json.loads(p.stdout)["hookSpecificOutput"]
    return out["permissionDecision"], out["permissionDecisionReason"]


class TestLegacyMarkersDenyLoudly(unittest.TestCase):
    """A papertrail-era repo must never slip through as 'not an AICT project'."""

    def assert_migration_denial(self, decision, reason):
        self.assertEqual(decision, "deny")
        self.assertIn("/aict:init", reason)
        self.assertIn("papertrail", reason)

    def test_finalized_bundle_edit_denied_with_migration_notice(self):
        root = make_repo(LEGACY_MASTER, LEGACY_CLAUDE)
        target = (root / "plans" / "execution" / "02-analysis"
                  / "results" / "r1" / "report.md")
        self.assert_migration_denial(*run_gate(root, "Edit", target))

    def test_archived_master_plan_edit_denied_with_migration_notice(self):
        root = make_repo(LEGACY_MASTER, LEGACY_CLAUDE)
        target = root / "plans" / "archive" / "master-plan-2026-01-01.md"
        self.assert_migration_denial(*run_gate(root, "Edit", target))

    def test_signed_version_edit_denied_with_migration_notice(self):
        root = make_repo(LEGACY_MASTER, LEGACY_CLAUDE)
        target = root / "plans" / "execution" / "02-analysis" / "v1.md"
        self.assert_migration_denial(*run_gate(root, "Edit", target))

    def test_legacy_claude_marker_alone_still_denies(self):
        """Half-migrated: master plan updated, CLAUDE.md not."""
        root = make_repo(AICT_MASTER, LEGACY_CLAUDE)
        target = root / "plans" / "execution" / "02-analysis" / "v1.md"
        self.assert_migration_denial(*run_gate(root, "Edit", target))


class TestCurrentAndAbsentMarkersUnchanged(unittest.TestCase):
    """The legacy path must not disturb the two existing outcomes."""

    def test_aict_markers_get_the_ordinary_immutability_denial(self):
        root = make_repo(AICT_MASTER, AICT_CLAUDE)
        target = (root / "plans" / "execution" / "02-analysis"
                  / "results" / "r1" / "report.md")
        decision, reason = run_gate(root, "Edit", target)
        self.assertEqual(decision, "deny")
        self.assertIn("immutable", reason)
        self.assertNotIn("/aict:init", reason)

    def test_no_markers_passes_through(self):
        root = make_repo("# not an AICT project", None)
        target = (root / "plans" / "execution" / "02-analysis"
                  / "results" / "r1" / "report.md")
        decision, _ = run_gate(root, "Edit", target)
        self.assertIsNone(decision)


if __name__ == "__main__":
    unittest.main()
