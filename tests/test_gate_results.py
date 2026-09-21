# tests/test_gate_results.py
"""Sign-off gate: results-bundle immutability branch. Run:
    python3 -m unittest tests.test_gate_results -v
"""
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

GATE = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts" / "signoff_gate.py"
)


def make_initialized(root: Path):
    plans = root / "plans"
    rdir = plans / "execution" / "02-analysis" / "results" / "r1"
    rdir.mkdir(parents=True)
    (rdir / "manifest.json").write_text("{}", encoding="utf-8")
    (rdir / "report.md").write_text("# R\n", encoding="utf-8")
    (plans / "master-plan.md").write_text(
        "<!-- aict:master-plan -->\n# MP\n", encoding="utf-8")
    (root / "CLAUDE.md").write_text(
        "<!-- aict:start -->\nconventions\n", encoding="utf-8")
    return rdir


def run_gate(root, tool, path, content="x"):
    event = {"tool_name": tool, "cwd": str(root),
             "tool_input": {"file_path": str(path), "content": content}}
    p = subprocess.run([sys.executable, str(GATE)], input=json.dumps(event),
                       capture_output=True, text=True, timeout=30)
    decision = None
    if p.stdout.strip():
        decision = json.loads(p.stdout)["hookSpecificOutput"]["permissionDecision"]
    return p.returncode, decision


class TestGateResults(unittest.TestCase):
    def test_edit_inside_finalized_bundle_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            rdir = make_initialized(Path(tmp))
            code, decision = run_gate(tmp, "Edit", rdir / "report.md")
            self.assertEqual((code, decision), (0, "deny"))
            code, decision = run_gate(tmp, "Write", rdir / "manifest.json")
            self.assertEqual((code, decision), (0, "deny"))

    def test_verdict_create_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            rdir = make_initialized(Path(tmp))
            code, decision = run_gate(tmp, "Write", rdir / "verdict.json")
            self.assertEqual((code, decision), (0, "allow"))
            (rdir / "verdict.json").write_text("{}", encoding="utf-8")
            code, decision = run_gate(tmp, "Write", rdir / "verdict.json")
            self.assertEqual((code, decision), (0, "deny"))
            code, decision = run_gate(tmp, "Edit", rdir / "verdict.json")
            self.assertEqual((code, decision), (0, "deny"))

    def test_staging_writes_not_gated(self):
        with tempfile.TemporaryDirectory() as tmp:
            rdir = make_initialized(Path(tmp))
            staging = rdir.parent / ".staging-abc123" / "artifacts"
            staging.mkdir(parents=True)
            code, decision = run_gate(tmp, "Write", staging.parent / "manifest.json")
            self.assertEqual((code, decision), (0, None))

    def test_direct_new_rn_write_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            rdir = make_initialized(Path(tmp))
            code, decision = run_gate(
                tmp, "Write", rdir.parent / "r2" / "manifest.json")
            self.assertEqual((code, decision), (0, "deny"))

    def test_uninitialized_project_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rdir = root / "plans" / "execution" / "x" / "results" / "r1"
            rdir.mkdir(parents=True)
            (rdir / "report.md").write_text("# R\n", encoding="utf-8")
            code, decision = run_gate(tmp, "Edit", rdir / "report.md")
            self.assertEqual((code, decision), (0, None))


SIGN_OFF = "\n\n---\nSigned off: BK, 2026-07-07\n"


def _norm(text):
    """Mirror the gate's normalization for a trailer-less draft: strip trailing
    whitespace per line and trailing blank lines. The gate additionally strips a
    `Signed off:` trailer, so gate.normalize(signed) == _norm(draft)."""
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines) + "\n"


def make_init_component(root: Path, slug="03-x"):
    plans = root / "plans"
    (plans / "execution" / slug).mkdir(parents=True)
    (plans / "master-plan.md").write_text(
        "<!-- aict:master-plan -->\n# MP\n", encoding="utf-8")
    (root / "CLAUDE.md").write_text(
        "<!-- aict:start -->\nx\n", encoding="utf-8")
    return plans / "execution" / slug


def write_ticket(root: Path, slug, version, draft, *, expiry=None,
                 slug_field=None, version_field=None):
    doc = {
        "slug": slug_field or slug,
        "version": version if version_field is None else version_field,
        "contentHash": hashlib.sha256(_norm(draft).encode("utf-8")).hexdigest(),
        "approver": "BK", "batchId": "b1", "approvedAt": "2026-07-07 10:00",
        "expiry": time.time() + 604800 if expiry is None else expiry,
    }
    tp = root / "plans" / "execution" / (".aict-approved-%s-v%d" % (slug, version))
    tp.write_text(json.dumps(doc), encoding="utf-8")
    return tp


class TestGateBatchTickets(unittest.TestCase):
    DRAFT = ("# X — Execution Plan v1\n\n"
             "Provenance: retrospective — written 2026-07-07; covers 2026-02–2026-06\n\n"
             "## Goal and success criteria\n\nDo the thing; success is the thing done.\n")

    def _signed(self):
        return self.DRAFT.rstrip("\n") + SIGN_OFF

    def test_valid_ticket_allows_signed_write(self):
        # H1: ticket hashes the UNSIGNED draft; the SIGNED vN.md write must match.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            write_ticket(root, "03-x", 1, self.DRAFT)
            code, decision = run_gate(tmp, "Write", comp / "v1.md",
                                      content=self._signed())
            self.assertEqual((code, decision), (0, "allow"))

    def test_ticket_left_after_consume(self):
        # H3: consumption does not delete the ticket.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            tp = write_ticket(root, "03-x", 1, self.DRAFT)
            run_gate(tmp, "Write", comp / "v1.md", content=self._signed())
            self.assertTrue(tp.exists())

    def test_forged_ticket_write_denied(self):
        # H2: the agent cannot write a ticket through the tool the gate polices.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_init_component(root)
            tp = root / "plans" / "execution" / ".aict-approved-03-x-v1"
            code, decision = run_gate(tmp, "Write", tp, content='{"slug":"03-x"}')
            self.assertEqual((code, decision), (0, "deny"))

    def test_hash_mismatch_fast_denies(self):
        # H5: a draft changed since approval fast-denies (never opens the board).
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            write_ticket(root, "03-x", 1, self.DRAFT)
            tampered = self._signed().replace("Do the thing", "Do a DIFFERENT thing")
            code, decision = run_gate(tmp, "Write", comp / "v1.md", content=tampered)
            self.assertEqual((code, decision), (0, "deny"))

    def test_expired_ticket_fast_denies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            write_ticket(root, "03-x", 1, self.DRAFT, expiry=1.0)
            code, decision = run_gate(tmp, "Write", comp / "v1.md",
                                      content=self._signed())
            self.assertEqual((code, decision), (0, "deny"))

    def test_slug_version_mismatch_denies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            write_ticket(root, "03-x", 1, self.DRAFT, version_field=2)
            code, decision = run_gate(tmp, "Write", comp / "v1.md",
                                      content=self._signed())
            self.assertEqual((code, decision), (0, "deny"))

    def test_producer_ticket_allows_signed_write_e2e(self):
        # End-to-end: board.py's write_ticket (producer, hashes the unsigned
        # draft) must produce a ticket signoff_gate (consumer, sees the signed
        # write) accepts — proving both halves share normalize_plan.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            sys.path.insert(0, str(GATE.parent))
            import board  # noqa: E402
            board.write_ticket(root, "03-x", 1, self.DRAFT, "batch-e2e")
            code, decision = run_gate(tmp, "Write", comp / "v1.md",
                                      content=self._signed())
            self.assertEqual((code, decision), (0, "allow"))

    def test_amendment_recommitment_round_trip(self):
        """signed v1 -> recorded v2 -> trailerless v3 draft -> sign ticket -> signed v3"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comp = make_init_component(root)
            sys.path.insert(0, str(GATE.parent))
            import board  # noqa: E402
            import signoff_gate as gate  # noqa: E402

            marker = '<!-- aict-model {"model":"sonnet","effort":null} -->'
            v1 = (marker + "\n# X — Execution Plan v1\n\n"
                  "## Goal and success criteria\n\nDo the thing.\n\n"
                  "Signed off: BK, 2026-07-17\n")
            (comp / "v1.md").write_text(v1, encoding="utf-8")
            self.assertEqual(gate.parse_trailer(v1)["kind"], "signed")

            amendment = (marker + "\n# X — Execution Plan v2\n\n"
                         "Supersedes: v1 — record the executed change.\n\n"
                         "## Goal and success criteria\n\nDo the revised thing.\n\n"
                         "---\nAmendment recorded, 2026-07-18\n")
            code, decision = run_gate(
                root, "Write", comp / "v2.md", content=amendment)
            self.assertEqual((code, decision), (0, "allow"))
            (comp / "v2.md").write_text(amendment, encoding="utf-8")

            candidate = gate.strip_trailer(amendment)
            candidate = candidate.replace("Execution Plan v2", "Execution Plan v3", 1)
            candidate = candidate.replace(
                "Supersedes: v1 — record the executed change.",
                "Supersedes: v2 — re-commitment for re-execution",
                1,
            )
            candidate = candidate.replace('"model":"sonnet"', '"model":"opus"', 1)
            self.assertEqual(gate.parse_trailer(candidate)["kind"], "none")
            draft = comp / ".draft-v3.md"
            draft.write_text(candidate, encoding="utf-8")

            master = (
                "<!-- aict:master-plan -->\n# MP\n\n"
                "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n"
                "|---|-----------|--------|----------------|-----------------|--------|\n"
                "| 3 | X | planned | [v2](execution/03-x/v2.md) | — | RQ1 |\n"
            )
            (root / "plans" / "master-plan.md").write_text(master, encoding="utf-8")
            payload = {
                "files": {
                    "masterPlan": {"content": master},
                    "executionPlans": [{
                        "component": "03-x",
                        "versions": [{"version": 1, "content": v1},
                                     {"version": 2, "content": amendment}],
                        "draft": {"proposedVersion": 3,
                                  "path": "plans/execution/03-x/.draft-v3.md",
                                  "content": candidate},
                    }],
                },
            }
            signed_payload = board.apply_sign(root, payload, "03-x")
            self.assertIsNotNone(signed_payload)
            item = signed_payload["sign"]["items"][0]
            self.assertEqual(item["content"], candidate)
            self.assertEqual(
                item["contentHash"],
                hashlib.sha256(candidate.encode("utf-8")).hexdigest(),
            )
            ticket = board.write_ticket(root, "03-x", 3, candidate, "round-trip")
            ticket_doc = json.loads(ticket.read_text(encoding="utf-8"))
            self.assertEqual(
                ticket_doc["contentHash"],
                hashlib.sha256(_norm(candidate).encode("utf-8")).hexdigest(),
            )

            v3 = candidate.rstrip("\n") + "\n\nSigned off: BK, 2026-07-18\n"
            code, decision = run_gate(root, "Write", comp / "v3.md", content=v3)
            self.assertEqual((code, decision), (0, "allow"))


if __name__ == "__main__":
    unittest.main()
