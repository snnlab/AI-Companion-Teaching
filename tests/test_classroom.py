# tests/test_classroom.py
"""Tests for classroom.py (shared classroom-server client state: config,
pulled-comment-id tracking) — split out of test_submit.py when the
functions themselves moved out of submit.py into their own module, shared
with check.py. Run:
    python3 -m unittest tests.test_classroom -v
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import classroom  # noqa: E402
import board  # noqa: E402


def make_project(root: Path):
    plans = root / "plans"
    (plans / "execution" / "01-data-prep").mkdir(parents=True)
    (plans / "master-plan.md").write_text(
        "<!-- aict:master-plan -->\n# Test — Master Plan\n\n"
        "## Components\n\n"
        "| # | Analysis step | Status | Execution plan | Outcome / notes | Serves |\n"
        "|---|-----------|--------|----------------|-----------------|--------|\n"
        "| 1 | Data prep | in progress | — | — | — |\n",
        encoding="utf-8",
    )
    return plans


class TestClassroomConfig(unittest.TestCase):
    def setUp(self):
        self._orig_data = os.environ.get("CLAUDE_PLUGIN_DATA")

    def tearDown(self):
        if self._orig_data is None:
            os.environ.pop("CLAUDE_PLUGIN_DATA", None)
        else:
            os.environ["CLAUDE_PLUGIN_DATA"] = self._orig_data

    def test_round_trips(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            cfg = {"serverUrl": "https://cls.example.edu", "token": "tok-abc",
                   "courseId": "SOC601"}
            classroom.write_classroom_config(root, cfg)
            got = classroom.read_classroom_config(root)
            self.assertEqual(got, cfg)

    def test_missing_config_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data" / "empty")
            self.assertIsNone(classroom.read_classroom_config(root))

    def test_distinct_path_from_web_config(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            web_path = board.web_config_path(root)
            classroom_path = classroom.classroom_config_path(root)
            self.assertNotEqual(str(web_path), str(classroom_path))
            self.assertIn("web", web_path.parts)
            self.assertIn("classroom", classroom_path.parts)
            # same project-hash filename, different namespace directory
            self.assertEqual(web_path.name, classroom_path.name)

    def test_classroom_config_does_not_leak_into_web_config(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            classroom.write_classroom_config(
                root, {"serverUrl": "https://cls.example.edu", "token": "t",
                       "courseId": None})
            self.assertIsNone(board.read_web_config(root))
            board.write_web_config(
                root, {"url": "https://board.example.vercel.app",
                       "projectName": "p", "pullKey": "k"})
            cfg = classroom.read_classroom_config(root)
            self.assertIsNotNone(cfg)
            self.assertEqual(cfg["serverUrl"], "https://cls.example.edu")

    def test_written_file_is_mode_0600(self):
        if os.name == "nt":
            self.skipTest("POSIX file-mode bits are not meaningful on Windows")
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            classroom.write_classroom_config(
                root, {"serverUrl": "https://cls.example.edu", "token": "t",
                       "courseId": None})
            mode = classroom.classroom_config_path(root).stat().st_mode & 0o777
            self.assertEqual(mode, 0o600)


class TestPulledCommentIds(unittest.TestCase):
    def setUp(self):
        self._orig_data = os.environ.get("CLAUDE_PLUGIN_DATA")

    def tearDown(self):
        if self._orig_data is None:
            os.environ.pop("CLAUDE_PLUGIN_DATA", None)
        else:
            os.environ["CLAUDE_PLUGIN_DATA"] = self._orig_data

    def test_round_trips_and_is_a_flat_set(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            self.assertEqual(classroom.read_pulled_comment_ids(root), set())
            classroom.write_pulled_comment_ids(root, {"c1", "c2"})
            self.assertEqual(classroom.read_pulled_comment_ids(root), {"c1", "c2"})
            # ids from different shareHashes coexist in the same flat set —
            # no shareHash-keyed structure, unlike the old seen_comments.json.
            classroom.write_pulled_comment_ids(root, {"c1", "c2", "c3"})
            self.assertEqual(classroom.read_pulled_comment_ids(root), {"c1", "c2", "c3"})

    def test_distinct_from_config_path(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            self.assertNotEqual(
                str(classroom.pulled_comments_path(root)),
                str(classroom.classroom_config_path(root)),
            )

    def test_migrates_legacy_seen_comments_when_pulled_file_absent(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            legacy = classroom._legacy_seen_comments_path(root)
            legacy.parent.mkdir(parents=True, exist_ok=True)
            # old {shareHash: [id, ...]} shape, ids spread across two submissions
            legacy.write_text(json.dumps({"sh1": ["c1", "c2"], "sh2": ["c3"]}))
            self.assertEqual(
                classroom.read_pulled_comment_ids(root), {"c1", "c2", "c3"}
            )

    def test_pulled_file_wins_over_legacy_when_both_present(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
            legacy = classroom._legacy_seen_comments_path(root)
            legacy.parent.mkdir(parents=True, exist_ok=True)
            legacy.write_text(json.dumps({"sh1": ["old"]}))
            classroom.write_pulled_comment_ids(root, {"new"})
            self.assertEqual(classroom.read_pulled_comment_ids(root), {"new"})


if __name__ == "__main__":
    unittest.main()
