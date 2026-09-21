# tests/test_submit.py
"""Tests for submit.py (classroom-server submission envelope + CLI). Run:
    python3 -m unittest tests.test_submit -v
"""
import datetime
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
SUBMIT = SCRIPTS / "submit.py"
sys.path.insert(0, str(SCRIPTS))
import submit  # noqa: E402
import board  # noqa: E402


def make_project(root: Path):
    """Minimal initialized aict project with one signed version."""
    plans = root / "plans"
    (plans / "execution" / "01-data-prep").mkdir(parents=True)
    (plans / "master-plan.md").write_text(
        "<!-- aict:master-plan -->\n"
        "# Test — Master Plan\n\n"
        "## Components\n\n"
        "| # | Analysis step | Status | Execution plan | Outcome / notes | Serves |\n"
        "|---|-----------|--------|----------------|-----------------|--------|\n"
        "| 1 | Data prep | in progress | — | — | — |\n",
        encoding="utf-8",
    )
    (plans / "decision-log.md").write_text(
        "# Decision Log\n\n## 2026-08-01 10:00\n\n"
        "**Context:** test\n**Response (student):** ok\n"
        "**Effect on execution:** none\n",
        encoding="utf-8",
    )
    (plans / "execution" / "01-data-prep" / "v1.md").write_text(
        "# Data prep v1\n\nDo the thing.\n\n---\nSigned off: Test, 2026-08-01\n",
        encoding="utf-8",
    )
    return plans


def _init_git(root, when=None):
    env = dict(os.environ)
    if when:
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
    subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
    for k, v in (("user.email", "t@example.com"), ("user.name", "Test")):
        subprocess.run(["git", "-C", str(root), "config", k, v],
                        check=True, capture_output=True)
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "init", "--allow-empty"],
                    check=True, capture_output=True, env=env)


def _commit(root, rel_path, content, message, when):
    p = root / rel_path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    env = dict(os.environ)
    env["GIT_AUTHOR_DATE"] = when
    env["GIT_COMMITTER_DATE"] = when
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", message],
                    check=True, capture_output=True, env=env)


def _iso_days_ago(n):
    dt = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=n)
    return dt.isoformat()


class TestGitLogExcerpt(unittest.TestCase):
    def test_outside_git_repo_returns_unavailable(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            result = submit.git_log_excerpt(root)
            self.assertEqual(
                result, {"available": False, "head": None, "branch": None, "commits": []}
            )

    def test_max_commits_bound_truncates(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            _init_git(root, when=_iso_days_ago(10))
            for i in range(5):
                _commit(root, "plans/decision-log.md", "entry %d\n" % i,
                        "entry %d" % i, _iso_days_ago(9 - i))
            result = submit.git_log_excerpt(root, max_commits=3, max_days=120)
            self.assertTrue(result["available"])
            self.assertEqual(len(result["commits"]), 3)

    def test_max_days_bound_excludes_old_commits(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            # Old commit well outside any window, then a recent one.
            _init_git(root, when=_iso_days_ago(500))
            _commit(root, "plans/decision-log.md", "old entry\n",
                    "old", _iso_days_ago(300))
            _commit(root, "plans/decision-log.md", "recent entry\n",
                    "recent", _iso_days_ago(2))
            result = submit.git_log_excerpt(root, max_commits=200, max_days=10)
            self.assertTrue(result["available"])
            subjects = [c["subject"] for c in result["commits"]]
            self.assertIn("recent", subjects)
            self.assertNotIn("old", subjects)
            self.assertNotIn("init", subjects)

    def test_master_plan_first_commit_shortens_window_when_more_recent(self):
        # An early plans/ commit (well inside the 120-day max_days bound on
        # its own) predates master-plan.md's own first commit — the "shorter
        # of the two" cutoff should be master-plan.md's first-commit date,
        # excluding that pre-project commit even though max_days alone would
        # have kept it.
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            plans = root / "plans"
            plans.mkdir()
            (plans / "scratch.md").write_text("pre-project note\n", encoding="utf-8")
            _init_git(root, when=_iso_days_ago(50))
            # master-plan.md committed later, still comfortably inside 120 days
            _commit(root, "plans/master-plan.md",
                    "<!-- aict:master-plan -->\n# T\n",
                    "add master plan", _iso_days_ago(20))
            _commit(root, "plans/decision-log.md", "entry\n",
                    "decision entry", _iso_days_ago(5))
            result = submit.git_log_excerpt(root, max_commits=200, max_days=120)
            subjects = [c["subject"] for c in result["commits"]]
            self.assertIn("add master plan", subjects)
            self.assertIn("decision entry", subjects)
            self.assertNotIn("init", subjects)

    def test_commit_fields_shape(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            _init_git(root, when=_iso_days_ago(1))
            result = submit.git_log_excerpt(root)
            self.assertTrue(result["available"])
            self.assertTrue(result["head"])
            self.assertEqual(len(result["commits"]), 1)
            c = result["commits"][0]
            self.assertEqual(set(c.keys()), {"hash", "authorDate", "authorName", "subject"})
            self.assertEqual(c["authorName"], "Test")
            self.assertEqual(c["subject"], "init")


class TestEnvelope(unittest.TestCase):
    def test_idempotency_key_matches_share_hash(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            envelope = submit.build_envelope(root, course_id=None)
            expected = board.share_hash(board.payload_files(envelope["payload"]))
            self.assertEqual(envelope["idempotencyKey"], expected)

    def test_envelope_shape_omits_student_id_and_tickets(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            envelope = submit.build_envelope(root, course_id="SOC601")
            self.assertEqual(envelope["envelopeSchemaVersion"], 1)
            self.assertEqual(envelope["courseId"], "SOC601")
            self.assertNotIn("studentId", envelope)
            self.assertNotIn("signOffTickets", envelope)
            self.assertIn("gitExcerpt", envelope)
            self.assertIn("payload", envelope)
            self.assertIn("idempotencyKey", envelope)
            self.assertIn("submittedAt", envelope)

    def test_payload_mode_is_submission_and_collaborator_facing(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            payload = board.collect_payload(root, "submission", None)
            self.assertEqual(payload["mode"], "submission")
            # collaborator_facing now includes "submission" (the one-line
            # board.py change this feature depends on) — so a shareHash is
            # stamped and researcher-only drift hygiene is withheld.
            self.assertIn("shareHash", payload)
            self.assertNotIn("drift", payload)


class TestDryRunNeverNetworks(unittest.TestCase):
    def test_dry_run_with_unreachable_url_makes_no_call(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            proc = subprocess.run(
                [sys.executable, str(SUBMIT), "--dry-run",
                 "--url", "http://127.0.0.1:1/", "--token", "x"],
                cwd=str(root), capture_output=True, text=True, timeout=20,
                encoding="utf-8",
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("dry run", proc.stdout)
            self.assertIn("no network call made", proc.stdout)

    def test_dry_run_never_calls_urlopen(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            orig_urlopen = submit.urllib.request.urlopen
            orig_argv = sys.argv
            orig_cwd = os.getcwd()

            def boom(*a, **kw):
                raise AssertionError("--dry-run must never call urlopen")
            submit.urllib.request.urlopen = boom
            sys.argv = ["submit.py", "--dry-run"]
            os.chdir(str(root))
            try:
                out = io.StringIO()
                import contextlib
                with contextlib.redirect_stdout(out):
                    with self.assertRaises(SystemExit) as cm:
                        submit.main()
                self.assertEqual(cm.exception.code, 0)
            finally:
                submit.urllib.request.urlopen = orig_urlopen
                sys.argv = orig_argv
                os.chdir(orig_cwd)


class TestPreflightWarnings(unittest.TestCase):
    def test_malformed_trailer_warns(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            plans = make_project(root)
            (plans / "execution" / "01-data-prep" / "v1.md").write_text(
                "# Data prep v1\n\nSigned off: sneaky, 2026-01-01\n\nDo the thing.\n",
                encoding="utf-8",
            )
            payload = board.collect_payload(root, "submission", None)
            warnings = submit.preflight_warnings(payload)
            self.assertTrue(any("trailer grammar violation" in w for w in warnings))

    def test_clean_trailer_has_no_warning(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            payload = board.collect_payload(root, "submission", None)
            warnings = submit.preflight_warnings(payload)
            self.assertEqual(warnings, [])


class TestResponseHandling(unittest.TestCase):
    def _fake_urlopen_success(self, code, body):
        class _Resp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def getcode(self_inner):
                return code

            def read(self_inner):
                return json.dumps(body).encode("utf-8")
        return lambda req, timeout=60: _Resp()

    def setUp(self):
        self._orig = submit.urllib.request.urlopen

    def tearDown(self):
        submit.urllib.request.urlopen = self._orig

    def test_201_created_exits_zero(self):
        submit.urllib.request.urlopen = self._fake_urlopen_success(
            201, {"status": "created", "submissionId": "s1", "reverify": []})
        out = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                submit.submit_envelope("https://cls.example.edu", "tok", {"x": 1})
        self.assertEqual(cm.exception.code, 0)
        self.assertIn("Submitted", out.getvalue())

    def test_200_replay_exits_zero(self):
        submit.urllib.request.urlopen = self._fake_urlopen_success(
            200, {"status": "replay", "submissionId": "s1", "reverify": []})
        out = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as cm:
                submit.submit_envelope("https://cls.example.edu", "tok", {"x": 1})
        self.assertEqual(cm.exception.code, 0)
        self.assertIn("already submitted", out.getvalue())

    def test_401_dies_with_code_1(self):
        import urllib.error

        def raise_401(req, timeout=60):
            raise urllib.error.HTTPError(
                req.full_url, 401, "Unauthorized", {}, io.BytesIO(b""))
        submit.urllib.request.urlopen = raise_401
        with self.assertRaises(SystemExit) as cm:
            submit.submit_envelope("https://cls.example.edu", "badtok", {"x": 1})
        self.assertEqual(cm.exception.code, 1)

    def test_413_reports_limit(self):
        import urllib.error

        def raise_413(req, timeout=60):
            body = json.dumps({"error": "payload_too_large", "limitBytes": 4718592}).encode()
            raise urllib.error.HTTPError(
                req.full_url, 413, "Too Large", {}, io.BytesIO(body))
        submit.urllib.request.urlopen = raise_413
        with self.assertRaises(SystemExit):
            submit.submit_envelope("https://cls.example.edu", "tok", {"x": 1})

    def test_network_error_dies(self):
        import urllib.error

        def raise_conn(req, timeout=60):
            raise urllib.error.URLError("connection refused")
        submit.urllib.request.urlopen = raise_conn
        with self.assertRaises(SystemExit) as cm:
            submit.submit_envelope("https://cls.example.edu", "tok", {"x": 1})
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
