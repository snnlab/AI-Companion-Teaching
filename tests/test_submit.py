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

    def test_201_created_returns_the_answer(self):
        submit.urllib.request.urlopen = self._fake_urlopen_success(
            201, {"status": "created", "submissionId": "s1", "reverify": []})
        out = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out):
            data = submit.submit_envelope("https://cls.example.edu", "tok", {"x": 1})
        self.assertEqual(data["submissionId"], "s1")
        self.assertIn("Submitted", out.getvalue())

    def test_200_replay_returns_the_answer(self):
        submit.urllib.request.urlopen = self._fake_urlopen_success(
            200, {"status": "replay", "submissionId": "s1", "reverify": []})
        out = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out):
            data = submit.submit_envelope("https://cls.example.edu", "tok", {"x": 1})
        self.assertEqual(data["status"], "replay")
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


def _data_uri(data, mime="image/png"):
    import base64
    return "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))


def _envelope_with_assets(manuscript_assets, bundle_assets):
    return {
        "idempotencyKey": "0123456789abcdef",
        "payload": {
            "files": {
                "manuscript": {"path": "plans/manuscript.md", "content": "", "assets": manuscript_assets},
                "executionPlans": [
                    {"component": "01-x", "versions": [], "results": [{"assets": bundle_assets}]},
                ],
            },
        },
    }


class TestExternalizeAssets(unittest.TestCase):
    def test_large_files_move_out_small_ones_stay(self):
        import hashlib
        big = os.urandom(submit.EXTERNALIZE_MIN_BYTES + 10)
        small = b"tiny"
        env = _envelope_with_assets({"fig.png": _data_uri(big)}, {"t.csv": _data_uri(small, "text/csv")})
        uploads = submit.externalize_assets(env)
        sha = hashlib.sha256(big).hexdigest()
        self.assertEqual(list(uploads), [sha])
        files = env["payload"]["files"]
        self.assertEqual(files["manuscript"]["assets"]["fig.png"], "aict-asset:" + sha)
        self.assertTrue(files["executionPlans"][0]["results"][0]["assets"]["t.csv"].startswith("data:text/csv"))
        self.assertEqual(env["payload"]["externalAssets"][sha],
                         {"mime": "image/png", "size": len(big), "parts": 1})
        self.assertEqual(env["idempotencyKey"], "0123456789abcdef")

    def test_part_count_follows_size(self):
        big = b"\0" * (submit.ASSET_PART_BYTES + 1)
        env = _envelope_with_assets({"fig.png": _data_uri(big)}, {})
        uploads = submit.externalize_assets(env)
        (sha,) = uploads
        self.assertEqual(env["payload"]["externalAssets"][sha]["parts"], 2)

    def test_many_small_files_move_out_until_envelope_fits(self):
        files = {("f%d.png" % i): _data_uri(os.urandom(20 * 1024)) for i in range(200)}
        env = _envelope_with_assets({}, files)
        uploads = submit.externalize_assets(env)
        self.assertGreater(len(uploads), 0)
        self.assertLessEqual(submit._envelope_bytes(env), submit.ENVELOPE_TARGET_BYTES)

    def test_nothing_to_move_leaves_no_external_assets_key(self):
        env = _envelope_with_assets({}, {"t.csv": _data_uri(b"a,b", "text/csv")})
        self.assertEqual(submit.externalize_assets(env), {})
        self.assertNotIn("externalAssets", env["payload"])


class TestSizeBudget(unittest.TestCase):
    """Vercel's 4.5 MB body cap: what is measured is what is sent, a long
    manuscript travels separately, and an oversize submission stops early."""

    def test_sent_bytes_equal_measured_bytes_for_korean_text(self):
        env = {"payload": {"files": {"manuscript": {"content": "한국어 원고 " * 1000}}}}
        body = submit.envelope_body(env)
        self.assertEqual(len(body), submit._envelope_bytes(env))
        self.assertIn("한국어".encode("utf-8"), body)  # UTF-8, not \uXXXX escapes
        self.assertNotIn(b"\\u", body)

    def test_long_manuscript_body_is_sent_separately(self):
        import hashlib
        text = "<p>" + "가" * (submit.MANUSCRIPT_EXTERNALIZE_BYTES // 3 + 10) + "</p>"
        env = _envelope_with_assets({}, {})
        env["payload"]["files"]["manuscript"].update(content=text, format="docx-html")
        uploads = submit.externalize_assets(env)
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        self.assertEqual(env["payload"]["files"]["manuscript"]["content"], "aict-asset:" + sha)
        self.assertEqual(uploads[sha].decode("utf-8"), text)
        self.assertEqual(env["payload"]["externalAssets"][sha]["mime"], "text/html; charset=utf-8")
        self.assertLess(submit._envelope_bytes(env), 10_000)

    def test_short_manuscript_stays_inline(self):
        env = _envelope_with_assets({}, {})
        env["payload"]["files"]["manuscript"]["content"] = "<p>short</p>"
        self.assertEqual(submit.externalize_assets(env), {})
        self.assertEqual(env["payload"]["files"]["manuscript"]["content"], "<p>short</p>")

    def test_oversize_message_names_the_biggest_parts(self):
        env = {
            "gitExcerpt": {"commits": []},
            "payload": {"files": {
                "masterPlan": {"path": "plans/master-plan.md", "content": "m" * 4_500_000},
                "decisionLog": {"path": "plans/decision-log.md", "content": "short"},
                "executionPlans": [],
            }},
        }
        msg = submit.oversize_message(env)
        self.assertIn("plans/master-plan.md 4.5 MB", msg)
        self.assertIn("over the 4.4 MB", msg)


class TestUploadAssets(unittest.TestCase):
    def setUp(self):
        self._orig = submit._post
        self.calls = []

    def tearDown(self):
        submit._post = self._orig

    def _env_and_uploads(self, n=2):
        env = _envelope_with_assets(
            {("f%d.png" % i): _data_uri(os.urandom(submit.EXTERNALIZE_MIN_BYTES + i + 1)) for i in range(n)}, {})
        return env, submit.externalize_assets(env)

    def test_uploads_only_what_the_server_is_missing(self):
        env, uploads = self._env_and_uploads(2)
        missing = sorted(uploads)[:1]

        def fake(url, token, body, ctype, timeout=120):
            self.calls.append(url)
            if "op=check" in url:
                return 200, {"missing": missing}
            return 200, {"ok": True}
        submit._post = fake
        with contextlib_redirect():
            self.assertEqual(submit.upload_assets("https://cls", "tok", env, uploads), 1)
        puts = [u for u in self.calls if "op=put" in u]
        self.assertEqual(len(puts), 1)
        self.assertIn("sha=%s" % missing[0], puts[0])

    def test_old_server_is_detected(self):
        env, uploads = self._env_and_uploads(1)
        for code, body in ((404, {}), (401, {"error": "unauthorized"})):
            submit._post = lambda *a, **k: (code, body)
            with self.assertRaises(submit.AssetsUnsupported):
                submit.upload_assets("https://cls", "tok", env, uploads)

    def test_rejected_token_dies(self):
        env, uploads = self._env_and_uploads(1)
        submit._post = lambda *a, **k: (401, {"error": "invalid_token"})
        with self.assertRaises(SystemExit):
            submit.upload_assets("https://cls", "tok", env, uploads)


def contextlib_redirect():
    import contextlib
    return contextlib.redirect_stdout(io.StringIO())


def _docx(path, text, mtime):
    """A minimal Word file whose only paragraph is `text`, saved at `mtime`."""
    import zipfile
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
                   'package/2006/content-types"/>')
        z.writestr("word/document.xml",
                   '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>'
                   "<w:p><w:r><w:t>%s</w:t></w:r></w:p></w:body></w:document>" % (w, text))
    os.utime(path, (mtime, mtime))


def _run_submit(root, *args, env_extra=None):
    """submit.py in a subprocess on a cp949 console (Korean Windows). Its
    plugin data (the saved classroom URL/token) goes under the project, never
    into the real ~/.aict."""
    env = {**os.environ, "PYTHONIOENCODING": "cp949", "AICT_NO_BOARD": "1",
           "CLAUDE_PLUGIN_DATA": str(Path(root) / ".plugin-data")}
    env.pop("PYTHONUTF8", None)
    env.update(env_extra or {})
    return subprocess.run(
        [sys.executable, str(SUBMIT), *args], cwd=str(root), capture_output=True,
        timeout=60, env=env, encoding="utf-8", errors="replace")


class TestManuscriptCheck(unittest.TestCase):
    """2026-10-04: a stale plans/manuscript.docx went out while the student
    was writing in a Word file at the project root."""

    def _stale_project(self, d):
        root = Path(d)
        make_project(root)
        now = datetime.datetime.now().timestamp()
        _docx(root / "plans" / "manuscript.docx", "옛 원고 — 이론적 배경 없음", now - 2 * 86400)
        _docx(root / "APOE4 원고.docx", "새 원고 — 이론적 배경 완성", now)
        (root / "README.md").write_text("readme — not a paper\n", encoding="utf-8")
        return root

    def test_dry_run_shows_file_saved_time_excerpt_and_newer_candidate(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._stale_project(d)
            proc = _run_submit(root, "--dry-run")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = proc.stdout
            self.assertIn("manuscript: plans/manuscript.docx (Word) — saved", out)
            self.assertIn("옛 원고", out)
            self.assertIn("MANUSCRIPT CHECK", out)
            self.assertIn("- APOE4 원고.docx — saved", out)
            self.assertNotIn("README.md", out)
            self.assertIn("plans: 01-data-prep v1", out)

    def test_unpinned_submit_with_a_newer_candidate_is_not_sent(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._stale_project(d)
            # Unreachable server: reaching the network would be a different error.
            proc = _run_submit(root, "--url", "http://127.0.0.1:1", "--token", "x")
            self.assertEqual(proc.returncode, 1)
            self.assertIn("not sent", proc.stderr)
            self.assertIn("APOE4 원고.docx", proc.stderr)

    def test_pinning_sends_that_file_from_then_on(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._stale_project(d)
            proc = _run_submit(root, "--dry-run", "--manuscript", "APOE4 원고.docx")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("APOE4 원고.docx", (root / "plans" / "manuscript-source.txt")
                          .read_text(encoding="utf-8"))
            payload = board.collect_payload(root, "submission", None)
            m = payload["files"]["manuscript"]
            self.assertEqual(m["path"], "APOE4 원고.docx")
            self.assertIn("새 원고", m["content"])
            self.assertTrue(m["modifiedAt"])
            info = submit.manuscript_check(root, payload)
            self.assertTrue(info["pinned"])
            self.assertEqual(info["newer"], [])
            # "default" unpins
            _run_submit(root, "--dry-run", "--manuscript", "default")
            self.assertFalse((root / "plans" / "manuscript-source.txt").exists())

    def test_pin_outside_the_project_is_refused(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
            root = self._stale_project(d)
            outside = Path(other) / "paper.docx"
            _docx(outside, "x", datetime.datetime.now().timestamp())
            proc = _run_submit(root, "--dry-run", "--manuscript", str(outside))
            self.assertEqual(proc.returncode, 1)
            self.assertIn("outside this project", proc.stderr)

    def test_missing_pinned_file_is_reported_not_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._stale_project(d)
            board.write_manuscript_source(root, str(root / "APOE4 원고.docx"))
            (root / "APOE4 원고.docx").unlink()
            payload = board.collect_payload(root, "submission", None)
            m = payload["files"]["manuscript"]
            self.assertEqual(m["format"], "unsupported")
            self.assertIn("missing", m["note"])
            info = submit.manuscript_check(root, payload)
            self.assertTrue(info["missing"])
            self.assertIn("does not exist", submit.manuscript_warning(info))

    def test_a_copy_with_the_same_saved_time_is_not_newer(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            t = datetime.datetime.now().timestamp()
            _docx(root / "plans" / "manuscript.docx", "same", t)
            _docx(root / "draft.docx", "same", t)
            payload = board.collect_payload(root, "submission", None)
            self.assertEqual(submit.manuscript_check(root, payload)["newer"], [])

    def test_md_and_subfolder_files_count_only_when_named_like_a_paper(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            (root / "notes.md").write_text("x", encoding="utf-8")
            (root / "논문 초고.md").write_text("x", encoding="utf-8")
            (root / "output").mkdir()
            _docx(root / "output" / "table1.docx", "t", 0)
            (root / "paper").mkdir()
            _docx(root / "paper" / "v3.docx", "p", 0)
            _docx(root / "~$APOE4.docx", "lock", 0)
            names = [rel for rel, _ in submit.manuscript_candidates(root)]
            self.assertIn("논문 초고.md", names)
            self.assertIn("paper/v3.docx", names)
            self.assertNotIn("notes.md", names)
            self.assertNotIn("output/table1.docx", names)
            self.assertNotIn("~$APOE4.docx", names)


class TestReceipt(unittest.TestCase):
    def test_receipt_board_and_record_name_what_was_sent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            _docx(root / "plans" / "manuscript.docx", "본문", datetime.datetime.now().timestamp())
            payload = board.collect_payload(root, "submission", None)
            envelope = submit.build_envelope(root, None, payload=payload)
            info = submit.manuscript_check(root, payload)
            path = submit.write_receipt(
                root, envelope, {"status": "created", "submissionId": "sub-9"}, info)
            self.assertEqual(path, root / "plans" / ".aict-submitted" / "board.html")
            rec = json.loads((path.parent / "receipt.json").read_text(encoding="utf-8"))
            self.assertEqual(rec["submissionId"], "sub-9")
            self.assertEqual(rec["manuscript"]["path"], "plans/manuscript.docx")
            self.assertTrue(rec["manuscript"]["modifiedAt"])
            self.assertEqual(rec["plans"], [{"component": "01-data-prep", "versions": [1]}])
            html = path.read_text(encoding="utf-8")
            self.assertIn('"receipt"', html)
            self.assertIn('"mode": "snapshot"', html.replace('"mode":"snapshot"', '"mode": "snapshot"'))
            self.assertIn("/.aict-submitted/",
                          (root / "plans" / ".gitignore").read_text(encoding="utf-8"))
            self.assertTrue(board.fingerprint_excluded(".aict-submitted"))


class TestConsoleEncoding(unittest.TestCase):
    def test_dry_run_on_a_cp949_console_with_korean_git_history(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            _init_git(root)
            _commit(root, "plans/execution/01-data-prep/v2.md", "# v2\n", "계획 — 초안",
                    _iso_days_ago(1))
            proc = _run_submit(root, "--dry-run")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("Traceback", proc.stderr)
            self.assertIn("dry run — no network call made", proc.stdout)


if __name__ == "__main__":
    unittest.main()
