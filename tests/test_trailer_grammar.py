import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "managing-aict" / "scripts"))
from signoff_gate import parse_trailer, strip_trailer


FIXTURES = Path(__file__).resolve().parents[1] / "board" / "src" / "lib" / "__fixtures__" / "trailer"


def test_fixture_contract():
    expected = json.loads((FIXTURES / "expectations.json").read_text())
    assert len(expected) >= 8
    for name, exp in expected.items():
        got = parse_trailer((FIXTURES / f"{name}.md").read_text())
        assert got["kind"] == exp["kind"], name
        assert len(got["violations"]) == exp["violations"], name


def test_trailer_line_extracted():
    r = parse_trailer("# t\nbody\n\nSigned off: BK, 2026-07-18\n")
    assert r["kind"] == "signed" and r["line"] == "Signed off: BK, 2026-07-18"


def test_amendment_form_is_exact():
    assert parse_trailer("# t\nAmendment recorded, 2026-7-8\n")["kind"] == "none"
    assert parse_trailer("# t\nAmendment recorded after execution, 2026-07-18\n")["kind"] == "none"


def test_strip_trailer_roundtrip():
    body = "# t\nbody\n"
    for trailer in ("Signed off: BK, 2026-07-18", "Amendment recorded, 2026-07-18"):
        assert strip_trailer(body + "\n---\n" + trailer + "\n") == body
        assert strip_trailer(body + trailer + "\n") == body
        assert parse_trailer(strip_trailer(body + trailer + "\n"))["kind"] == "none"
    assert strip_trailer(body) == body
