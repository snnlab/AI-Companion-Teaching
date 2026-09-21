# tests/test_gate_explicitness.py
"""Sign-session selection, numeric draft selection, timeout draft persistence,
and recovery-message policy.
Spec: docs/specs/2026-07-13-gate-explicitness-design.md. Run:
    python3 -m unittest tests.test_gate_explicitness -v
"""
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import board  # noqa: E402

from tests.test_gate_results import (  # noqa: E402
    GATE, make_init_component, write_ticket,
)

DRAFT = "# Plan v1\n\nDo the thing.\n"
SIGNED = DRAFT + "\n---\n\nSigned off: BK, 2026-07-13\n"


def add_draft(root, slug, version=1, content=DRAFT):
    comp = root / "plans" / "execution" / slug
    comp.mkdir(parents=True, exist_ok=True)
    p = comp / (".draft-v%d.md" % version)
    p.write_text(content, encoding="utf-8")
    return p


def run_gate_reason(root, path, content):
    """Like test_gate_results.run_gate but returns (decision, reason)."""
    event = {"tool_name": "Write", "cwd": str(root),
             "tool_input": {"file_path": str(path), "content": content}}
    p = subprocess.run([sys.executable, str(GATE)], input=json.dumps(event),
                       capture_output=True, text=True, timeout=30)
    doc = json.loads(p.stdout)["hookSpecificOutput"]
    return doc["permissionDecision"], doc["permissionDecisionReason"]


def link_tracker(root, slug):
    master = root / "plans" / "master-plan.md"
    master.write_text(
        master.read_text(encoding="utf-8")
        + "\n[draft](execution/%s/.draft-v1.md)\n" % slug,
        encoding="utf-8",
    )


class TestSignSelection(unittest.TestCase):
    def payload(self, root):
        return board.collect_payload(root, "live", None)

    def test_zero_drafts_returns_without_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_init_component(root)
            link_tracker(root, "03-x")
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                payload = board.apply_sign(root, self.payload(root))
            self.assertIsNone(payload)
            self.assertIn("no eligible", err.getvalue())

    def test_single_pending_proceeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_init_component(root)
            link_tracker(root, "03-x")
            add_draft(root, "03-x")
            payload = board.apply_sign(root, self.payload(root))
            self.assertEqual(len(payload["sign"]["items"]), 1)

    def test_ticketed_draft_is_enumerated_for_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_init_component(root)
            link_tracker(root, "03-x")
            add_draft(root, "03-x")
            write_ticket(root, "03-x", 1, DRAFT)
            payload = board.apply_sign(root, self.payload(root))
            self.assertTrue(payload["sign"]["items"][0]["ticketed"])

    def test_numeric_newest_draft_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_init_component(root)
            link_tracker(root, "03-x")
            add_draft(root, "03-x", version=9, content="# nine\n")
            add_draft(root, "03-x", version=10, content="# ten\n")
            payload = board.apply_sign(root, self.payload(root))
            self.assertEqual(payload["sign"]["items"][0]["proposedVersion"], 10)
            self.assertIn("ten", payload["sign"]["items"][0]["content"])


class TestCliPairing(unittest.TestCase):
    def test_sign_without_component_means_all(self):
        args = board.parse_args(["--sign", "--no-open"])
        self.assertEqual(args.sign, "ALL")

    def test_sign_with_component_parses(self):
        args = board.parse_args(["--sign", "03-x", "--no-open"])
        self.assertEqual(args.sign, "03-x")

    def test_retired_batch_flags_are_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            board.parse_args(["--gate-batch"])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            board.parse_args(["--allow-single"])


class TestPayloadDraftNumeric(unittest.TestCase):
    def test_payload_picks_numeric_newest_draft(self):
        from tests.test_board import make_project
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_project(root)
            comp = root / "plans" / "execution" / "01-data-prep"
            (comp / ".draft-v9.md").write_text("# nine\n", encoding="utf-8")
            (comp / ".draft-v10.md").write_text("# ten\n", encoding="utf-8")
            # make_project ships a .draft-v2.md; v10 must win over both.
            payload = board.collect_payload(root, "live", None)
            g = next(g for g in payload["files"]["executionPlans"]
                     if g["component"] == "01-data-prep")
            self.assertEqual(g["draft"]["proposedVersion"], 10)


def _load_gate_module():
    spec = importlib.util.spec_from_file_location("signoff_gate_inproc", GATE)
    sg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sg)
    return sg


def _run_gate_inproc(sg, root, path, content):
    event = {"tool_name": "Write", "cwd": str(root),
             "tool_input": {"file_path": str(path), "content": content}}
    out = io.StringIO()
    with mock.patch("sys.stdin", io.StringIO(json.dumps(event))), \
            contextlib.redirect_stdout(out), self_assert_exit():
        sg.main()
    doc = json.loads(out.getvalue())["hookSpecificOutput"]
    return doc["permissionDecision"], doc["permissionDecisionReason"]


@contextlib.contextmanager
def self_assert_exit():
    try:
        yield
    except SystemExit:
        pass


class TestTimeoutPersistsDraft(unittest.TestCase):
    def _timeout_run(self, root, comp, content):
        sg = _load_gate_module()
        stub = subprocess.CompletedProcess(args=[], returncode=2,
                                           stdout="", stderr="")
        with mock.patch.object(sg.subprocess, "run", return_value=stub):
            return _run_gate_inproc(sg, root, comp / "v1.md", content)

    def test_timeout_persists_stripped_draft_and_routes_to_sign(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            decision, reason = self._timeout_run(root, comp, SIGNED)
            self.assertEqual(decision, "deny")
            draft = comp / ".draft-v1.md"
            self.assertTrue(draft.exists())
            self.assertEqual(draft.read_text(encoding="utf-8"), DRAFT)
            self.assertIn(".draft-v1.md", reason)
            self.assertIn("/aict:sign", reason)
            self.assertNotIn("NO_GATE", reason)

    def test_timeout_overwrites_stale_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            add_draft(root, "03-x", content="# stale draft\n")
            decision, reason = self._timeout_run(root, comp, SIGNED)
            self.assertEqual(decision, "deny")
            self.assertEqual((comp / ".draft-v1.md").read_text(encoding="utf-8"),
                             DRAFT)


class TestTicketErrorMessages(unittest.TestCase):
    def test_corrupt_ticket_names_sign_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            tp = root / "plans" / "execution" / ".aict-approved-03-x-v1"
            tp.write_text("not json", encoding="utf-8")
            decision, reason = run_gate_reason(root, comp / "v1.md", SIGNED)
            self.assertEqual(decision, "deny")
            self.assertIn("unreadable or corrupt", reason)
            self.assertIn("/aict:sign", reason)
            self.assertNotIn("--gate-batch", reason)

    def test_expired_ticket_names_sign_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            write_ticket(root, "03-x", 1, DRAFT, expiry=1.0)
            decision, reason = run_gate_reason(root, comp / "v1.md", SIGNED)
            self.assertEqual(decision, "deny")
            self.assertIn("expired", reason)
            self.assertIn("/aict:sign", reason)
            self.assertNotIn("--gate-batch", reason)

    def test_hash_mismatch_names_sign_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            write_ticket(root, "03-x", 1, DRAFT)
            tampered = SIGNED.replace("Do the thing", "Do a DIFFERENT thing")
            decision, reason = run_gate_reason(root, comp / "v1.md", tampered)
            self.assertEqual(decision, "deny")
            self.assertIn("content-hash mismatch", reason)
            self.assertIn("/aict:sign", reason)
            self.assertNotIn("--gate-batch", reason)

    def test_order_bound_orphan_fast_denies_in_actual_hook(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            ticket = write_ticket(root, "03-x", 1, DRAFT)
            doc = json.loads(ticket.read_text(encoding="utf-8"))
            doc["orderActionId"] = "missing-order"
            ticket.write_text(json.dumps(doc), encoding="utf-8")

            decision, reason = run_gate_reason(root, comp / "v1.md", SIGNED)

            self.assertEqual(decision, "deny")
            self.assertIn("not bound to the current pending board order", reason)

    def test_order_bound_ticket_with_matching_order_allows_actual_hook(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            ticket = write_ticket(root, "03-x", 1, DRAFT)
            doc = json.loads(ticket.read_text(encoding="utf-8"))
            doc["orderActionId"] = "current-order"
            ticket.write_text(json.dumps(doc), encoding="utf-8")
            (root / "plans" / ".board-feedback.md").write_text(
                "# Feedback\n\n```json board-feedback\n"
                '{"actionId": "current-order"}\n```\n', encoding="utf-8")

            decision, _ = run_gate_reason(root, comp / "v1.md", SIGNED)

            self.assertEqual(decision, "allow")


class TestTicketRoundTripAfterTimeout(unittest.TestCase):
    def test_board_ticket_over_persisted_draft_admits_signed_write(self):
        # timeout persists the draft -> researcher approves on the board
        # (write_ticket over the draft) -> the SAME signed write is admitted.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            sg = _load_gate_module()
            stub = subprocess.CompletedProcess(args=[], returncode=2,
                                               stdout="", stderr="")
            with mock.patch.object(sg.subprocess, "run", return_value=stub):
                _run_gate_inproc(sg, root, comp / "v1.md", SIGNED)
            draft = (comp / ".draft-v1.md").read_text(encoding="utf-8")
            board.write_ticket(root, "03-x", 1, draft, "b-test")
            from tests.test_gate_results import run_gate
            code, decision = run_gate(tmp, "Write", comp / "v1.md",
                                      content=SIGNED)
            self.assertEqual((code, decision), (0, "allow"))


if __name__ == "__main__":
    unittest.main()
