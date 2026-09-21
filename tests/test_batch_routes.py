"""Route and lifecycle tests for one-shot plan sign sessions."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

from tests.test_board import (
    BOARD,
    board,
    board_token_of,
    extract_payload,
    http_json,
    live_payload,
    make_project,
    serve_in_thread,
    spawn_board,
)


def link_component(root, slug, label, draft_version):
    master = root / "plans" / "master-plan.md"
    text = master.read_text(encoding="utf-8")
    old = "| %s | %s |" % ("1" if slug == "01-data-prep" else "2", label)
    link = "[%s](execution/%s/.draft-v%d.md)" % (
        "draft v%d" % draft_version, slug, draft_version)
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(old):
            cells = line.split("|")
            cells[4] = " %s " % link
            lines[i] = "|".join(cells)
            break
    master.write_text("\n".join(lines) + "\n", encoding="utf-8")


def served_payload(url):
    with urllib.request.urlopen(url + "/", timeout=5) as response:
        return extract_payload(response.read().decode("utf-8"))


class TestSignRoutes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        make_project(self.root)
        link_component(self.root, "01-data-prep", "Data prep", 2)
        self.draft = (
            self.root / "plans" / "execution" / "01-data-prep" / ".draft-v2.md"
        )
        self.payload = board.apply_sign(self.root, live_payload(self.root))
        self.entry = self.payload["sign"]["items"][0]
        self.url = None
        self.thread = None
        self.info = None

    def _start(self):
        self.url, self.info, self.thread = serve_in_thread(
            self.root, self.payload, timeout=15)
        self.addCleanup(self._finish)

    def _finish(self):
        if self.thread is None or not self.thread.is_alive():
            return
        try:
            http_json(self.url, "/api/sign/done", body={
                "boardToken": self.info["boardToken"],
            })
        except Exception:
            pass
        self.thread.join(timeout=5)

    def _approve(self, content_hash=None):
        return http_json(self.url, "/api/sign/approve", body={
            "component": self.entry["component"],
            "proposedVersion": self.entry["proposedVersion"],
            "contentHash": content_hash or self.entry["contentHash"],
            "boardToken": self.info["boardToken"],
        })

    def _ticket(self, version=2):
        return (self.root / "plans" / "execution" /
                (".aict-approved-01-data-prep-v%d" % version))

    def test_approve_writes_ticket(self):
        self._start()
        status, body, _ = self._approve()
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        ticket = self._ticket()
        self.assertTrue(ticket.is_file())
        self.assertEqual(json.loads(ticket.read_text(encoding="utf-8"))["version"], 2)

    def test_reject_writes_durable_feedback_file(self):
        self._start()
        status, body, _ = http_json(self.url, "/api/sign/reject", body={
            "component": "01-data-prep", "version": 2,
            "note": "Tighten the scope.",
            "annotations": [{"sectionHeading": "Goal", "quote": "Do it better.",
                             "comment": "Name the concrete outcome."}],
            "boardToken": self.info["boardToken"],
        })
        self.assertEqual((status, body), (200, {"ok": True}))
        feedback = (self.draft.parent / ".sign-feedback-v2.md")
        self.assertTrue(feedback.is_file())
        text = feedback.read_text(encoding="utf-8")
        self.assertIn("Tighten the scope.", text)
        self.assertIn("Do it better.", text)
        self.assertIn("Name the concrete outcome.", text)

    def test_feedback_survives_kill(self):
        proc, url = spawn_board(
            self.root, "--sign", "01-data-prep", "--timeout", "20")
        try:
            status, _, _ = http_json(url, "/api/sign/reject", body={
                "component": "01-data-prep", "version": 2,
                "note": "Persist before death.",
                "annotations": [{"quote": "Do it better.", "comment": "Revise."}],
                "boardToken": board_token_of(url),
            })
            self.assertEqual(status, 200)
            proc.kill()
            proc.wait(timeout=10)
            text = (self.draft.parent / ".sign-feedback-v2.md").read_text(
                encoding="utf-8")
            self.assertIn("Persist before death.", text)
            self.assertIn("Do it better.", text)
        finally:
            if proc.poll() is None:
                proc.kill()

    def test_disk_hash_mismatch_is_409(self):
        self._start()
        self.draft.write_text("# changed after serving\n", encoding="utf-8")
        status, body, _ = self._approve()
        self.assertEqual(status, 409)
        self.assertIn(body["error"], ("stale-draft", "hash-mismatch"))
        self.assertFalse(self._ticket().exists())

    def test_done_exits_zero_with_summary(self):
        proc, url = spawn_board(
            self.root, "--sign", "01-data-prep", "--timeout", "20")
        try:
            data = served_payload(url)
            entry = data["sign"]["items"][0]
            status, _, _ = http_json(url, "/api/sign/approve", body={
                "component": entry["component"],
                "proposedVersion": entry["proposedVersion"],
                "contentHash": entry["contentHash"],
                "boardToken": data["boardToken"],
            })
            self.assertEqual(status, 200)
            status, _, _ = http_json(
                url, "/api/sign/done", body={"boardToken": data["boardToken"]})
            self.assertEqual(status, 200)
            out, err = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("approved: 01-data-prep v2", out)
            self.assertIn("0 undecided", out)
        finally:
            if proc.poll() is None:
                proc.terminate()

    def test_timeout_exits_zero_with_existing_ticket(self):
        content = self.draft.read_text(encoding="utf-8")
        board.write_ticket(self.root, "01-data-prep", 2, content, "prior")
        proc, _url = spawn_board(
            self.root, "--sign", "01-data-prep", "--timeout", "1")
        try:
            out, err = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("approved: 01-data-prep v2", out)
            self.assertIn("timed out", out)
        finally:
            if proc.poll() is None:
                proc.terminate()

    def test_single_draft_works(self):
        self.assertEqual(len(self.payload["sign"]["items"]), 1)
        self.assertEqual(self.payload["sign"]["transport"], "ticket")

    def test_unrecognized_client_hash_requires_reload(self):
        self._start()
        status, body, _ = self._approve(content_hash="0" * 64)
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "hash-mismatch")


class TestSignSelection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        make_project(self.root)
        link_component(self.root, "01-data-prep", "Data prep", 2)

    def test_zero_eligible_prints_and_exits_zero_without_serving(self):
        (self.root / "plans" / "execution" / "01-data-prep" /
         ".draft-v2.md").unlink()
        run = subprocess.run(
            [sys.executable, str(BOARD), "--sign", "--no-open"],
            cwd=str(self.root), capture_output=True, text=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("no eligible", run.stderr)
        self.assertNotIn("Board:", run.stderr)

    def test_malformed_draft_excluded_with_repair_line(self):
        draft = (self.root / "plans" / "execution" / "01-data-prep" /
                 ".draft-v2.md")
        draft.write_text("# draft\n\nSigned off: placeholder\n", encoding="utf-8")
        run = subprocess.run(
            [sys.executable, str(BOARD), "--sign", "--no-open"],
            cwd=str(self.root), capture_output=True, text=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn(".draft-v2.md", run.stderr)
        self.assertIn("repair", run.stderr.lower())

    def test_sign_component_scopes_items(self):
        other = self.root / "plans" / "execution" / "02-other" / ".draft-v2.md"
        other.write_text("# Other v2 draft\n", encoding="utf-8")
        link_component(self.root, "02-other", "Other", 2)
        payload = board.apply_sign(
            self.root, live_payload(self.root), component="02-other")
        self.assertEqual(
            [i["component"] for i in payload["sign"]["items"]], ["02-other"])

    def test_archived_and_orphan_dirs_are_excluded(self):
        for slug in ("09-archived", "10-orphan"):
            comp = self.root / "plans" / "execution" / slug
            comp.mkdir()
            (comp / ".draft-v1.md").write_text("# hidden draft\n", encoding="utf-8")
        (self.root / "plans" / "archive").mkdir()
        (self.root / "plans" / "archive" / "master-plan-2026-07-01.md").write_text(
            "[v1](execution/09-archived/v1.md)\n", encoding="utf-8")
        payload = board.apply_sign(self.root, live_payload(self.root))
        self.assertEqual(
            [i["component"] for i in payload["sign"]["items"]],
            ["01-data-prep"])

    def test_sign_with_live_board_performs_handoff(self):
        live, _live_url = spawn_board(self.root, "--timeout", "20")
        sign = None
        try:
            sign, sign_url = spawn_board(
                self.root, "--sign", "01-data-prep", "--timeout", "20")
            self.assertEqual(live.wait(timeout=10), 5)
            data = served_payload(sign_url)
            status, _, _ = http_json(
                sign_url, "/api/sign/done",
                body={"boardToken": data["boardToken"]})
            self.assertEqual(status, 200)
            self.assertEqual(sign.wait(timeout=10), 0)
        finally:
            if live.poll() is None:
                live.terminate()
            if sign is not None and sign.poll() is None:
                sign.terminate()

    def test_gate_transport_preserved(self):
        gate = (self.root / "plans" / "execution" / "01-data-prep" /
                ".gate-v2.md")
        gate.write_text("<!-- gate reserved -->\n# gate proposal\n", encoding="utf-8")
        proc, url = spawn_board(
            self.root, "--gate", "01-data-prep/v2", "--timeout", "20")
        try:
            data = served_payload(url)
            self.assertEqual(data["sign"]["transport"], "hook")
            self.assertNotIn("gate", data)
            status, _, _ = http_json(
                url, "/api/approve", body={"boardToken": data["boardToken"]})
            self.assertEqual(status, 200)
            self.assertEqual(proc.wait(timeout=10), 0)
        finally:
            if proc.poll() is None:
                proc.terminate()

        gate.write_text("<!-- gate reserved -->\n# gate proposal\n", encoding="utf-8")
        proc, url = spawn_board(
            self.root, "--gate", "01-data-prep/v2", "--timeout", "20")
        try:
            token = board_token_of(url)
            status, _, _ = http_json(url, "/api/deny", body={
                "annotations": [], "feedbackMarkdown": "needs changes",
                "payloadHash": "x", "boardToken": token,
            })
            self.assertEqual(status, 200)
            self.assertEqual(proc.wait(timeout=10), 3)
            self.assertIn(
                "needs changes",
                (self.root / "plans" / ".board-feedback.md").read_text(
                    encoding="utf-8"))
        finally:
            if proc.poll() is None:
                proc.terminate()

    def test_payload_generation_pins_sign_without_changing_payload_files(self):
        plain = live_payload(self.root)
        signed = board.apply_sign(self.root, live_payload(self.root))
        self.assertNotEqual(
            board.payload_generation(plain), board.payload_generation(signed))
        self.assertEqual(board.payload_files(plain), board.payload_files(signed))

    def test_trailer_state_enrichment(self):
        version = self.root / "plans" / "execution" / "01-data-prep" / "v2.md"
        version.write_text(
            "# Data prep v2\n\nAmendment recorded, 2026-07-18\n",
            encoding="utf-8")
        payload = live_payload(self.root)
        group = next(g for g in payload["files"]["executionPlans"]
                     if g["component"] == "01-data-prep")
        v2 = next(v for v in group["versions"] if v["version"] == 2)
        self.assertEqual(v2["trailerState"], "amendment")


if __name__ == "__main__":
    unittest.main()
