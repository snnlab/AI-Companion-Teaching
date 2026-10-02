# tests/test_check.py
"""Tests for check.py (/ait:check — fetches + routes instructor
comments across ALL of the student's own submissions via GET
/api/my-comments). Mirrors tests/test_board.py's TestPull, which check.py's
routing pipeline is deliberately modeled on. Run:
    python3 -m unittest tests.test_check -v
"""
import contextlib
import json
import io
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import check  # noqa: E402
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


class TestCheck(unittest.TestCase):
    COMMENTS = [
        {"id": "c1", "clientId": "x", "author": "Prof. Kim", "shareHash": "sh1",
         "docHash": None, "receivedAt": "2026-08-25T02:00:00.000Z",
         "annotation": {"type": "general", "comment": "worth a second look"}},
        {"id": "c2", "clientId": "y", "author": "Prof. Kim", "shareHash": "sh2",
         "docHash": None, "receivedAt": "2026-08-25T03:00:00.000Z",
         "annotation": {"type": "general", "comment": "second submission too"}},
    ]

    def setUp(self):
        self._orig_data = os.environ.get("CLAUDE_PLUGIN_DATA")
        self._orig_http_get_json = check._http_get_json
        self._orig_cwd = os.getcwd()
        self._orig_no_board = os.environ.get("AICT_NO_BOARD")
        os.environ["AICT_NO_BOARD"] = "1"  # never spawn a real board from a test

    def tearDown(self):
        if self._orig_data is None:
            os.environ.pop("CLAUDE_PLUGIN_DATA", None)
        else:
            os.environ["CLAUDE_PLUGIN_DATA"] = self._orig_data
        if self._orig_no_board is None:
            os.environ.pop("AICT_NO_BOARD", None)
        else:
            os.environ["AICT_NO_BOARD"] = self._orig_no_board
        check._http_get_json = self._orig_http_get_json

    @contextlib.contextmanager
    def _project(self):
        # chdir'd into a fresh project directory, restored BEFORE the tempdir
        # is torn down (required on Windows, which refuses to delete the
        # current working directory) — the restore happens in this
        # generator's own `finally`, nested inside TemporaryDirectory's own
        # `with`, so it always runs first.
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_project(root)
            os.chdir(str(root))
            try:
                yield root
            finally:
                os.chdir(self._orig_cwd)

    def _configure(self, root, comments=None):
        os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data")
        classroom.write_classroom_config(
            root, {"serverUrl": "https://cls.example.edu", "token": "tok-xyz", "courseId": None})
        check._http_get_json = lambda url, headers: {
            "studentId": "alice", "comments": comments if comments is not None else self.COMMENTS,
        }

    def test_dies_when_no_classroom_server_configured(self):
        with self._project() as root:
            os.environ["CLAUDE_PLUGIN_DATA"] = str(root / "data" / "empty")
            err = io.StringIO()
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
                check.main()
            self.assertEqual(cm.exception.code, 1)
            self.assertIn("/ait:submit", err.getvalue())

    def test_fetch_sends_bearer_token_to_my_comments_endpoint(self):
        with self._project() as root:
            self._configure(root, comments=[])
            captured = {}
            orig = check._http_get_json

            def spy(url, headers):
                captured["url"] = url
                captured["headers"] = headers
                return orig(url, headers)
            check._http_get_json = spy
            with contextlib.redirect_stdout(io.StringIO()):
                check.main()
            self.assertEqual(captured["url"], "https://cls.example.edu/api/my-comments")
            self.assertEqual(captured["headers"]["Authorization"], "Bearer tok-xyz")

    def test_no_new_comments_prints_quiet_message(self):
        with self._project() as root:
            self._configure(root, comments=[])
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            self.assertIn("No new instructor feedback.", out.getvalue())

    def test_new_comments_are_routed_and_marked_pulled(self):
        with self._project() as root:
            self._configure(root)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            self.assertIn("worth a second look", out.getvalue())
            self.assertIn("second submission too", out.getvalue())
            self.assertIn('"mode": "hosted"', out.getvalue())
            self.assertEqual(classroom.read_pulled_comment_ids(root), {"c1", "c2"})
            inbox = classroom.comments_inbox_dir(root)
            self.assertEqual(list(inbox.glob("*.txt")), [])

    PLAN_COMMENT = {
        "id": "p1", "clientId": "z", "author": "Prof. Kim", "shareHash": "sh1",
        "docHash": "abcd1234", "receivedAt": "2026-08-25T04:00:00.000Z",
        "annotation": {
            "type": "plan-comment", "planPath": "plans/execution/02-clpm-fit/v1.md",
            "component": "02-clpm-fit", "version": 1, "isDraft": False,
            "sectionHeading": "Decisions and reasons",
            "quote": "the random-intercept specification",
            "comment": "expand this — why random intercepts specifically?",
        },
    }

    def test_anchored_comment_writes_seed_file_and_marker(self):
        with self._project() as root:
            self._configure(root, comments=[self.PLAN_COMMENT])
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            text = out.getvalue()
            self.assertIn("[ait:check] board-seeds:", text)
            self.assertIn("[ait:check] focus: 02-clpm-fit", text)
            seed_path = root / "plans" / check.SEED_FILE_NAME
            self.assertTrue(seed_path.is_file())
            import json as _json
            seeds = _json.loads(seed_path.read_text())
            self.assertEqual(len(seeds), 1)
            s = seeds[0]
            self.assertEqual(s["scope"], "plan")
            self.assertEqual(s["component"], "02-clpm-fit")
            self.assertEqual(s["version"], 1)
            self.assertEqual(s["quote"], "the random-intercept specification")
            self.assertEqual(s["author"], "Prof. Kim")
            # every seed board.py can render
            self.assertTrue(board._valid_seed(s))
            # the text-document routing path still ran for the same comment
            self.assertIn('"mode": "hosted"', text)
            self.assertEqual(classroom.read_pulled_comment_ids(root), {"p1"})

    def test_manuscript_comment_seeds_the_manuscript_view(self):
        ann = {
            "type": "doc-comment", "view": "manuscript",
            "docKey": "plans/manuscript.docx", "scope": "manuscript",
            "sectionHeading": "manuscript", "occurrenceIndex": 2,
            "quote": "stable traits", "comment": "Say which traits.",
        }
        s = check.annotation_to_seed({"author": "Prof. Kim", "annotation": ann})
        self.assertEqual(s["scope"], "manuscript")
        self.assertEqual(s["docKey"], "plans/manuscript.docx")
        self.assertEqual(s["occurrenceIndex"], 2)
        self.assertTrue(board._valid_seed(s))
        # a bad occurrenceIndex degrades to the first match, never crashes
        s2 = check.annotation_to_seed(
            {"author": "K", "annotation": dict(ann, occurrenceIndex="x")})
        self.assertEqual(s2["occurrenceIndex"], 0)

    def test_edited_comment_is_pulled_again_marked_edited(self):
        with self._project() as root:
            self._configure(root)
            with contextlib.redirect_stdout(io.StringIO()):
                check.main()  # c1, c2 pulled (pre-edit ids, bare)
            edited = dict(self.COMMENTS[0], editedAt="2026-08-26T09:00:00.000Z",
                          annotation={"type": "general", "comment": "look again, closer"})
            self._configure(root, comments=[edited, self.COMMENTS[1]])
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            text = out.getvalue()
            self.assertIn("(edited by the instructor 2026-08-26) look again, closer", text)
            self.assertNotIn("second submission too", text)  # unchanged: not re-pulled
            self.assertIn("c1@2026-08-26T09:00:00.000Z", classroom.read_pulled_comment_ids(root))
            # and a third run finds nothing new
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            self.assertIn("No new instructor feedback.", out.getvalue())

    def test_seed_carries_the_server_comment_id(self):
        s = check.annotation_to_seed(dict(self.PLAN_COMMENT))
        self.assertEqual(s["commentId"], "p1")
        self.assertTrue(board._valid_seed(s))

    def test_general_only_comments_write_no_seed_file(self):
        with self._project() as root:
            self._configure(root)  # COMMENTS are all type "general"
            with contextlib.redirect_stdout(io.StringIO()):
                check.main()
            self.assertFalse((root / "plans" / check.SEED_FILE_NAME).is_file())

    def test_anchored_comment_opens_the_board(self):
        calls = []
        orig = check.open_seed_board
        check.open_seed_board = lambda root, seed_path, focus: calls.append(
            (Path(seed_path).name, focus)
        )
        try:
            with self._project() as root:
                self._configure(root, comments=[self.PLAN_COMMENT])
                with contextlib.redirect_stdout(io.StringIO()):
                    check.main()
        finally:
            check.open_seed_board = orig
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], (check.SEED_FILE_NAME, "02-clpm-fit"))

    def test_general_only_comments_still_open_the_board(self):
        # No anchor, no seed file — but the board should still open
        # unconditionally so the student sees the new feedback.
        calls = []
        orig = check.open_seed_board
        check.open_seed_board = lambda *a: calls.append(a)
        try:
            with self._project() as root:
                self._configure(root)  # all type "general" — no anchor, no seed
                with contextlib.redirect_stdout(io.StringIO()):
                    check.main()
        finally:
            check.open_seed_board = orig
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1:], (None, None))

    def test_no_board_env_suppresses_spawn(self):
        # open_seed_board is the real one here; AICT_NO_BOARD=1 (setUp)
        # must make it a no-op rather than launch board.py.
        with self._project() as root:
            self._configure(root, comments=[self.PLAN_COMMENT])
            seed_path = root / "plans" / check.SEED_FILE_NAME
            with contextlib.redirect_stdout(io.StringIO()):
                check.main()
            # got far enough to write the seed file, but nothing was spawned
            self.assertTrue(seed_path.is_file())
            check.open_seed_board(root, seed_path, "02-clpm-fit")  # returns immediately

    def test_stale_seed_file_cleared_when_nothing_new(self):
        with self._project() as root:
            self._configure(root, comments=[])
            stale = root / "plans" / check.SEED_FILE_NAME
            stale.write_text("[]", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                check.main()
            self.assertFalse(stale.is_file())

    def test_second_check_skips_already_pulled(self):
        with self._project() as root:
            self._configure(root)
            with contextlib.redirect_stdout(io.StringIO()):
                check.main()
            out2 = io.StringIO()
            with contextlib.redirect_stdout(out2):
                check.main()
            self.assertIn("No new instructor feedback.", out2.getvalue())
            self.assertNotIn("worth a second look", out2.getvalue())

    def test_comments_across_different_submissions_both_surface(self):
        # sh1 and sh2 are two DIFFERENT past submissions — a flat pulled-id
        # set must not conflate or drop either.
        with self._project() as root:
            self._configure(root)  # COMMENTS spans shareHash sh1 and sh2
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            self.assertIn("sh1", out.getvalue())
            self.assertIn("sh2", out.getvalue())

    def test_drains_leftover_inbox_before_fetch(self):
        with self._project() as root:
            self._configure(root, comments=[])
            inbox = classroom.comments_inbox_dir(root)
            inbox.mkdir(parents=True, exist_ok=True)
            leftover_doc = board.assemble_hosted_document(
                [{"type": "general", "comment": "UNIQUE-LEFTOVER-TEXT"}],
                {"sessionId": "s", "generatedAt": "", "focus": None,
                 "reviewer": "Prof. Kim", "shareHash": None},
            )
            (inbox / "leftover.txt").write_text(leftover_doc, encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            self.assertIn("UNIQUE-LEFTOVER-TEXT", out.getvalue())
            self.assertFalse((inbox / "leftover.txt").exists())

    def test_401_dies_with_guidance(self):
        with self._project() as root:
            self._configure(root)

            def raise_401(url, headers):
                raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, io.BytesIO(b""))
            check._http_get_json = raise_401
            err = io.StringIO()
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
                check.main()
            self.assertEqual(cm.exception.code, 1)
            self.assertIn("Token rejected", err.getvalue())

    def test_network_error_dies_with_guidance(self):
        with self._project() as root:
            self._configure(root)

            def raise_conn(url, headers):
                raise urllib.error.URLError("connection refused")
            check._http_get_json = raise_conn
            err = io.StringIO()
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
                check.main()
            self.assertEqual(cm.exception.code, 1)
            self.assertIn("unreachable", err.getvalue())

    def test_collision_proof_inbox_filenames(self):
        # Two DIFFERENT (author, clientId) groups that sanitize to the SAME
        # filename prefix must not overwrite each other in the inbox.
        collision_comments = [
            {"id": "cA", "clientId": "", "author": "Bob!", "shareHash": "h",
             "docHash": None, "receivedAt": "t1",
             "annotation": {"type": "general", "comment": "UNIQUE-TEXT-ALPHA"}},
            {"id": "cB", "clientId": "", "author": "Bob ", "shareHash": "h",
             "docHash": None, "receivedAt": "t2",
             "annotation": {"type": "general", "comment": "UNIQUE-TEXT-BRAVO"}},
        ]
        with self._project() as root:
            self._configure(root, comments=collision_comments)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                check.main()
            self.assertIn("UNIQUE-TEXT-ALPHA", out.getvalue())
            self.assertIn("UNIQUE-TEXT-BRAVO", out.getvalue())
            inbox = classroom.comments_inbox_dir(root)
            self.assertEqual(list(inbox.glob("*.txt")), [])


if __name__ == "__main__":
    unittest.main()


class TestHistory(unittest.TestCase):
    """/ait:check --history / --open: past submissions reopened read-only."""

    SHA = "a" * 64
    PNG = b"\x89PNG-fake-bytes"
    PAYLOAD = {
        "schemaVersion": 2, "generatedAt": "2026-09-29T23:40", "mode": "submission",
        "project": {"name": "p"}, "git": {"available": False},
        "files": {
            "masterPlan": {"path": "plans/master-plan.md", "content": "# MP"},
            "decisionLog": {"path": "plans/decision-log.md", "content": "# DL"},
            "executionPlans": [], "reviews": [],
            "manuscript": {
                "path": "plans/manuscript.md", "format": "markdown",
                "content": "# Paper\n\nPanel studies routinely report that SES predicts later well-being.",
                "assets": {"fig1.png": "aict-asset:" + "a" * 64},
            },
        },
        "externalAssets": {"a" * 64: {"mime": "image/png", "size": 15, "parts": 1}},
    }
    MY = {
        "studentId": "alice",
        "comments": [{
            "id": "c1", "author": "Prof. Kim", "shareHash": "0123456789abcdef",
            "receivedAt": "2026-10-01T03:00:00.000Z", "editedAt": "2026-10-02T03:00:00.000Z",
            "annotation": {"type": "doc-comment", "view": "manuscript", "docKey": "plans/manuscript.md",
                           "quote": "routinely report", "comment": "Cite two of them."},
        }],
        "submissions": [
            {"shareHash": "0123456789abcdef", "submittedAt": "2026-09-29T23:40:00+09:00",
             "releasedAt": "2026-10-01T04:00:00.000Z"},
            {"shareHash": "fedcba9876543210", "submittedAt": "2026-09-30T10:00:00+09:00",
             "releasedAt": None},
        ],
    }

    def setUp(self):
        self._saved = (os.environ.get("CLAUDE_PLUGIN_DATA"), os.environ.get("AICT_NO_BOARD"),
                       check._http_get_json, check._http_get_bytes, os.getcwd())
        os.environ["AICT_NO_BOARD"] = "1"
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        make_project(self.root)
        os.chdir(str(self.root))
        os.environ["CLAUDE_PLUGIN_DATA"] = str(self.root / "data")
        classroom.write_classroom_config(
            self.root, {"serverUrl": "https://cls.example.edu", "token": "tok", "courseId": None})
        self.calls = []

        def get_json(url, headers):
            self.calls.append(url)
            if url.endswith("/api/my-comments"):
                return json.loads(json.dumps(self.MY))
            if "/api/my-submission?" in url:
                return {"submittedAt": "2026-09-29T23:40:00+09:00", "releasedAt": "2026-10-01T04:00:00.000Z",
                        "payload": json.loads(json.dumps(self.PAYLOAD))}
            raise AssertionError(url)
        check._http_get_json = get_json
        check._http_get_bytes = lambda url, headers: self.PNG

    def tearDown(self):
        data, no_board, gj, gb, cwd = self._saved
        os.chdir(cwd)
        check._http_get_json, check._http_get_bytes = gj, gb
        for k, v in (("CLAUDE_PLUGIN_DATA", data), ("AICT_NO_BOARD", no_board)):
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def run_main(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            check.main(list(argv))
        return out.getvalue()

    def test_history_lists_only_released_submissions(self):
        text = self.run_main("--history")
        self.assertIn("1. submitted 2026-09-29 23:40", text)
        self.assertIn("1 comment(s)", text)
        self.assertNotIn("fedcba9876543210", text)  # never released

    def test_open_writes_a_self_contained_board_and_feedback_text(self):
        text = self.run_main("--open", "1")
        out = check.history_dir(self.root, {"submittedAt": "2026-09-29T23:40:00+09:00",
                                            "shareHash": "0123456789abcdef"})
        board_html = (out / "board.html").read_text(encoding="utf-8")
        self.assertIn('"mode": "snapshot"', board_html)
        slot = board_html.split('<script id="board-data" type="application/json">', 1)[1].split("</script>", 1)[0]
        self.assertIn('"fig1.png": "data:image/png;base64,', slot)  # figure inlined, no server needed
        self.assertNotIn("aict-asset:", slot)
        fb = (out / "feedback.md").read_text(encoding="utf-8")
        self.assertIn("Manuscript (plans/manuscript.md)", fb)
        self.assertIn("(edited %s)" % check._stamp("2026-10-02T03:00:00.000Z"), fb)  # local time
        self.assertIn("Panel studies [[routinely report]] that SES", fb)
        self.assertIn("Cite two of them.", fb)
        self.assertIn("history board: ", text)
        self.assertIn("feedback text: ", text)
        # the history folder is gitignored by the board's own list
        self.assertIn("/.aict-history/", board.GITIGNORE_LINES)

    def test_reopen_uses_the_saved_copy_and_works_offline(self):
        self.run_main("--open", "latest")
        n_submission_fetches = sum("/api/my-submission" in u for u in self.calls)

        def offline(url, headers):
            raise urllib.error.URLError("down")
        check._http_get_json = offline
        text = self.run_main("--open", "1")
        self.assertIn("saved copy", text)
        self.assertEqual(n_submission_fetches, 1)
        listing = self.run_main("--history")
        self.assertIn("showing the copies saved on this machine", listing)
        self.assertIn("· saved", listing)

    def test_open_unknown_number_explains(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
            check.main(["--open", "9"])
        self.assertIn("--history", err.getvalue())

    def test_quote_context_reads_an_html_manuscript(self):
        payload = {"files": {"manuscript": {"path": "plans/manuscript.docx",
                                            "content": "<p>Alpha <strong>beta</strong> gamma.</p><table><tr><td>x &amp; y</td></tr></table>"}}}
        ctx = check.quote_context(payload, {"quote": "beta gamma", "docKey": "plans/manuscript.docx"})
        self.assertIn("Alpha [[beta gamma]]", ctx)
        self.assertIn("x & y", check.quote_context(payload, {"quote": "x & y"}))
