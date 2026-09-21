import subprocess
import tempfile
from pathlib import Path
from unittest import mock

from tests.test_gate_explicitness import _load_gate_module, _run_gate_inproc
from tests.test_gate_results import make_init_component, write_ticket


SIGNED = "# Plan v1\n\nBody.\n\nSigned off: BK, 2026-07-18\n"
AMENDMENT = "# Plan v2\n\nBody revised.\n\nAmendment recorded, 2026-07-18\n"


def run_gate(root, path, content, returncode=2):
    sg = _load_gate_module()
    stub = subprocess.CompletedProcess(args=[], returncode=returncode,
                                       stdout="", stderr="")
    with mock.patch.object(sg.subprocess, "run", return_value=stub) as launched:
        decision, reason = _run_gate_inproc(sg, root, path, content)
    return sg, launched, decision, reason


def test_amendment_write_allowed():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        (comp / "v1.md").write_text(SIGNED, encoding="utf-8")
        _, launched, decision, reason = run_gate(root, comp / "v2.md", AMENDMENT)
        assert decision == "allow"
        assert "Amendment recorded" in reason
        launched.assert_not_called()


def test_amendment_v1_denied():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        _, launched, decision, reason = run_gate(root, comp / "v1.md", AMENDMENT)
        assert decision == "deny"
        assert "/aict:sign" in reason
        launched.assert_not_called()


def test_amendment_gap_denied():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        (comp / "v1.md").write_text(SIGNED, encoding="utf-8")
        _, launched, decision, reason = run_gate(root, comp / "v3.md", AMENDMENT)
        assert decision == "deny"
        assert "v2.md does not exist" in reason
        launched.assert_not_called()


def test_amendment_overwrite_denied():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        (comp / "v1.md").write_text(SIGNED, encoding="utf-8")
        (comp / "v2.md").write_text(AMENDMENT, encoding="utf-8")
        _, launched, decision, reason = run_gate(root, comp / "v2.md", AMENDMENT)
        assert decision == "deny"
        assert "immutable" in reason
        launched.assert_not_called()


def test_interior_signature_denied():
    content = ("# Plan v2\n\nSigned off: BK, 2026-07-18\n\nBody revised.\n\n"
               "Amendment recorded, 2026-07-18\n")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        (comp / "v1.md").write_text(SIGNED, encoding="utf-8")
        _, launched, decision, reason = run_gate(root, comp / "v2.md", content)
        assert decision == "deny"
        assert "trailer grammar" in reason
        launched.assert_not_called()


def test_signed_write_with_interior_amendment_denied():
    draft = "# Plan v1\n\nAmendment recorded, 2026-07-18\n\nBody.\n"
    content = draft + "\nSigned off: BK, 2026-07-18\n"
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        write_ticket(root, "03-x", 1, draft)
        _, launched, decision, reason = run_gate(root, comp / "v1.md", content)
        assert decision == "deny"
        assert "trailer grammar" in reason
        launched.assert_not_called()


def test_no_trailer_still_falls_through_to_gate():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        _, launched, decision, reason = run_gate(
            root, comp / "v1.md", "# Plan v1\n\nBody.\n", returncode=3)
        assert launched.called
        assert decision == "deny"
        assert "requests changes" in reason


def test_timeout_persists_stripped_draft():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        comp = make_init_component(root)
        sg, launched, decision, reason = run_gate(root, comp / "v1.md", SIGNED)
        assert launched.called
        assert decision == "deny"
        draft = (comp / ".draft-v1.md").read_text(encoding="utf-8")
        assert sg.parse_trailer(draft)["kind"] == "none"
        assert "/aict:sign" in reason
