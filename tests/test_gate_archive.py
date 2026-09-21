# tests/test_gate_archive.py
"""Sign-off gate: archived-master-plan immutability branch (v0.10). Run:
    python3 -m unittest tests.test_gate_archive -v
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


def make_initialized(root: Path, with_archive=True):
    plans = root / "plans"
    (plans / "execution").mkdir(parents=True)
    (plans / "master-plan.md").write_text(
        "<!-- aict:master-plan -->\n# MP\n", encoding="utf-8")
    (root / "CLAUDE.md").write_text(
        "<!-- aict:start -->\nconventions\n", encoding="utf-8")
    arch = plans / "archive"
    arch.mkdir()
    if with_archive:
        (arch / "master-plan-2026-07-01.md").write_text(
            "<!-- aict:master-plan -->\n# Old MP\n", encoding="utf-8")
    return arch


def run_gate(root, tool, path, content="x"):
    event = {"tool_name": tool, "cwd": str(root),
             "tool_input": {"file_path": str(path), "content": content}}
    p = subprocess.run([sys.executable, str(GATE)], input=json.dumps(event),
                       capture_output=True, text=True, timeout=30)
    decision = None
    if p.stdout.strip():
        decision = json.loads(p.stdout)["hookSpecificOutput"]["permissionDecision"]
    return p.returncode, decision


class TestGateArchive(unittest.TestCase):
    def test_edit_existing_archive_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            arch = make_initialized(Path(tmp))
            code, decision = run_gate(
                tmp, "Edit", arch / "master-plan-2026-07-01.md")
            self.assertEqual((code, decision), (0, "deny"))

    def test_overwrite_existing_archive_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            arch = make_initialized(Path(tmp))
            code, decision = run_gate(
                tmp, "Write", arch / "master-plan-2026-07-01.md")
            self.assertEqual((code, decision), (0, "deny"))

    def test_create_new_archive_not_gated(self):
        with tempfile.TemporaryDirectory() as tmp:
            arch = make_initialized(Path(tmp))
            code, decision = run_gate(
                tmp, "Write", arch / "master-plan-2026-07-09.md")
            self.assertEqual((code, decision), (0, None))

    def test_uninitialized_project_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            arch = root / "plans" / "archive"
            arch.mkdir(parents=True)
            (arch / "master-plan-2026-07-01.md").write_text("# Old\n",
                                                            encoding="utf-8")
            # no markers anywhere → the gate stays out of it
            code, decision = run_gate(
                tmp, "Edit", arch / "master-plan-2026-07-01.md")
            self.assertEqual((code, decision), (0, None))


if __name__ == "__main__":
    unittest.main()
