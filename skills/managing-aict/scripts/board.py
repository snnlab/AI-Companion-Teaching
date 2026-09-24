#!/usr/bin/env python3
"""aict: serve or export the project board.

Stdlib only, Python 3.9+. Modes:
  (default)          serve the live board; block until feedback; print it to stdout
  --export [PATH]    write a static read-only snapshot (default plans/board.html)
  --share [PATH]     write an annotatable remote board for collaborators
                     (default plans/board-share.html; --focus prunes to one component)
  --publish          push the static board to the repo's GitHub Pages (gh-pages)
  --collect          print pending feedback from an interrupted session (a
                     non-destructive peek; delete it with --ack after routing)
  --collect FILE     print a collaborator's feedback file (never deletes it;
                     researcher-action keys/headings are stripped; stderr
                     notes STALE if plans changed since the share)
  --ack              acknowledge (delete) the routed pending order

Exit codes: 0 feedback delivered / export or share written / feedback collected;
1 usage or environment error; 2 timeout with no feedback; 3 nothing to
collect/acknowledge; 4 stale payload (an approve targeted a draft that changed
on disk — relaunch to regenerate); 5 closed by sign-session handoff; 130 cancelled.
"""

import argparse
import base64
import datetime
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import webbrowser
import zipfile
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Share the gate's plan normalization so a batch ticket's hash (over the unsigned
# draft) matches the gate's hash (over the signed vN.md write). Must not drift.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from signoff_gate import normalize_plan, parse_trailer, strip_trailer, TICKET_PREFIX  # noqa: E402
from results import changed_sources  # noqa: E402
import models  # noqa: E402  (model-profile parse/view/generate — Models tab)

TICKET_TTL = 7 * 24 * 3600  # 7 days — sized to a resumable multi-session adoption


def _host_is_local(value):
    if not value:
        return False
    host = value.split("]")[0].lstrip("[") if value.startswith("[") else value.split(":")[0]
    return host in ("127.0.0.1", "localhost", "::1")


def local_request_ok(headers):
    """Guard for the local board server's mutating endpoints. Rejects
    cross-origin / non-localhost / wrong-content-type requests before any
    state change, so a page the researcher merely visits can't forge feedback
    or a sign-off ticket via a no-preflight 'simple request'."""
    ct = (headers.get("Content-Type") or "").split(";")[0].strip()
    if ct != "application/json":
        return False
    if not _host_is_local(headers.get("Host")):
        return False
    origin = headers.get("Origin")
    if origin:  # when present it must be a localhost origin
        rest = origin.split("://", 1)[-1]
        if not _host_is_local(rest):
            return False
    return True


SLOT = '<script id="board-data" type="application/json">{}</script>'
SLOT_OPEN = '<script id="board-data" type="application/json">'
GITIGNORE_LINES = [
    "/.board-feedback.md",
    "/.board-feedback.md.tmp",
    "/.aict-seed-*.json",
    "/.aict-review-*.txt",
    "/.board.lock",
    "/board-share.html",
    "/execution/*/.draft-v*.md",
    "/execution/*/.gate-*.md",
    "/execution/*/.sign-feedback-v*.md",
    "/execution/.aict-approved-*",
    "/execution/*/results/.staging-*/",
    "/.board-web/",
    "/.board-web-inbox/",
    "/.board-web-pulled.json",
    "/.board-web-pulled.json.tmp",
]

FENCE_RE = re.compile(r"```json board-feedback\n(.*?)\n```", re.DOTALL)

WEB_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "assets" / "web-template"


def web_project_hash(root):
    return hashlib.sha256(str(Path(root).resolve()).encode()).hexdigest()[:16]


def plugin_data_dir(namespace):
    """<CLAUDE_PLUGIN_DATA>/<namespace>, else ~/.aict/<namespace>.

    Before the AICT rename this lived under ~/.papertrail/<namespace>, and it
    holds real state: the student's roster server URL and personal token, the
    set of instructor comments already pulled, the instructor's published
    board URL and pull key. Silently starting from an empty directory would
    read to the user as "the tool forgot my server", so move a legacy
    directory across once, and keep reading it in place if the move fails.
    """
    base = os.environ.get("CLAUDE_PLUGIN_DATA")
    d = Path(base) / namespace if base else Path.home() / ".aict" / namespace
    if not d.exists():
        legacy = Path.home() / ".papertrail" / namespace
        if legacy.is_dir():
            try:
                d.parent.mkdir(parents=True, exist_ok=True)
                legacy.rename(d)
            except OSError:
                return legacy
    return d


def _web_data_dir():
    return plugin_data_dir("web")


def web_config_path(root):
    return _web_data_dir() / ("%s.json" % web_project_hash(root))


def read_web_config(root):
    name = "%s.json" % web_project_hash(root)
    try:
        return json.loads((_web_data_dir() / name).read_text())
    except (OSError, ValueError):
        return None


def write_web_config(root, cfg):
    p = web_config_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg))
    os.chmod(p, 0o600)


def die(msg, code=1):
    print("board: %s" % msg, file=sys.stderr)
    sys.exit(code)


def find_root():
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip())
    except Exception:
        pass
    return Path.cwd()


def git_info(root, paths):
    info = {"available": False}
    try:
        head = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=str(root), timeout=10,
        )
        if head.returncode != 0:
            return info
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, cwd=str(root), timeout=10,
        )
        info = {
            "available": True,
            "head": head.stdout.strip(),
            "branch": branch.stdout.strip() if branch.returncode == 0 else "",
            "fileDates": {},
        }
        for rel in paths:
            try:
                last = subprocess.run(
                    ["git", "log", "-1", "--format=%cI", "--", rel],
                    capture_output=True, text=True, cwd=str(root), timeout=10,
                )
                first = subprocess.run(
                    ["git", "log", "--reverse", "--format=%cI", "--", rel],
                    capture_output=True, text=True, cwd=str(root), timeout=10,
                )
                dates = {}
                if last.returncode == 0 and last.stdout.strip():
                    dates["lastCommit"] = last.stdout.strip()
                if first.returncode == 0 and first.stdout.strip():
                    dates["firstCommit"] = first.stdout.strip().splitlines()[0]
                if dates:
                    info["fileDates"][rel] = dates
            except Exception:
                continue
    except Exception:
        return {"available": False}
    return info


def read_file(root, rel):
    # Always emit POSIX-style paths in the payload — the board UI, hosted
    # comment anchoring (docKey), share_hash, and the classroom server's
    # reverify all key on forward-slash paths. On Windows str(Path.relative_to)
    # yields backslashes, which e.g. break reverify's git-timing slug match.
    rel = str(rel).replace("\\", "/")
    p = root / rel
    return {"path": rel, "content": p.read_text(encoding="utf-8", errors="replace")}


_DOCX_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _extract_docx_text(p):
    """Best-effort plain-text extraction from a .docx (an OOXML zip). Stdlib
    only (zipfile + ElementTree) — deliberately NOT mammoth/pandoc: no extra
    pip dependency, and board.py's Markdown renderer escapes raw HTML by
    policy anyway, so there is nothing to gain from an HTML conversion.
    Paragraphs styled Heading1-6 are prefixed with '#'*N so the manuscript
    still gets a heading outline; anything unexpected in a paragraph's style
    is treated as body text rather than raising."""
    with zipfile.ZipFile(p) as z:
        xml_bytes = z.read("word/document.xml")
    root_el = ET.fromstring(xml_bytes)
    w = _DOCX_W_NS
    lines = []
    for para in root_el.iter(w + "p"):
        text = "".join(node.text or "" for node in para.iter(w + "t"))
        if not text.strip():
            continue
        level = 0
        pstyle = para.find(f"{w}pPr/{w}pStyle")
        if pstyle is not None:
            val = pstyle.get(w + "val") or ""
            m = re.fullmatch(r"Heading(\d)", val)
            if m:
                level = min(int(m.group(1)), 6)
        lines.append((("#" * level + " ") if level else "") + text)
    return "\n\n".join(lines)


_MANUSCRIPT_CANDIDATES = [
    ("manuscript.md", "markdown"),
    ("manuscript.docx", "docx-text"),
    ("manuscript.hwp", "unsupported"),
    ("manuscript.hwpx", "unsupported"),
]


def _read_manuscript_file(root):
    """Finds plans/manuscript.{md,docx,hwp,hwpx} in that priority order.
    Markdown is the encouraged path; docx is read via best-effort stdlib text
    extraction; hwp/hwpx are surfaced as unsupported rather than guessed at —
    there's no reliable stdlib-only parse path for the legacy binary format,
    and no sample file in this repo to validate an hwpx (zip/XML) attempt
    against. Returns None when no manuscript file exists at all."""
    plans = root / "plans"
    for name, fmt in _MANUSCRIPT_CANDIDATES:
        p = plans / name
        if not p.is_file():
            continue
        rel = "plans/" + name
        if fmt == "unsupported":
            return {
                "path": rel,
                "content": "",
                "format": "unsupported",
                "note": "HWP files can't be previewed on the board. Write your "
                        "manuscript in plans/manuscript.md (recommended), or "
                        "export it to Word (plans/manuscript.docx).",
            }
        if fmt == "markdown":
            entry = read_file(root, rel)
            entry["format"] = "markdown"
            return entry
        # docx
        try:
            content = _extract_docx_text(p)
        except (KeyError, zipfile.BadZipFile, ET.ParseError, OSError):
            return {
                "path": rel,
                "content": "",
                "format": "unsupported",
                "note": "This Word file couldn't be read (it may be corrupted "
                        "or not a standard .docx). Write your manuscript in "
                        "plans/manuscript.md instead.",
            }
        return {
            "path": rel,
            "content": content,
            "format": "docx-text",
            "note": "Converted from Word — formatting, images, and tables are "
                    "not preserved. Write directly in plans/manuscript.md for "
                    "full fidelity.",
        }
    return None


def payload_files(payload):
    """Every embedded plan file in the payload, mirroring the client's allFiles()."""
    f = payload["files"]
    out = [f["masterPlan"], f["decisionLog"]]
    for g in f["executionPlans"]:
        out.extend(g["versions"])
        out.extend(g.get("draftSnapshots", []))
        if g.get("draft"):
            out.append(g["draft"])
        for b in g.get("results", []):
            out.append(b["manifestRaw"])
            if b.get("report"):
                out.append(b["report"])
            if b.get("verdictRaw"):
                out.append(b["verdictRaw"])
            out.extend(b.get("scripts", []))
            if b.get("publishedReport"):
                out.append(b["publishedReport"])
    out.extend(f["reviews"])
    if f.get("history"):
        out.append(f["history"])
    out.extend(f.get("archives", []))
    if f.get("manuscript"):
        out.append(f["manuscript"])
    return out


def share_hash(files):
    """sha256 over sorted (path, content) pairs; first 16 hex chars.
    Python-only contract: --share stamps it, --collect recomputes it.
    The client never computes this hash, it only echoes it back."""
    h = hashlib.sha256()
    for f in sorted(files, key=lambda x: x["path"]):
        h.update(f["path"].encode("utf-8"))
        h.update(b"\x00")
        h.update(f["content"].encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def fnv1a_hex(s):
    """Exact port of the client's hashContent (hostedComments.ts): FNV-1a over
    UTF-16 code units. Do not change one side without the other — the pinned
    cross-language vectors live in tests/test_board.py and hostedComments.test.ts."""
    h = 0x811C9DC5
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


REPORT_MARKER_PREFIX = "<!-- aict-report"


def _strip_report_marker(content):
    """Drop the first line when it is (or tries to be) a report marker."""
    first, sep, rest = content.partition("\n")
    if first.lstrip().startswith(REPORT_MARKER_PREFIX):
        return rest
    return content


def collect_results(root, comp_dir):
    bundles = []
    res_dir = comp_dir / "results"
    if not res_dir.is_dir():
        return bundles
    for rdir in sorted(res_dir.iterdir()):
        m = re.fullmatch(r"r(\d+)", rdir.name)
        if not m or not rdir.is_dir():
            continue
        manifest_p = rdir / "manifest.json"
        if not manifest_p.is_file():
            continue
        try:
            manifest = json.loads(manifest_p.read_text(encoding="utf-8"))
        except ValueError:
            manifest = None
        bundle = {
            "resultsVersion": int(m.group(1)),
            "dir": rdir.relative_to(root).as_posix(),
            "manifest": manifest,
            "manifestRaw": read_file(root, str(manifest_p.relative_to(root))),
            "report": None,
            "verdict": None,
            "verdictRaw": None,
            "scripts": [],
            "assets": {},
            "publishedReport": None,
            "reportFormats": {"pdf": False, "docx": False},
        }
        if (rdir / "report.md").is_file():
            bundle["report"] = read_file(root, str((rdir / "report.md").relative_to(root)))
        vp = rdir / "verdict.json"
        if vp.is_file():
            bundle["verdictRaw"] = read_file(root, str(vp.relative_to(root)))
            try:
                bundle["verdict"] = json.loads(bundle["verdictRaw"]["content"])
            except ValueError:
                bundle["verdict"] = None
        sdir = rdir / "scripts"
        if sdir.is_dir():
            for sf in sorted(sdir.iterdir()):
                if sf.is_file():
                    bundle["scripts"].append(read_file(root, str(sf.relative_to(root))))
        rep_name = "%s-r%d-report" % (comp_dir.name, int(m.group(1)))
        rep_dir = root / "plans" / "reports"
        rep_md = rep_dir / (rep_name + ".md")
        bundle["publishedReport"] = (
            read_file(root, str(rep_md.relative_to(root))) if rep_md.is_file() else None
        )
        bundle["reportFormats"] = {
            "pdf": (rep_dir / (rep_name + ".pdf")).is_file(),
            "docx": (rep_dir / (rep_name + ".docx")).is_file(),
        }
        bundles.append(bundle)
    bundles.sort(key=lambda b: b["resultsVersion"])
    return bundles


# v0.10: only sanitizable table formats inline; CSV/TSV/tex/json/txt are
# click-to-open links — the board displays a table's typeset render instead.
TEXT_INLINE_EXTS = {".md", ".html"}
TEXT_INLINE_MAX = 200 * 1024

TEXT_PLAIN_EXTS = {".md", ".csv", ".tsv", ".txt", ".log", ".json", ".tex"}
INLINE_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".pdf": "application/pdf",
}


def artifact_headers(name):
    """Live /artifact/ response policy: text renders as plain text, images and
    PDF keep their type, anything else (incl. .html/.xml — active content on
    the board origin, which embeds the per-boot mutation token) is forced to
    download. The serve() handler adds nosniff + CSP sandbox on top. The TS
    mirror is artifactDisplay.inlineSafe — keep the whitelists in sync."""
    ext = os.path.splitext(name)[1].lower()
    if ext in TEXT_PLAIN_EXTS:
        return "text/plain; charset=utf-8", "inline"
    if ext in INLINE_MIME:
        return INLINE_MIME[ext], "inline"
    return ("application/octet-stream",
            'attachment; filename="%s"' % name.replace('"', ""))


def iter_bundles(payload):
    for g in payload["files"]["executionPlans"]:
        for b in g.get("results", []):
            yield g["component"], b


def build_assets(root, payload):
    """Fill bundle['assets'] (basename -> URL) and artifact inlineText."""
    live = payload["mode"] == "live"
    for component, b in iter_bundles(payload):
        adir = root / b["dir"] / "artifacts"
        if not adir.is_dir():
            continue
        for f in sorted(adir.iterdir()):
            if not f.is_file():
                continue
            if live:
                b["assets"][f.name] = "/artifact/%s/r%d/%s" % (
                    component, b["resultsVersion"], f.name)
            else:
                mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                data = base64.b64encode(f.read_bytes()).decode("ascii")
                b["assets"][f.name] = "data:%s;base64,%s" % (mime, data)
        if b.get("manifest") and isinstance(b["manifest"].get("artifacts"), list):
            for art in b["manifest"]["artifacts"]:
                fp = art.get("file")
                if not fp:
                    continue
                p = root / b["dir"] / fp
                if (p.is_file() and p.suffix.lower() in TEXT_INLINE_EXTS
                        and p.stat().st_size <= TEXT_INLINE_MAX):
                    art["inlineText"] = p.read_text(encoding="utf-8", errors="replace")


def artifact_map(root, payload):
    """Route path -> absolute file path, built ONLY from files on disk."""
    amap = {}
    for component, b in iter_bundles(payload):
        adir = root / b["dir"] / "artifacts"
        if not adir.is_dir():
            continue
        for f in sorted(adir.iterdir()):
            if f.is_file():
                amap["/artifact/%s/r%d/%s" % (component, b["resultsVersion"], f.name)] = f
    return amap


def report_map(root, payload):
    """Route path -> absolute file path for report PDF/DOCX downloads.
    Same exact-key contract as artifact_map: built ONLY from files on disk,
    looked up by exact key — no filesystem joins with client input."""
    rmap = {}
    for component, b in iter_bundles(payload):
        fmts = b.get("reportFormats") or {}
        for ext in ("pdf", "docx"):
            if not fmts.get(ext):
                continue
            p = (root / "plans" / "reports"
                 / ("%s-r%d-report.%s" % (component, b["resultsVersion"], ext)))
            if p.is_file():
                rmap["/report/%s/r%d.%s" % (component, b["resultsVersion"], ext)] = p
    return rmap


def split_focus(focus):
    """--focus slug[:rN][:view] -> (slug, resultsVersion, view).
    view: only "reports" today; None means the default view for the target."""
    if not focus:
        return None, None, None
    m = re.fullmatch(r"(.+):r(\d+):(reports)", focus)
    if m:
        return m.group(1), int(m.group(2)), m.group(3)
    m = re.fullmatch(r"(.+):r(\d+)", focus)
    if m:
        return m.group(1), int(m.group(2)), None
    return focus, None, None


def build_live_payload(root, slug, focus_results, focus_view, seeds):
    """Canonical live-board payload: exactly the preparation cmd_serve does at
    boot, so a regeneration hashes comparably to the served payload. Any step
    added to live boot preparation MUST be added here, never inline."""
    payload = collect_payload(root, "live", slug)
    payload["focusResults"] = focus_results
    payload["focusView"] = focus_view
    build_assets(root, payload)
    if seeds:
        payload["seededAnnotations"] = seeds
    return payload


def collect_drift(root, exec_groups, master_content="", archive_contents=()):
    """Filesystem/git hygiene flags for the Tracker: a stale exported board.html,
    leftover results staging dirs, and bundles whose sources drifted since capture.
    (14-day inactivity is computed client-side from git.fileDates.)
    Components linked only in an ARCHIVED master plan (pre-renewal) are skipped
    for source drift — archived work is never nagged about."""
    plans = root / "plans"
    board_html = plans / "board.html"
    stale_board = None
    if board_html.is_file():
        ignore = {"board.html", "board-share.html", ".board-feedback.md", ".board.lock"}
        newest = 0.0
        for p in plans.rglob("*"):
            if p.is_file() and p.name not in ignore:
                try:
                    newest = max(newest, p.stat().st_mtime)
                except OSError:
                    continue
        stale_board = board_html.stat().st_mtime < newest
    leftover = sorted({
        d.parent.parent.name  # .../<slug>/results/.staging-x
        for d in plans.glob("execution/*/results/.staging-*")
        if d.is_dir()
    })
    source_drift = []
    for g in exec_groups:
        if not g.get("results"):
            continue
        marker = "execution/%s/" % g["component"]
        if marker not in master_content and any(
                marker in a for a in archive_contents):
            continue  # pre-renewal component — archived work is never nagged about
        try:
            _, changed = changed_sources(root, g["component"])
        except Exception as exc:
            print("warning: could not check source drift for %s: %s" %
                  (g["component"], exc), file=sys.stderr)
            changed = []
        if changed:
            source_drift.append(g["component"])
    return {
        "staleBoardHtml": stale_board,
        "leftoverStaging": leftover,
        "sourceDrift": sorted(set(source_drift)),
    }


def newest_draft(comp_dir):
    """Newest .draft-vN.md by NUMERIC version — a lexicographic sort put
    .draft-v9.md above .draft-v10.md. Returns (version, path) or None."""
    best = None
    for f in comp_dir.glob(".draft-v*.md"):
        m = re.fullmatch(r"\.draft-v(\d+)\.md", f.name)
        if not m:
            continue
        v = int(m.group(1))
        if best is None or v > best[0]:
            best = (v, f)
    return best


def agents_gitignored(root):
    """True if any generated aict-* agent path is gitignored, False if none are,
    None when git is unavailable. Checks the three concrete files (not just the
    dir) so a rule targeting an individual agent is caught. Boot-time only."""
    paths = [f".claude/agents/{a}.md"
             for a in ("aict-plan-reviewer", "aict-results-validator", "aict-board-reviewer")]
    try:
        r = subprocess.run(["git", "-C", str(root), "check-ignore", *paths],
                           capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode == 0:
        return True   # at least one path ignored
    if r.returncode == 1:
        return False  # none ignored
    return None       # 128 = not a repo / other git error


def collect_model_profile(root, mode):
    """Structured plans/model-profile.md snapshot for the board, or None when
    the file is absent (present-only, like history/archives). Reads bytes once
    and never raises — an unreadable file yields a disabled snapshot so the
    board still loads."""
    path = root / "plans" / "model-profile.md"
    if not path.exists():
        return None
    rel = "plans/model-profile.md"
    ignored = agents_gitignored(root) if mode in ("live", "static") else None
    try:
        data = path.read_bytes()
    except OSError:
        return {"path": rel, "exists": True, "baselineHash": None, "raw": "",
                "proseBefore": "", "proseAfter": "", "rows": [], "editable": False,
                "warnings": ["model-profile: unreadable (IO error)"], "agentsGitignored": ignored}
    baseline = hashlib.sha256(data).hexdigest()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return {"path": rel, "exists": True, "baselineHash": baseline, "raw": "",
                "proseBefore": "", "proseAfter": "", "rows": [], "editable": False,
                "warnings": ["model-profile: unreadable (not UTF-8)"], "agentsGitignored": ignored}
    view = models.profile_view(text)
    return {"path": rel, "exists": True, "baselineHash": baseline, "raw": text,
            "proseBefore": view["proseBefore"], "proseAfter": view["proseAfter"],
            "rows": view["rows"], "editable": view["editable"],
            "warnings": view["warnings"], "agentsGitignored": ignored}


def _model_profile_template():
    return (Path(__file__).resolve().parents[1] / "templates" / "model-profile.md").read_text(encoding="utf-8")


def _validate_profile_rows(rows_in):
    """Validate a POSTed rows list into an edits dict {stage: {model, effort}}.
    Requires an exact bijection: the six canonical stages, each exactly once,
    with a valid model and effort. Returns (edits, error_or_None)."""
    if not isinstance(rows_in, list):
        return None, "rows must be a list"
    canonical = set(models.STAGE_LABELS.values())
    edits = {}
    for r in rows_in:
        if not isinstance(r, dict):
            return None, "each row must be an object"
        stage = r.get("stage")
        if stage not in canonical:
            return None, "unknown stage %r" % (stage,)
        if stage in edits:
            return None, "duplicate stage %r" % (stage,)
        model = str(r.get("model", "")).strip().lower()
        if model not in models.MODEL_ALIASES and not models.MODEL_ID_RE.match(model):
            return None, "invalid model %r" % (r.get("model"),)
        effort_raw = r.get("effort")
        if effort_raw is None:
            effort = None
        else:
            e = str(effort_raw).strip().lower()
            if e in models.NO_EFFORT:
                effort = None
            elif e in models.EFFORT_LEVELS:
                effort = e
            else:
                return None, "invalid effort %r" % (effort_raw,)
        edits[stage] = {"model": model, "effort": effort}
    if set(edits) != canonical:
        return None, "expected exactly the six canonical stages"
    return edits, None


def apply_model_profile(root, body):
    """Validate, atomically write plans/model-profile.md, and regenerate the
    aict-* agents. Returns (http_status, json_body). The caller holds
    profile_lock, so the re-read/compare/write/regenerate below is one critical
    section. Never raises on an expected error path.

    The profile is authoritative: if generation fails after the file was
    replaced, the response reports saved=True with a generation error rather
    than rolling back — matching the CLI, which also leaves a saved profile."""
    path = root / "plans" / "model-profile.md"
    create = bool(body.get("create"))
    rows_in = body.get("rows")

    # 1. Establish the base text under the lock (fresh disk read).
    if create:
        if path.exists():  # appeared after boot — refuse, hand back fresh state
            return 409, {"error": "stale", "modelProfile": collect_model_profile(root, "live")}
        try:
            base_text = _model_profile_template()
        except OSError:
            return 500, {"error": "template-unreadable"}
    else:
        if not path.exists():
            return 409, {"error": "stale", "modelProfile": None}
        try:
            data = path.read_bytes()
        except OSError:
            return 400, {"error": "unparsable-base"}
        if hashlib.sha256(data).hexdigest() != body.get("baselineHash"):
            return 409, {"error": "stale", "modelProfile": collect_model_profile(root, "live")}
        try:
            base_text = data.decode("utf-8")
        except UnicodeDecodeError:
            return 400, {"error": "unparsable-base"}

    # 2. The base must be canonical (else the board refuses to edit it).
    stages, warnings = models.parse_profile(base_text)
    if not models.profile_canonical(stages, warnings):
        return 400, {"error": "unparsable-base"}

    # 3. Build validated edits (create-from-defaults may omit rows entirely).
    if create and rows_in is None:
        edits = {}
    else:
        edits, err = _validate_profile_rows(rows_in)
        if err is not None:
            return 400, {"error": "invalid", "detail": err}

    # 4. Rewrite only the table region, preserving surrounding prose byte-exact.
    try:
        new_text = models.rewrite_rows(base_text, edits) if edits else base_text
    except ValueError:
        return 500, {"error": "rewrite-failed"}

    # 5. The result must still parse canonically, or we write nothing.
    stages2, warnings2 = models.parse_profile(new_text)
    if not models.profile_canonical(stages2, warnings2):
        return 500, {"error": "rewrite-failed"}

    # 6. Atomic write (first board route to mutate a committed, tracked file).
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        models.atomic_write(path, new_text)
    except OSError as e:
        return 500, {"error": "write-failed", "detail": str(e)}

    # 7. Regenerate agents. The profile is already saved, so a generation
    #    failure is reported as saved-with-a-generation-error, never unwound and
    #    never allowed to crash the handler (which would drop the connection and
    #    hide the error from the client).
    try:
        gen = models.generate(root)
    except Exception as e:  # pragma: no cover - generate() catches its own I/O
        return 200, {"ok": True, "saved": True,
                     "modelProfile": collect_model_profile(root, "live"),
                     "restartNeeded": False, "changedAgentStages": [],
                     "generation": {"results": [], "error": str(e)}}
    generation = {"results": gen["results"]}
    errored = any(r["outcome"] == "error" for r in gen["results"])
    if gen["code"] != 0 or errored:
        generation["error"] = "; ".join(gen["stderr"]) or "agent regeneration failed"
    return 200, {
        "ok": True,
        "saved": True,
        "modelProfile": collect_model_profile(root, "live"),
        "restartNeeded": gen["restartNeeded"],
        "changedAgentStages": gen["changedStages"],
        "generation": generation,
    }


def detail_level(master_content):
    """The master plan's `Detail level:` line (compact|standard|full), or None."""
    m = re.search(
        r"^Detail level:\s*(compact|standard|full)\s*$",
        master_content or "",
        re.MULTILINE | re.IGNORECASE,
    )
    return m.group(1).lower() if m else None


def collect_payload(root, mode, focus):
    plans = root / "plans"
    if not (plans / "master-plan.md").is_file():
        die("no plans/master-plan.md under %s — run /aict:init first" % root)

    exec_groups = []
    exec_dir = plans / "execution"
    if exec_dir.is_dir():
        for comp_dir in sorted(p for p in exec_dir.iterdir() if p.is_dir()):
            versions = []
            for f in sorted(comp_dir.glob("v*.md")):
                m = re.fullmatch(r"v(\d+)\.md", f.name)
                if not m:
                    continue
                entry = read_file(root, str(f.relative_to(root)))
                entry["version"] = int(m.group(1))
                entry["trailerState"] = parse_trailer(entry["content"])["kind"]
                versions.append(entry)
            versions.sort(key=lambda v: v["version"])
            group = {"component": comp_dir.name, "versions": versions}
            if mode in ("live", "remote", "hosted"):
                nd = newest_draft(comp_dir)
                if nd:
                    version, d = nd
                    entry = read_file(root, str(d.relative_to(root)))
                    entry["proposedVersion"] = version
                    entry["trailerState"] = parse_trailer(entry["content"])["kind"]
                    group["draft"] = entry
            # Committed within-version draft iterations (feature #1). Unlike the
            # ephemeral working draft above, these are real history and ride in
            # every mode. Named vN-draft-K.md — never matched by the sign-off
            # gate's version regex, so they stay plain committed files.
            snapshots = []
            for f in sorted(comp_dir.glob("v*-draft-*.md")):
                m = re.fullmatch(r"v(\d+)-draft-(\d+)\.md", f.name)
                if not m:
                    continue
                entry = read_file(root, str(f.relative_to(root)))
                entry["version"] = int(m.group(1))
                entry["iteration"] = int(m.group(2))
                snapshots.append(entry)
            snapshots.sort(key=lambda s: (s["version"], s["iteration"]))
            if snapshots:
                group["draftSnapshots"] = snapshots
            group["results"] = collect_results(root, comp_dir)
            if (
                versions
                or group.get("draft")
                or group.get("draftSnapshots")
                or group["results"]
            ):
                exec_groups.append(group)

    reviews = []
    reviews_dir = plans / "reviews"
    if reviews_dir.is_dir():
        for f in sorted(reviews_dir.glob("*.md")):
            reviews.append(read_file(root, str(f.relative_to(root))))

    decision_log = (
        read_file(root, "plans/decision-log.md")
        if (plans / "decision-log.md").is_file()
        else {"path": "plans/decision-log.md", "content": "# Decision Log\n"}
    )
    # Reconstructed pre-adoption history — present only when the project has one,
    # so a project without it keeps a byte-identical payload/share hash.
    history = (
        read_file(root, "plans/history.md")
        if (plans / "history.md").is_file()
        else None
    )
    # Archived master plans (v0.10 renewal record) — present-only, like history.
    archives = []
    arch_dir = plans / "archive"
    if arch_dir.is_dir():
        for f in sorted(arch_dir.glob("master-plan-*.md")):
            m = re.fullmatch(r"master-plan-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md", f.name)
            entry = read_file(root, str(f.relative_to(root)))
            entry["archivedOn"] = m.group(1) if m else ""
            archives.append(entry)

    # Manuscript — whole-project material, like decision-log/history/archives.
    manuscript = _read_manuscript_file(root)

    if mode == "remote" and focus:
        exec_groups = [g for g in exec_groups if g["component"] == focus]
        if not exec_groups:
            die("no execution plans found for --focus %s" % focus)
        reviews = []
        decision_log = {
            "path": "plans/decision-log.md",
            "content": "# Decision Log\n\n(omitted from focused share)\n",
        }
        # history is whole-project material — withhold it from a focused share,
        # exactly like the decision log.
        if history is not None:
            history = {
                "path": "plans/history.md",
                "content": "# Reconstructed History\n\n(omitted from focused share)\n",
            }
        # archived master plans are whole-project material too — omit entirely.
        archives = []
        # manuscript is whole-project material too — omit entirely.
        manuscript = None

    all_paths = ["plans/master-plan.md", "plans/decision-log.md"]
    for g in exec_groups:
        all_paths.extend(v["path"] for v in g["versions"])
        all_paths.extend(s["path"] for s in g.get("draftSnapshots", []))
        all_paths.extend(b["manifestRaw"]["path"] for b in g.get("results", []))
        all_paths.extend(b["publishedReport"]["path"] for b in g.get("results", [])
                         if b.get("publishedReport"))
    all_paths.extend(r["path"] for r in reviews)
    if history is not None:
        all_paths.append("plans/history.md")
    if manuscript is not None:
        all_paths.append(manuscript["path"])

    payload = {
        "schemaVersion": 2,
        "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "mode": mode,
        "focus": focus,
        "project": {"name": root.name},
        "git": git_info(root, all_paths),
        "files": {
            "masterPlan": read_file(root, "plans/master-plan.md"),
            "decisionLog": decision_log,
            "executionPlans": exec_groups,
            "reviews": reviews,
            **({"history": history} if history is not None else {}),
            **({"archives": archives} if archives else {}),
            **({"manuscript": manuscript} if manuscript is not None else {}),
        },
    }
    # Reader detail level (board default collapse); present-only, harmless on any
    # share. Client defaults to "standard" when absent.
    dl = detail_level(payload["files"]["masterPlan"]["content"])
    if dl:
        payload["detailLevel"] = dl
    # Committed, review-relevant project config — present-only, rides every
    # mode EXCEPT a focused remote share (whole-project material, like the
    # decision log). A profile-less project keeps a byte-identical payload.
    if not (mode == "remote" and focus):
        mp = collect_model_profile(root, mode)
        if mp is not None:
            payload["modelProfile"] = mp

    collaborator_facing = mode in ("remote", "hosted", "submission")
    if not collaborator_facing:
        # Researcher-only hygiene flags; kept out of collaborator shares.
        payload["drift"] = collect_drift(
            root, exec_groups,
            payload["files"]["masterPlan"]["content"],
            [a["content"] for a in archives])
    if mode == "live":
        # project.root is the absolute local path — live serving ONLY, never
        # a collaborator share, never a static/export file.
        payload["project"]["root"] = str(root)
    if collaborator_facing:
        payload["shareHash"] = share_hash(payload_files(payload))
    return payload


def inject(template, payload):
    if template.count(SLOT) != 1:
        if template.count(SLOT_OPEN) == 1:
            # Slot present but non-empty (shouldn't happen with our build);
            # replace between the open tag and the next </script>.
            start = template.index(SLOT_OPEN) + len(SLOT_OPEN)
            end = template.index("</script>", start)
            blob = json.dumps(payload).replace("<", "\\u003c")
            return template[:start] + blob + template[end:]
        die("board template is corrupt: expected exactly one data slot")
    blob = json.dumps(payload).replace("<", "\\u003c")
    return template.replace(SLOT, SLOT_OPEN + blob + "</script>")


def template_path():
    p = Path(__file__).resolve().parent.parent / "assets" / "board-template.html"
    if not p.is_file():
        die("board template missing at %s — reinstall the aict plugin" % p)
    return p


def ensure_gitignore(plans_dir):
    gi = plans_dir / ".gitignore"
    existing = gi.read_text(encoding="utf-8").splitlines() if gi.is_file() else []
    missing = [l for l in GITIGNORE_LINES if l not in existing]
    if missing:
        content = existing + missing
        gi.write_text("\n".join(content).strip() + "\n", encoding="utf-8")


def derive_port(root):
    """Stable per-project default port: 41000 + sha256(canonical root) % 1000."""
    digest = hashlib.sha256(str(Path(root).resolve()).encode("utf-8")).hexdigest()
    return 41000 + int(digest, 16) % 1000


def project_id(root):
    """Stable public project identity (same digest input as derive_port)."""
    return hashlib.sha256(str(Path(root).resolve()).encode("utf-8")).hexdigest()[:16]


_FP_EXACT = {".board.lock", ".board-feedback.md", ".board-feedback.md.tmp",
             ".board-web"}


def fingerprint_excluded(name):
    """Bookkeeping the board machinery itself writes during a session. Draft
    files (.draft-vN.md) are dotfiles and MUST be fingerprinted, so this is a
    list of specific server-written names, never 'all dotfiles'."""
    return (name in _FP_EXACT
            or name.startswith(".aict-approved-")
            or (name.startswith(".sign-feedback-v") and name.endswith(".md")))


def resolve_git_paths(root):
    """Git state inputs for the fingerprint ([] when git is unavailable):
    the per-worktree HEAD and index, plus the shared refs/heads directory and
    packed-refs file, so a branch-ref update that touches neither HEAD nor
    this checkout's index (a commit or reset in another checkout, a soft
    reset) still registers — loose-ref writes are atomic renames, which bump
    the refs/heads directory mtime for any branch. Resolved via
    rev-parse --git-path because in a linked worktree .git is a file and the
    shared paths live in the common dir."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--git-path", "HEAD", "--git-path", "index",
             "--git-path", "refs/heads", "--git-path", "packed-refs"],
            capture_output=True, text=True, cwd=str(root), timeout=10)
    except Exception:
        return []
    if r.returncode != 0:
        return []
    paths = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        p = Path(line)
        paths.append(p if p.is_absolute() else root / p)
    return paths


def plans_fingerprint(root, git_paths):
    """Cheap disk-change detector for the live board: stat entries for every
    file and directory under plans/ (minus server bookkeeping) plus git
    HEAD/index mtimes. Equality means 'no rebuild needed'; any difference
    triggers a full payload rebuild whose generation decides staleness."""
    entries = []
    plans = str(root / "plans")
    for dirpath, dirnames, filenames in os.walk(plans):
        # Prune excluded names from recursion too: .board-web is a DIRECTORY
        # of server-written bookkeeping (rewritten wholesale on web publish).
        dirnames[:] = sorted(d for d in dirnames if not fingerprint_excluded(d))
        rel = os.path.relpath(dirpath, plans)
        for dname in dirnames:
            entries.append(("d", os.path.join(rel, dname)))
        for fn in sorted(filenames):
            if fingerprint_excluded(fn):
                continue
            try:
                st = os.stat(os.path.join(dirpath, fn))
            except OSError:
                continue
            entries.append(("f", os.path.join(rel, fn),
                            st.st_mtime_ns, st.st_size))
    for gp in git_paths:
        try:
            entries.append(("g", str(gp), gp.stat().st_mtime_ns))
        except OSError:
            entries.append(("g", str(gp), None))
    return tuple(entries)


# ---------------------------------------------------------------------------
# Mechanical launcher (aict-board): a project-local script that opens the board
# with no LLM in the loop, so a student can reach it while the Claude
# session is rate-limited. board.py writes it itself, so the interpreter and
# board.py path are baked without any path-guessing.
# ---------------------------------------------------------------------------

LAUNCHER_NAME = "aict-board"
LAUNCHER_MARKER = "aict-board-managed-launcher-v1"


def launcher_script(board_path=None, interpreter=None):
    """POSIX-sh launcher text. Every interpolated value is shlex-quoted so a
    path containing spaces or shell metacharacters cannot be expanded."""
    if board_path is None:
        board_path = Path(__file__).resolve()
    if interpreter is None:
        interpreter = sys.executable or "python3"
    return (
        "#!/bin/sh\n"
        "# %s\n"
        "# aict: open the board with no Claude/LLM. Auto-generated; do not edit.\n"
        'cd "$(dirname "$0")" || exit 1\n'
        'exec %s %s --project-root . --reuse "$@"\n'
        % (LAUNCHER_MARKER, shlex.quote(str(interpreter)), shlex.quote(str(board_path)))
    )


def _git_exclude_path(root):
    """Resolve <gitdir>/info/exclude for a normal repo or a worktree/submodule
    whose `.git` is a file. None when this is not a git working tree."""
    dotgit = Path(root) / ".git"
    if dotgit.is_dir():
        return dotgit / "info" / "exclude"
    if dotgit.is_file():
        try:
            for line in dotgit.read_text(encoding="utf-8").splitlines():
                if line.startswith("gitdir:"):
                    gd = Path(line.split(":", 1)[1].strip())
                    if not gd.is_absolute():
                        gd = (Path(root) / gd).resolve()
                    return gd / "info" / "exclude"
        except OSError:
            return None
    return None


def ensure_git_exclude(root):
    """Add `/aict-board` to the repo's local exclude (no tracked-file churn).
    Idempotent; a no-op outside a git working tree."""
    excl = _git_exclude_path(root)
    if excl is None:
        return
    entry = "/" + LAUNCHER_NAME
    try:
        existing = excl.read_text(encoding="utf-8").splitlines() if excl.is_file() else []
        if entry in existing:
            return
        excl.parent.mkdir(parents=True, exist_ok=True)
        with excl.open("a", encoding="utf-8") as fh:
            if existing and existing[-1] != "":
                fh.write("\n")
            fh.write(entry + "\n")
    except OSError:
        pass  # non-fatal: the launcher still works, it is just not excluded


def ensure_launcher(root, explicit=False):
    """Write/refresh <root>/aict-board and exclude it from git. Returns a status
    string: created / refreshed / unchanged / skipped:<reason>.

    Never destructive: only a regular file carrying LAUNCHER_MARKER is replaced.
    A symlink, directory, or unmanaged regular file at that path is refused —
    a warning on the ordinary serve path (explicit=False), a hard error for the
    `--install-launcher` action (explicit=True). Writes atomically."""
    lp = Path(root) / LAUNCHER_NAME
    desired = launcher_script()

    def refuse(reason):
        msg = "%s: refusing to overwrite %s (%s)" % (LAUNCHER_NAME, lp, reason)
        if explicit:
            die(msg)
        print("board: " + msg + "; skipping launcher install", file=sys.stderr)
        return "skipped:" + reason

    if lp.is_symlink():
        return refuse("symlink")
    if lp.exists():
        if lp.is_dir():
            return refuse("directory")
        if not lp.is_file():
            return refuse("special-file")
        try:
            current = lp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return refuse("unreadable")
        if LAUNCHER_MARKER not in current:
            return refuse("foreign")
        has_x = os.access(lp, os.X_OK)
        if current == desired and has_x:
            ensure_git_exclude(root)
            return "unchanged"
        status = "refreshed"
    else:
        status = "created"

    tmp = lp.with_name(lp.name + ".tmp-%d" % os.getpid())
    try:
        tmp.write_text(desired, encoding="utf-8")
        os.chmod(tmp, 0o755)
        os.replace(tmp, lp)
    except OSError as e:
        try:
            tmp.unlink()
        except OSError:
            pass
        if explicit:
            die("%s: could not write %s (%s)" % (LAUNCHER_NAME, lp, e))
        print("board: could not write %s (%s); skipping launcher install"
              % (lp, e), file=sys.stderr)
        return "skipped:write-error"
    ensure_git_exclude(root)
    if status == "created":
        print("board: wrote ./%s — open the board without Claude by running ./%s"
              % (LAUNCHER_NAME, LAUNCHER_NAME), file=sys.stderr)
    return status


def healthy_running_board(root):
    """Port of a live board already serving THIS project, or None. Confirms via
    /api/health (app + projectId) so a stale lock or a foreign process reusing
    the port is not mistaken for our board."""
    info = read_lock(Path(root) / "plans")
    if not info or not info.get("port"):
        return None
    port = info["port"]
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:%d/api/health" % port, timeout=1.5) as r:
            if r.status != 200:
                return None
            data = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if (data.get("app") == "aict-board"
            and data.get("projectId") == project_id(root)):
        return port
    return None


def token_ok(body, expected):
    return hmac.compare_digest(str(body.get("boardToken", "")), expected)


def payload_generation(payload):
    """Content identity of the served payload, excluding per-boot secrets and
    volatile stamps (generatedAt is wall-clock; generation is this hash itself,
    stamped back into the payload for the client)."""
    trimmed = {k: v for k, v in payload.items()
               if k not in ("publishToken", "boardToken", "bootId",
                            "generatedAt", "generation")}
    return hashlib.sha256(
        json.dumps(trimmed, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def bind_server(root, requested, handler_cls):
    """Bind-with-retry (never check-then-bind). A requested port is pinned —
    a relaunch may race the prior socket's close, so retry it; otherwise probe
    the derived window once each and fall back to an OS-assigned port."""
    if requested:
        last = None
        for _ in range(10):
            try:
                return ThreadingHTTPServer(("127.0.0.1", requested), handler_cls)
            except OSError as e:
                last = e
                time.sleep(0.2)
        die("port %d is busy (%s); close the process using it or drop --port"
            % (requested, last), code=1)
    base = derive_port(root)
    for cand in range(base, base + 10):
        try:
            return ThreadingHTTPServer(("127.0.0.1", cand), handler_cls)
        except OSError:
            continue
    return ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)


def read_lock(plans_dir):
    """Lock metadata {pid, port, bootId, boardToken}; legacy plain-PID locks
    read with empty metadata. None when absent or unreadable."""
    lock = plans_dir / ".board.lock"
    if not lock.is_file():
        return None
    try:
        raw = lock.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    try:
        info = json.loads(raw)
        if isinstance(info, dict) and "pid" in info:
            return {"pid": int(info["pid"]),
                    "port": int(info.get("port", 0)),
                    "bootId": str(info.get("bootId", "")),
                    "boardToken": str(info.get("boardToken", ""))}
    except (ValueError, TypeError):
        pass
    try:
        return {"pid": int(raw), "port": 0, "bootId": "", "boardToken": ""}
    except ValueError:
        return None


def request_shutdown(plans_dir, wait=10.0):
    """Ask a live board to release its lock for a sign-session handoff."""
    info = read_lock(plans_dir)
    if not info or not info.get("port") or not info.get("boardToken"):
        return False
    data = json.dumps({"boardToken": info["boardToken"]}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:%d/api/shutdown" % info["port"],
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status != 200:
                return False
        deadline = time.monotonic() + wait
        lock = plans_dir / ".board.lock"
        while lock.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        return not lock.exists()
    except (urllib.error.URLError, OSError, ValueError):
        return False


def acquire_lock(plans_dir, force, meta=None):
    lock = plans_dir / ".board.lock"
    if lock.is_file():
        info = read_lock(plans_dir)
        pid = info["pid"] if info else None
        alive = False
        if pid is not None:
            try:
                os.kill(pid, 0)
                alive = True
            except ProcessLookupError:
                alive = False
            except PermissionError:
                alive = True
            except OSError:
                alive = False
        if alive and not force:
            die(
                "another board is open (PID %s); close it or pass --force" % pid,
                code=1,
            )
    lock.write_text(json.dumps({"pid": os.getpid(), **(meta or {})}),
                    encoding="utf-8")
    return lock


def build_feedback_document(body, payload, action=None, action_id=None):
    feedback_md = body.get("feedbackMarkdown") or "# Board Feedback\n\n(no markdown)"
    meta = {
        "sessionId": str(uuid.uuid4()),
        "generatedAt": payload["generatedAt"],
        "mode": payload["mode"],
        "focus": payload["focus"],
        "payloadHash": body.get("payloadHash", ""),
        "annotations": body.get("annotations", []),
    }
    if action_id:
        meta["actionId"] = action_id
    if action is not None:
        # Authoritative order fields come ONLY from the server-validated
        # tuple — never from client-supplied meta.
        slug, ver, decision, reason = action
        so = {"component": slug, "version": ver, "decision": decision}
        if reason:
            so["reason"] = reason
        meta["signoff"] = so
        head = "## SIGNOFF: %s v%d — %s\n\n" % (slug, ver, decision)
        if reason:
            head += "> %s\n\n" % reason.replace("\n", "\n> ")
        feedback_md = head + feedback_md
    return (
        feedback_md.rstrip()
        + "\n\n```json board-feedback\n"
        + json.dumps(meta, indent=1)
        + "\n```\n"
    )


def publish_token_ok(body, token):
    """True iff the request body carries the exact per-session publish token.
    Constant-time comparison isn't needed: the token is generated fresh per
    `serve()` invocation and never persisted, so there's nothing to time-attack
    across processes."""
    return body.get("token") == token


def draft_map_from_payload(payload):
    """Sign-off eligibility = exactly the drafts the served board displays.
    Derived from the payload object itself (never a second disk glob), so a
    ticket can only ever bind content the researcher was shown."""
    out = {}
    for group in (payload.get("files", {}) or {}).get("executionPlans", []) or []:
        d = group.get("draft")
        if not d or "content" not in d or "proposedVersion" not in d:
            continue
        out[(group["component"], int(d["proposedVersion"]))] = {
            "path": d["path"],
            "hash": hashlib.sha256(
                normalize_plan(d["content"]).encode("utf-8")).hexdigest(),
        }
    return out


def validate_signoff_action(action, draft_map):
    """Typed signoff request -> (slug, version, decision, reason).
    Raises ValueError('bad-action') for anything not displayed by this board."""
    if not isinstance(action, dict) or action.get("kind") != "signoff":
        raise ValueError("bad-action")
    slug = action.get("component")
    ver = action.get("version")
    decision = action.get("decision")
    reason = action.get("reason")
    if decision not in ("approve", "request-changes"):
        raise ValueError("bad-action")
    if not isinstance(slug, str) or isinstance(ver, bool) or not isinstance(ver, int):
        raise ValueError("bad-action")
    if (slug, ver) not in draft_map:
        raise ValueError("bad-action")
    if reason is not None and not isinstance(reason, str):
        raise ValueError("bad-action")
    return slug, ver, decision, reason


def inject_fence_key(doc, key, value):
    """Set one key in the document's board-feedback fence, preserving all
    surrounding text. Fence-less documents gain a minimal fence at the end.
    Multi-fence documents (forgery signal — parse_fence refuses them) are
    returned untouched so downstream routing keeps refusing them."""
    meta = parse_fence(doc)
    if meta is None:
        if FENCE_RE.findall(doc):
            return doc
        return doc.rstrip("\n") + (
            "\n\n```json board-feedback\n%s\n```\n"
            % json.dumps({key: value}, indent=1))
    meta[key] = value
    last = None
    for last in FENCE_RE.finditer(doc):
        pass
    new_block = "```json board-feedback\n%s\n```" % json.dumps(meta, indent=1)
    return doc[:last.start()] + new_block + doc[last.end():]


def document_from_body(body, payload, action=None, action_id=None):
    """Prefer the client-assembled feedback document (schemaVersion 1 clients
    send feedbackDocument); fall back to server-side assembly for older
    templates and the gate flow. Action-carrying orders are ALWAYS assembled
    server-side from the validated action tuple (the client document is
    ignored), and every durable live order carries a server actionId."""
    if action is not None:
        return build_feedback_document(body, payload, action=action,
                                       action_id=action_id)
    doc = body.get("feedbackDocument")
    if not (isinstance(doc, str) and doc.strip()):
        doc = build_feedback_document(body, payload)
    if action_id:
        doc = inject_fence_key(doc, "actionId", action_id)
    return doc


def serve(root, payload, args):
    plans_dir = root / "plans"
    ensure_gitignore(plans_dir)
    lock = acquire_lock(plans_dir, args.force)
    retire_orphan_order_tickets(root)

    sign_payload = payload.get("sign")
    sign_mode = isinstance(sign_payload, dict)
    sign_transport = sign_payload.get("transport") if sign_mode else None
    gate_mode = sign_transport == "hook"
    ticket_sign_mode = sign_transport == "ticket"
    batch_id = sign_payload.get("batchId") if sign_mode else None
    boot_id = uuid.uuid4().hex
    publish_token = hashlib.sha256(os.urandom(32)).hexdigest()
    board_token = hashlib.sha256(os.urandom(32)).hexdigest()
    proj_id = project_id(root)
    template_text = template_path().read_text(encoding="utf-8")
    refreshable = not sign_mode
    git_paths = resolve_git_paths(root) if refreshable else []
    boot_focus = payload.get("focus")
    boot_focus_results = payload.get("focusResults")
    boot_focus_view = payload.get("focusView")
    boot_seeds = payload.get("seededAnnotations")

    def prepare_snapshot(p, fp):
        """Stamp process identity into a prepared live payload, inject, and
        derive the routing maps. Snapshots are immutable by convention: swapped
        by reference under state_lock, never edited in place."""
        p["publishToken"] = publish_token
        p["projectId"] = proj_id
        p["boardToken"] = board_token
        p["bootId"] = boot_id
        gen = payload_generation(p)
        p["generation"] = gen
        return {
            "payload": p,
            "generation": gen,
            "html": inject(template_text, p).encode("utf-8"),
            "amap": artifact_map(root, p),
            "rmap": report_map(root, p),
            "fingerprint": fp,
        }

    state_lock = threading.Lock()    # guards the state["snap"] reference only
    refresh_lock = threading.Lock()  # serializes fingerprint + rebuild;
                                     # ordering: refresh_lock -> state_lock
    state = {"snap": prepare_snapshot(
        payload, plans_fingerprint(root, git_paths) if refreshable else None)}
    candidate = {"fp": None, "snap": None}  # built-but-unpromoted; refresh_lock

    def current_snapshot():
        with state_lock:
            return state["snap"]

    def disk_snapshot(promote=False):
        """The snapshot matching current disk state. Never raises: any failure
        while rebuilding keeps the served snapshot and is NOT cached, so the
        next call retries. promote=True (root GET) swaps a differing snapshot
        in as the served one; health reads without promoting."""
        if not refreshable:
            return current_snapshot()
        with refresh_lock:
            snap = current_snapshot()
            try:
                fp = plans_fingerprint(root, git_paths)
            except OSError:
                return snap
            if fp == snap["fingerprint"]:
                return snap
            if candidate["fp"] == fp and candidate["snap"] is not None:
                cand = candidate["snap"]
            else:
                try:
                    cand = prepare_snapshot(build_live_payload(
                        root, boot_focus, boot_focus_results,
                        boot_focus_view, boot_seeds), fp)
                except BaseException:  # SystemExit from die() included
                    return snap
            if cand["generation"] == snap["generation"]:
                # Content-identical (fingerprint false positive, e.g. a touch):
                # adopt the fingerprint so this cadence stops rebuilding.
                adopted = dict(snap)
                adopted["fingerprint"] = fp
                with state_lock:
                    state["snap"] = adopted
                candidate["fp"] = candidate["snap"] = None
                return adopted
            if promote:
                with state_lock:
                    state["snap"] = cand
                candidate["fp"] = candidate["snap"] = None
            else:
                candidate["fp"], candidate["snap"] = fp, cand
            return cand

    done = threading.Event()
    result = {"approved": [], "rejected": []}
    if ticket_sign_mode:
        result["approved"] = [
            [e["component"], e["proposedVersion"]]
            for e in sign_payload.get("items", []) if e.get("ticketed")
        ]
    draft_map = draft_map_from_payload(payload)
    slot = {"actionId": None}
    slot_lock = threading.Lock()
    pending_order = object()
    pending_order_message = (
        "Route the existing plans/.board-feedback.md order (use --collect to "
        "recover it), then run --ack before submitting a new order."
    )
    # Serializes the whole re-read → validate → write → regenerate sequence of a
    # model-profile save so two concurrent POSTs can't both read the old file
    # and lose an update (ThreadingHTTPServer).
    profile_lock = threading.Lock()
    sign_lock = threading.Lock()

    def accept_order(build_doc, exit_code, write_file, before_commit=None):
        """Single-slot order acceptance: reserve the id, build the document,
        run any ticket pre-commit, write the order durably (atomic replace),
        then stage the result. Returns the actionId, or None when this round
        already accepted an order."""
        with slot_lock:
            if slot["actionId"] is not None:
                return None
            if write_file and (plans_dir / ".board-feedback.md").is_file():
                return pending_order
            slot["actionId"] = uuid.uuid4().hex
        aid = slot["actionId"]
        committed_ticket = None
        tmp = plans_dir / ".board-feedback.md.tmp"
        try:
            doc = build_doc(aid)
            if before_commit is not None:
                committed_ticket = before_commit(aid)
            if write_file:
                # Authorization ticket first (when required), then the durable
                # order, then unblock. This never exposes an order without the
                # ticket needed to route it.
                tmp.write_text(doc, encoding="utf-8")
                os.replace(tmp, plans_dir / ".board-feedback.md")
        except Exception:
            if committed_ticket is not None:
                try:
                    committed_ticket.unlink()
                except OSError:
                    pass
            try:
                tmp.unlink()
            except OSError:
                pass
            with slot_lock:
                if slot["actionId"] == aid:
                    slot["actionId"] = None
            raise
        result["doc"] = doc
        result["exit"] = exit_code
        return aid

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _json(self, code, obj, no_store=False):
            blob = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(blob)))
            if no_store:
                self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(blob)

        def do_GET(self):
            if not _host_is_local(self.headers.get("Host")):
                self.send_response(403)  # DNS-rebinding guard, GET included
                self.end_headers()
                return
            if self.path == "/api/health":
                snap = disk_snapshot()
                self._json(200, {"ok": True, "app": "aict-board",
                                 "bootId": boot_id,
                                 "generation": snap["generation"],
                                 "projectId": proj_id}, no_store=True)
                return
            if self.path == "/api/model-profile":
                # Fresh disk snapshot — the Models view fetches this on mount so a
                # reload / second tab / external edit reconciles despite the
                # frozen boot payload. null = no profile file.
                self._json(200, {"modelProfile": collect_model_profile(root, "live")},
                           no_store=True)
                return
            if self.path.startswith("/artifact/"):
                f = current_snapshot()["amap"].get(self.path)
                if f is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                try:
                    data = f.read_bytes()
                except OSError:
                    self.send_response(404)
                    self.end_headers()
                    return
                mime, dispo = artifact_headers(f.name)
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Disposition", dispo)
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "sandbox")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if self.path.startswith("/report/"):
                f = current_snapshot()["rmap"].get(self.path)
                if f is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                try:
                    data = f.read_bytes()
                except OSError:
                    self.send_response(404)
                    self.end_headers()
                    return
                mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Disposition",
                                 'attachment; filename="%s"' % f.name)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            snap = disk_snapshot(promote=True)
            body = snap["html"]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def _read_body(self):
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        def do_POST(self):
            if not local_request_ok(self.headers):
                self.send_response(403)
                self.end_headers()
                return
            body = None
            if self.path.startswith("/api/"):
                try:
                    body = self._read_body()
                except Exception:
                    self.send_response(400)
                    self.end_headers()
                    return
                # A non-object body (list/scalar) would crash body.get in the
                # token/route handlers — reject it before either runs.
                if not isinstance(body, dict):
                    self._json(400, {"error": "bad-request"})
                    return
                # Per-boot token on every mutating route (spec §5.4) — landed
                # atomically with all client senders + the rebuilt template.
                if not token_ok(body, board_token):
                    self._json(403, {"error": "bad-token"})
                    return
            if self.path == "/publish-web":
                try:
                    body = self._read_body()
                except Exception:
                    self._json(400, {"error": "bad json"})
                    return
                if not publish_token_ok(body, publish_token):
                    self._json(403, {"error": "bad token"})
                    return
                try:
                    cfg = read_web_config(root)
                    if cfg is None:
                        self._json(200, {"setup": "needed"})
                        return
                    out = materialize_web_dir(root)
                    rc, deploy_out = _vercel(["deploy", "--prod", "--yes"], cwd=str(out))
                    if rc != 0:
                        self._json(500, {"error": deploy_out[:400]})
                        return
                    self._json(200, {"url": _remember_url(root, cfg, deploy_out),
                                     "unpulled": _count_unpulled(root, cfg)})
                except SystemExit as e:
                    self._json(500, {"error": str(e)})
                return
            if self.path == "/api/shutdown":
                self._json(200, {"ok": True})
                result["shutdown"] = True
                done.set()
                return
            if self.path == "/api/feedback" and not sign_mode:
                aid = accept_order(
                    lambda aid: document_from_body(
                        body, current_snapshot()["payload"], action_id=aid),
                    0, True)
                if aid is pending_order:
                    self._json(409, {"error": "pending-order",
                                     "message": pending_order_message})
                    return
                if aid is None:
                    self._json(409, {"error": "already-accepted",
                                     "actionId": slot["actionId"]})
                    return
                self._json(200, {"ok": True, "actionId": aid,
                                 "bootId": boot_id, "projectId": proj_id})
                done.set()
                return
            if self.path == "/api/approve" and gate_mode:
                comment = (body.get("comment") or "").strip()

                def _approve_doc(aid):
                    item = sign_payload["items"][0]
                    doc = "APPROVED: %s v%d" % (
                        item["component"],
                        item["proposedVersion"],
                    )
                    if comment:
                        doc += "\nResearcher comment: %s" % comment
                    return doc

                # Gate approve is stdout-only by protocol: the blocking hook
                # consumes the exit code; a pending file would go stale.
                aid = accept_order(_approve_doc, 0, False)
                if aid is None:
                    self._json(409, {"error": "already-accepted",
                                     "actionId": slot["actionId"]})
                    return
                self._json(200, {"ok": True, "actionId": aid,
                                 "bootId": boot_id, "projectId": proj_id})
                done.set()
                return
            if self.path == "/api/deny" and gate_mode:
                aid = accept_order(
                    lambda aid: document_from_body(
                        body, current_snapshot()["payload"], action_id=aid),
                    3, True)
                if aid is pending_order:
                    self._json(409, {"error": "pending-order",
                                     "message": pending_order_message})
                    return
                if aid is None:
                    self._json(409, {"error": "already-accepted",
                                     "actionId": slot["actionId"]})
                    return
                self._json(200, {"ok": True, "actionId": aid,
                                 "bootId": boot_id, "projectId": proj_id})
                done.set()
                return
            # ---- Ticket sign session: decisions persist immediately; the
            # session ends only when the client posts /api/sign/done. ----
            if self.path == "/api/sign/approve" and ticket_sign_mode:
                comp, ver = body.get("component"), body.get("proposedVersion")
                client_hash = body.get("contentHash")
                with sign_lock:
                    entry = next(
                        (e for e in sign_payload["items"]
                         if e["component"] == comp and e["proposedVersion"] == ver),
                        None,
                    )
                    if entry is None:
                        self._json(404, {"ok": False, "error": "unknown plan"})
                        return
                    comp_dir = root / "plans" / "execution" / comp
                    nd = newest_draft(comp_dir)
                    if nd is None:
                        self._json(410, {"ok": False, "error": "draft-missing"})
                        return
                    if nd[0] != ver:
                        fresh_text = nd[1].read_text(encoding="utf-8")
                        fresh = {
                            "component": comp,
                            "proposedVersion": nd[0],
                            "path": nd[1].relative_to(root).as_posix(),
                            "content": fresh_text,
                            "contentHash": hashlib.sha256(
                                fresh_text.encode("utf-8")).hexdigest(),
                            "ticketed": has_valid_ticket(
                                root, comp, nd[0], fresh_text),
                        }
                        sign_payload["items"][sign_payload["items"].index(entry)] = fresh
                        self._json(409, {"ok": False, "error": "newer-draft",
                                         "entry": fresh})
                        return
                    try:
                        dtext = (root / entry["path"]).read_text(encoding="utf-8")
                    except OSError:
                        self._json(410, {"ok": False, "error": "draft-missing"})
                        return
                    if parse_trailer(dtext)["kind"] != "none":
                        self._json(400, {"ok": False,
                                         "error": "trailer-in-draft"})
                        return
                    disk_hash = hashlib.sha256(dtext.encode("utf-8")).hexdigest()
                    if client_hash != disk_hash:
                        if client_hash != entry.get("contentHash"):
                            self._json(409, {"ok": False,
                                             "error": "hash-mismatch"})
                            return
                        entry["content"] = dtext
                        entry["contentHash"] = disk_hash
                        entry["ticketed"] = has_valid_ticket(
                            root, comp, int(ver), dtext)
                        self._json(409, {"ok": False, "error": "stale-draft",
                                         "entry": entry})
                        return
                    write_ticket(root, comp, int(ver), dtext, batch_id)
                    entry["ticketed"] = True
                    if [comp, ver] not in result["approved"]:
                        result["approved"].append([comp, ver])
                    self._json(200, {"ok": True,
                                     "approved": len(result["approved"])})
                    return
            if self.path == "/api/sign/reject" and ticket_sign_mode:
                comp, ver = body.get("component"), body.get("version")
                entry = next(
                    (e for e in sign_payload["items"]
                     if e["component"] == comp and e["proposedVersion"] == ver),
                    None,
                )
                if entry is None:
                    self._json(404, {"ok": False, "error": "unknown plan"})
                    return
                note = body.get("note")
                annotations = body.get("annotations")
                if not isinstance(note, str) or not isinstance(annotations, list):
                    self._json(400, {"ok": False, "error": "bad-request"})
                    return
                feedback = build_sign_feedback(comp, int(ver), note, annotations)
                feedback_path = (root / "plans" / "execution" / comp /
                                 (".sign-feedback-v%d.md" % ver))
                models.atomic_write(feedback_path, feedback)
                result["rejected"] = [
                    row for row in result["rejected"]
                    if row[:2] != [comp, ver]
                ]
                result["rejected"].append([comp, ver, note.strip()])
                self._json(200, {"ok": True})
                return
            if self.path == "/api/sign/done" and ticket_sign_mode:
                result["exit"] = 0
                self._json(200, {"ok": True})
                done.set()
                return
            # Model-profile save (Models tab). Repeatable — never ends the
            # session (no done.set). Serialized by profile_lock; disabled during
            # a sign session (defense in depth; the UI hides it).
            if self.path == "/api/model-profile" and not sign_mode:
                with profile_lock:
                    status, out = apply_model_profile(root, body)
                # Saving wrote plans/model-profile.md: hand the saving tab the
                # post-save disk generation so it advances its baseline instead
                # of self-reloading ~6s later. (profile_lock -> refresh_lock is
                # the one-way lock order; nothing acquires them reversed.)
                if status == 200:
                    out["payloadGeneration"] = disk_snapshot()["generation"]
                self._json(status, out)
                return
            self.send_response(404)
            self.end_headers()

    server = bind_server(root, args.port, Handler)
    port = server.server_address[1]
    lock.write_text(json.dumps({"pid": os.getpid(), "port": port,
                                "bootId": boot_id,
                                "boardToken": board_token}), encoding="utf-8")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = "http://127.0.0.1:%d" % port
    print("Board: %s" % url, file=sys.stderr)
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    # signal.signal is main-thread-only; in-process harnesses run serve() on a
    # worker thread and rely on the timeout/done paths instead of SIGTERM.
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *a: (_ for _ in ()).throw(SystemExit(130)))

    # Plain live serving has NO idle timeout — the board stays open until the
    # researcher acts or closes it. Sign modes (and any explicit --timeout)
    # keep a bounded wait; ticket sessions preserve decisions and exit 0 while
    # the blocking hook transport retains its timeout exit 2.
    if args.timeout is not None:
        wait_timeout = args.timeout
    elif sign_mode:
        wait_timeout = 3600
    else:
        wait_timeout = None
    try:
        got = done.wait(timeout=wait_timeout)
        server.shutdown()
        if result.get("shutdown"):
            print("board: closed by sign-session handoff", file=sys.stderr)
            sys.exit(5)
        if ticket_sign_mode:
            appr, rej = result["approved"], result["rejected"]
            decided = {(c, v) for c, v in appr}
            decided.update((c, v) for c, v, _ in rej)
            undecided = [
                [e["component"], e["proposedVersion"]]
                for e in sign_payload["items"]
                if (e["component"], e["proposedVersion"]) not in decided
            ]
            print("Sign session: %d approved, %d changes-requested, %d undecided%s."
                  % (len(appr), len(rej), len(undecided),
                     "" if got else " (session timed out; decisions were saved)"))
            for c, v in appr:
                print("  approved: %s v%s" % (c, v))
            for c, v, cm in rej:
                print("  changes-requested: %s v%s%s"
                      % (c, v, " — %s" % cm if cm else ""))
            for c, v in undecided:
                print("  undecided: %s v%s" % (c, v))
            sys.exit(0)
        if not got:
            print("board: no feedback received within %ds" % wait_timeout, file=sys.stderr)
            sys.exit(2)
        print(result["doc"])
        sys.exit(result.get("exit", 0))
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(130)
    finally:
        try:
            server.server_close()  # release the socket promptly for pinned relaunch
        except Exception:
            pass
        try:
            lock.unlink()
        except OSError:
            pass


def render_static_html(root, focus=None):
    """The self-contained static board as a string. Pure: writes no file and
    touches no gitignore. Shared by --export (which writes it to disk) and
    --publish (which pushes it to the gh-pages branch)."""
    slug, focus_results, focus_view = split_focus(focus)
    payload = collect_payload(root, "static", slug)
    payload["focusResults"] = focus_results
    payload["focusView"] = focus_view
    build_assets(root, payload)
    return inject(template_path().read_text(encoding="utf-8"), payload)


def node_preflight():
    """Returns an error message if node/npx missing, else None."""
    for tool in ("node", "npx"):
        if shutil.which(tool) is None:
            return ("Sharing to the web needs Node.js (for the Vercel CLI). Install it "
                    "from https://nodejs.org (or `brew install node`), then retry.")
    return None


def render_hosted_html(root):
    """Render the board in hosted mode with embedded payload."""
    slug = None
    payload = collect_payload(root, "hosted", slug)
    payload["mode"] = "hosted"
    build_assets(root, payload)
    return inject(template_path().read_text(encoding="utf-8"), payload)


def render_roster_html():
    """Render the classroom roster dashboard shell: the same single-file board
    bundle used everywhere else, but with no embedded payload — the roster
    shell (board/src/RosterApp.tsx) fetches /api/roster live from the
    classroom server instead of reading an injected <script id="board-data">
    slot. The root div is marked data-aict-mode="roster" so
    board/src/main.tsx mounts the roster shell instead of the single-project
    board (see board/src/main.tsx's dataset check). This is the classroom
    server's counterpart to render_hosted_html(); unlike that function, it
    takes no project root and injects no payload."""
    html = template_path().read_text(encoding="utf-8")
    marker = '<div id="root"></div>'
    replacement = '<div id="root" data-aict-mode="roster"></div>'
    if html.count(marker) != 1:
        die("board template's root div not found in the expected form — "
            "reinstall the aict plugin")
    return html.replace(marker, replacement, 1)


def materialize_web_dir(root):
    """Copy the web-template and write index.html with the hosted board.
    Returns the deploy dir plans/.board-web/."""
    out = root / "plans" / ".board-web"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB_TEMPLATE_DIR, out,
                    ignore=shutil.ignore_patterns("node_modules", ".vercel", "*.test.ts"))
    (out / "index.html").write_text(render_hosted_html(root), encoding="utf-8")
    return out


def _vercel(argv, cwd=None):
    try:
        r = subprocess.run(["vercel", *argv], cwd=cwd, capture_output=True, text=True, timeout=600)
        return r.returncode, (r.stdout or "").strip() + (r.stderr or "")
    except (OSError, subprocess.SubprocessError) as e:
        return 1, str(e)


def _first_url(text):
    """First https://*.vercel.app URL found in `text`, or None."""
    m = re.search(r"https://\S+\.vercel\.app\S*", text or "")
    return m.group(0) if m else None


def _remember_url(root, cfg, deploy_out):
    """Board URL from the config, else from the deploy output — persisted when
    the config lacks one. web_connect writes url:"" when BOARD_URL was never
    set on the Vercel project, and --pull/--web-clear need a URL to work."""
    url = cfg.get("url") or _first_url(deploy_out)
    if url and not cfg.get("url"):
        write_web_config(root, dict(cfg, url=url))
    return url


def _http_get_json(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def group_comments(comments):
    groups = {}
    for c in comments:
        groups.setdefault((c.get("author") or "anonymous", c.get("clientId") or ""), []).append(c)
    return groups


def _pulled_path(root):
    return root / "plans" / ".board-web-pulled.json"


def _read_pulled(root):
    try:
        return set(json.loads(_pulled_path(root).read_text()))
    except (OSError, ValueError):
        return set()


def _count_unpulled(root, cfg):
    """Best-effort count of comments not yet pulled locally. Returns 0 on ANY
    error (network, auth, parsing) and never raises — publish_web's report
    line is a nice-to-have, not a reason to fail the deploy."""
    try:
        url = cfg["url"].rstrip("/") + "/api/comments"
        data = _http_get_json(url, {"x-board-key": cfg["pullKey"]})
        pulled = _read_pulled(root)
        return sum(1 for c in data.get("comments", []) if c.get("id") not in pulled)
    except Exception:
        return 0


def publish_web(root, args):
    ensure_gitignore(root / "plans")
    msg = node_preflight()
    if msg:
        die(msg)
    cfg = read_web_config(root)
    if cfg is None:
        die("No web board configured yet. First-run setup is interactive (it needs "
            "`vercel login` in your own terminal). Run /aict:board --publish-web "
            "in Claude Code, which walks you through signup, login, and the first deploy.")
    out = materialize_web_dir(root)
    rc, deploy_out = _vercel(["deploy", "--prod", "--yes"], cwd=str(out))
    if rc != 0:
        die("vercel deploy failed:\n%s" % deploy_out)
    url = _remember_url(root, cfg, deploy_out)
    unpulled = _count_unpulled(root, cfg)  # best-effort; 0 on any error
    print("Published to %s" % url)
    print("  password: the one you set (share it in a separate message)")
    if unpulled:
        print("  %d new comment%s waiting — run /aict:board --pull"
              % (unpulled, "" if unpulled == 1 else "s"))


def pull(root, args):
    ensure_gitignore(root / "plans")
    # Recover from a prior pull that crashed after writing an inbox doc but
    # before routing it (mark-pulled happens only once every doc for THIS run
    # is on disk, but routing itself could still be interrupted) — drain and
    # route any leftovers before touching the new fetch.
    leftover_inbox = root / "plans" / ".board-web-inbox"
    if leftover_inbox.is_dir():
        for p in sorted(leftover_inbox.glob("*.txt")):
            inspect_feedback_document(root, p.read_text(encoding="utf-8", errors="replace"))
            p.unlink()
    cfg = read_web_config(root)
    if cfg is None:
        die("No web board configured. Run /aict:board --publish-web first.")
    if not cfg.get("url"):
        die("The local config has no board URL (BOARD_URL was missing from the project "
            "env when --web-connect ran). Run /aict:board --publish-web once — "
            "it records the URL — then retry.")
    url = cfg["url"].rstrip("/") + "/api/comments"
    try:
        data = _http_get_json(url, {"x-board-key": cfg["pullKey"]})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            die("Pull key rejected (rotated or reset). Run /aict:board --web-connect.")
        die("Web board returned %s. It may be misconfigured; try --publish-web again." % e.code)
    except (urllib.error.URLError, OSError):
        die("Web board unreachable (the project may be deleted). Run --publish-web to recreate, "
            "or ignore it.")
    comments = data.get("comments", [])
    pulled = _read_pulled(root)
    new = [c for c in comments if c.get("id") not in pulled]
    if not new:
        print("No new remote comments.")
        return
    groups = group_comments(new)
    # Same display name, different device/session — split rather than merged
    # (the recurring bug this guards against is silently interleaving two
    # collaborators' feedback into one document).
    by_author = {}
    for author, client in groups:
        by_author.setdefault(author, set()).add(client)
    for author, clients in by_author.items():
        if len(clients) > 1:
            print("note: %d collaborators share the name '%s'; splitting by device"
                  % (len(clients), author))
    inbox = root / "plans" / ".board-web-inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    docs = []
    for (author, client), group in groups.items():
        meta = {"sessionId": client or author, "generatedAt": "",
                "focus": None, "reviewer": author,
                "shareHash": group[-1].get("shareHash")}
        doc = assemble_hosted_document(
            [dict(c["annotation"], docHash=c.get("docHash")) for c in group],
            meta, root=root)
        prefix = re.sub(r"[^A-Za-z0-9._-]+", "-", "%s-%s" % (author, client))[:40] or "group"
        keyhash = hashlib.sha256(("%s\x00%s" % (author, client)).encode()).hexdigest()[:12]
        fname = "%s-%s.txt" % (prefix, keyhash)
        inbox_path = inbox / fname
        inbox_path.write_text(doc, encoding="utf-8")   # inbox FIRST
        docs.append((inbox_path, doc))
    # Only after every document is safely on disk do we mark ids pulled.
    pulled_path = _pulled_path(root)
    pulled_tmp = pulled_path.with_name(pulled_path.name + ".tmp")
    try:
        pulled_tmp.write_text(
            json.dumps(sorted(pulled | {c["id"] for c in new})),
            encoding="utf-8")
        os.replace(pulled_tmp, pulled_path)
    finally:
        try:
            pulled_tmp.unlink()
        except FileNotFoundError:
            pass
    for inbox_path, doc in docs:
        inspect_feedback_document(root, doc)   # route (prints)
        inbox_path.unlink()


# Small embedded wordlist for generate_passphrase() — diceware-style, not
# meant to be exhaustive; just enough entropy for a shareable board password.
_PASSPHRASE_WORDS = [
    "amber", "birch", "canyon", "cedar", "coral", "cove", "delta", "dune",
    "ember", "fern", "flint", "frost", "granite", "harbor", "haven", "lumen",
    "maple", "meadow", "moss", "opal", "pine", "quartz", "quill", "ridge",
    "river", "sable", "slate", "thicket", "tundra", "willow", "wren", "brook",
]


def generate_passphrase():
    """4 hyphen-joined words from a small embedded wordlist. Uses secrets.choice
    (cryptographically strong) rather than an unseeded PRNG, since this backs a
    real shareable board password."""
    return "-".join(secrets.choice(_PASSPHRASE_WORDS) for _ in range(4))


def web_connect(root, args):
    ensure_gitignore(root / "plans")
    msg = node_preflight()
    if msg:
        die(msg)
    out = root / "plans" / ".board-web"
    # Link to the existing project and pull env into a temp dir to recover the key.
    materialize_web_dir(root)
    rc, _ = _vercel(["link", "--yes"], cwd=str(out))
    if rc != 0:
        die("Could not link to an existing Vercel project. If you have none, run --publish-web.")
    rc, _ = _vercel(["env", "pull", ".env.local"], cwd=str(out))
    envtext = (out / ".env.local").read_text() if (out / ".env.local").exists() else ""
    m = re.search(r'BOARD_PULL_KEY=(?:"?)([^"\n]+)', envtext)
    url_m = re.search(r'BOARD_URL=(?:"?)([^"\n]+)', envtext)
    if not m:
        die("Linked, but BOARD_PULL_KEY not found in the project env.")
    write_web_config(root, {"url": (url_m.group(1) if url_m else ""),
                            "projectName": out.name, "pullKey": m.group(1)})
    print("Reconnected to the existing web board; pull key recovered.")
    if not url_m:
        print("note: BOARD_URL is not set on the Vercel project, so the board URL could "
              "not be recovered — --pull and --web-clear need it. Run --publish-web once "
              "on this machine; it records the URL.")


def web_clear(root, args):
    cfg = read_web_config(root)
    if cfg is None:
        die("No web board configured.")
    if not getattr(args, "force", False):
        die("This deletes ALL collaborator comments on the hosted board. Re-run with --force.")
    if not cfg.get("url"):
        die("The local config has no board URL (BOARD_URL was missing from the project "
            "env when --web-connect ran). Run /aict:board --publish-web once — "
            "it records the URL — then retry.")
    url = cfg["url"].rstrip("/") + "/api/clear"
    try:
        req = urllib.request.Request(url, method="POST", headers={"x-board-key": cfg["pullKey"]})
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(resp.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError) as e:
        die("Clear failed: %s" % e)


def set_password(root, args):
    # Generates a new passphrase + rotates the session secret, via `vercel env add`
    # (stdin, never args), then redeploys. Interactive-ish; the conversational
    # command drives this. The CLI validates config presence and prints guidance.
    cfg = read_web_config(root)
    if cfg is None:
        die("No web board configured. Run --publish-web first.")
    print("Rotate the passphrase from the conversational flow: it generates a new "
          "passphrase and BOARD_SESSION_SECRET, sets them with `vercel env add` "
          "(reading from stdin), and redeploys. See /aict:board.")


def export(root, args):
    html = render_static_html(root, args.focus)
    out = Path(args.export) if args.export != "DEFAULT" else root / "plans" / "board.html"
    if not out.is_absolute():
        out = root / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    ensure_gitignore(root / "plans")
    print(str(out))
    print(
        "Reminder: this file snapshots everything under plans/ — sharing or "
        "committing it is publishing those contents.",
        file=sys.stderr,
    )
    sys.exit(0)


def share(root, args):
    slug, focus_results, focus_view = split_focus(args.focus)
    payload = collect_payload(root, "remote", slug)
    payload["focusResults"] = focus_results
    payload["focusView"] = focus_view
    build_assets(root, payload)
    html = inject(template_path().read_text(encoding="utf-8"), payload)
    out = (
        Path(args.share) if args.share != "DEFAULT"
        else root / "plans" / "board-share.html"
    )
    if not out.is_absolute():
        out = root / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    ensure_gitignore(root / "plans")
    print(str(out))
    if args.focus:
        print(
            "Reminder: emailing this file publishes the focused component's "
            "plans plus the full master plan to the recipient.",
            file=sys.stderr,
        )
    else:
        print(
            "Reminder: emailing this file publishes everything under plans/ "
            "to the recipient. Use --focus NN-slug to share one component.",
            file=sys.stderr,
        )
    sys.exit(0)


# --- GitHub Pages publish (feature #4) ---

TMP_BRANCH_PREFIX = "_pb_pages_"  # per-run throwaway branch backing the publish worktree
# github.com must be the HOST (right after an optional scheme and userinfo), not
# merely appear somewhere in the URL/path — so git.example.com/github.com/... is rejected.
GITHUB_RE = re.compile(
    r"^(?:\w+://)?(?:[^@/]+@)?github\.com[:/]([^/]+?)/(.+?)(?:\.git)?/?$"
)
_VOLATILE_RE = re.compile(r'"generatedAt":\s*"[^"]*"')
INDEX_REDIRECT = (
    '<!doctype html>\n<meta charset="utf-8">\n'
    "<title>aict</title>\n"
    '<meta http-equiv="refresh" content="0; url=board.html">\n'
    '<a href="board.html">Open the board</a>\n'
)


def parse_github_remote(url):
    """(owner, repo) from a GitHub remote URL (ssh or https, with or without a
    trailing .git), or None when it is not a github.com remote."""
    if not url:
        return None
    m = GITHUB_RE.search(url.strip())
    return (m.group(1), m.group(2)) if m else None


def _git(cwd, argv, check=True, timeout=120):
    r = subprocess.run(["git", *argv], cwd=str(cwd),
                       capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        die("git %s failed:\n%s" % (" ".join(argv), (r.stderr or r.stdout).strip()))
    return r


def _publish_noop(files, worktree):
    """True when every file already matches the current branch content once the
    board's only volatile field (generatedAt) is masked — a timestamp-only diff
    that is not worth a new commit."""
    for name, content in files.items():
        existing = worktree / name
        if not existing.is_file():
            return False
        a = _VOLATILE_RE.sub('"generatedAt":""', content)
        b = _VOLATILE_RE.sub('"generatedAt":""', existing.read_text(encoding="utf-8"))
        if a != b:
            return False
    return True


def publish_to_branch(root, files, branch, message):
    """Push {name: content} to `branch` on origin through a throwaway git
    worktree, so the working tree and current branch are never touched. Builds
    on origin/<branch> when it already exists (preserving any other files there),
    otherwise creates an orphan branch. Returns 'pushed' or 'unchanged'."""
    _git(root, ["worktree", "prune"], check=False)
    tmp_branch = TMP_BRANCH_PREFIX + uuid.uuid4().hex[:8]  # unique — never clobbers a user ref
    _git(root, ["fetch", "origin", branch], check=False)  # branch may not exist yet
    has_remote = _git(
        root, ["show-ref", "--verify", "--quiet", "refs/remotes/origin/%s" % branch],
        check=False,
    ).returncode == 0
    tmp = tempfile.mkdtemp(prefix="aict-pages-")
    try:
        if has_remote:
            _git(root, ["worktree", "add", "-B", tmp_branch, tmp, "origin/%s" % branch])
        else:
            _git(root, ["worktree", "add", "--detach", tmp])
            _git(tmp, ["checkout", "--orphan", tmp_branch])
            _git(tmp, ["rm", "-rf", "."], check=False)  # clear the inherited tree
        if _publish_noop(files, Path(tmp)):
            return "unchanged"
        for name, content in files.items():
            (Path(tmp) / name).write_text(content, encoding="utf-8")
        _git(tmp, ["add", "-A"])
        _git(tmp, ["commit", "-m", message])
        push = _git(tmp, ["push", "origin", "HEAD:%s" % branch], check=False)
        if push.returncode != 0:
            die("push to %s failed:\n%s\nIf the branch is protected or has diverged, "
                "resolve it and retry." % (branch, (push.stderr or push.stdout).strip()))
        return "pushed"
    finally:
        _git(root, ["worktree", "remove", "--force", tmp], check=False)
        _git(root, ["branch", "-D", tmp_branch], check=False)
        shutil.rmtree(tmp, ignore_errors=True)


def _gh(argv):
    """Run a gh command, best-effort: return None if gh is missing or the call
    errors or times out (never raises), else the CompletedProcess."""
    if shutil.which("gh") is None:
        return None
    try:
        return subprocess.run(["gh", *argv], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None


def _pages_enabled(owner, repo):
    """Best-effort: make sure GitHub Pages serves gh-pages/. True if enabled (or
    newly enabled), False if gh is missing/unauthenticated or the call fails."""
    got = _gh(["api", "repos/%s/%s/pages" % (owner, repo)])
    if got is None:
        return False
    if got.returncode == 0:
        return True  # already enabled
    created = _gh(["api", "--method", "POST", "repos/%s/%s/pages" % (owner, repo),
                   "-f", "source[branch]=gh-pages", "-f", "source[path]=/"])
    return created is not None and created.returncode == 0


def _repo_visibility(owner, repo):
    r = _gh(["repo", "view", "%s/%s" % (owner, repo),
             "--json", "visibility", "-q", ".visibility"])
    return r.stdout.strip().lower() if r is not None and r.returncode == 0 else None


def publish_pages(root, args):
    print(
        "DEPRECATED: --publish (GitHub Pages) is deprecated because it makes plans "
        "world-readable. Use --publish-web (private, Vercel) instead. To take down an "
        "old Pages board: delete the gh-pages branch and disable Pages in the repo settings.",
        file=sys.stderr,
    )
    if _git(root, ["rev-parse", "--is-inside-work-tree"], check=False).returncode != 0:
        die("not a git repository — --publish needs a git repo with a GitHub 'origin' remote")
    remote = _git(root, ["remote", "get-url", "origin"], check=False)
    if remote.returncode != 0 or not remote.stdout.strip():
        die("no 'origin' remote — add your GitHub remote "
            "(git remote add origin git@github.com:you/repo.git) and retry")
    gh = parse_github_remote(remote.stdout.strip())
    if gh is None:
        die("origin is not a GitHub remote:\n  %s\n"
            "GitHub Pages publish needs a github.com origin." % remote.stdout.strip())
    owner, repo = gh
    html = render_static_html(root, None)  # v1 publishes the full board (no --focus)
    outcome = publish_to_branch(
        root, {"board.html": html, "index.html": INDEX_REDIRECT},
        "gh-pages", "Publish aict",
    )
    url = "https://%s.github.io/%s/" % (owner, repo)
    enabled = _pages_enabled(owner, repo)
    vis = _repo_visibility(owner, repo)
    print(url)  # stdout: the shareable URL
    lines = []
    if outcome == "unchanged":
        lines.append("Board unchanged since the last publish — nothing new pushed.")
    lines.append(
        "Published the FULL board — every plan, result, and decision under plans/. "
        "Anyone who can reach the URL can read all of it."
    )
    if vis == "public":
        lines.append("This repo is PUBLIC, so the board is public.")
    elif vis == "private":
        lines.append("This repo is private; GitHub Pages for a private repo needs a paid "
                     "plan (Pro/Team/Enterprise) or the URL will 404.")
    else:
        lines.append("If this repo is public, the board is public to anyone with the link.")
    if not enabled:
        lines.append("Could not confirm Pages is enabled (gh missing or unauthenticated). "
                     "Enable it once: repo Settings > Pages > Branch gh-pages, folder / (root).")
    print("\n".join(lines), file=sys.stderr)
    sys.exit(0)


def collect_pending(root):
    """Non-destructive PEEK at the pending order. Deletion is a separate,
    explicit --ack step run only after the routed work finished — a crash
    mid-routing must re-offer the order on the next launch."""
    pending = root / "plans" / ".board-feedback.md"
    if not pending.is_file():
        print("No pending feedback.", file=sys.stderr)
        sys.exit(3)
    print(pending.read_text(encoding="utf-8"))
    sys.exit(0)


def ack_pending(root):
    """Acknowledge (delete) the pending order after its work completed."""
    pending = root / "plans" / ".board-feedback.md"
    if not pending.is_file():
        print("board: nothing to acknowledge.", file=sys.stderr)
        sys.exit(3)
    pending.unlink()
    print("board: acknowledged.", file=sys.stderr)
    sys.exit(0)


ACTION_KEYS = ("signoff", "verdict", "reviewRequest", "reportRequest", "reopen")

_ACTION_HEADING_RE = re.compile(
    r"(?m)^(##\s+(?:SIGNOFF|VERDICT|REVIEW REQUEST|REPORT REQUEST|"
    r"REOPEN REQUEST)\s*:)")


def strip_action_keys_from_document(doc):
    """Remove researcher-action keys from a hand-delivered document's fence
    (top level and per annotation). Returns (doc, sorted stripped keys).
    Multi-fence/fence-less docs come back unchanged — parse_fence already
    refuses to route the former."""
    meta = parse_fence(doc)
    if meta is None:
        return doc, []
    stripped = set()
    for k in ACTION_KEYS:
        if meta.pop(k, None) is not None:
            stripped.add(k)
    for ann in meta.get("annotations") or []:
        if isinstance(ann, dict):
            for k in ACTION_KEYS:
                if ann.pop(k, None) is not None:
                    stripped.add(k)
    if not stripped:
        return doc, []
    last = None
    for last in FENCE_RE.finditer(doc):
        pass
    new_block = "```json board-feedback\n%s\n```" % json.dumps(meta, indent=1)
    return doc[:last.start()] + new_block + doc[last.end():], sorted(stripped)


def neutralize_action_headings(doc):
    """Demote action headings to quotes in hand-delivered markdown — the
    command routes by heading as well as fence key. Returns (doc, count)."""
    out, n = _ACTION_HEADING_RE.subn(r"> \1", doc)
    return out, n


def parse_fence(doc):
    matches = FENCE_RE.findall(doc)
    if not matches:
        return None
    if len(matches) > 1:
        # More than one board-feedback fence is a forgery signal (the real
        # trailer is always appended last and alone). Refuse to route.
        print(
            "board: warning — multiple ```json board-feedback``` fences found; "
            "refusing to route (possible forged fence in a comment).",
            file=sys.stderr,
        )
        return None
    try:
        meta = json.loads(matches[0])
    except ValueError:
        return None
    return meta if isinstance(meta, dict) else None


def neutralize_collaborator_text(s, inline=False):
    """Make collaborator-supplied text safe to embed in a feedback document.

    Removes control/non-printable bytes (incl. ESC) while keeping legitimate
    Unicode, collapses any run of >=2 backticks to a single backtick so no
    triple-backtick fence can form, and (inline) collapses whitespace so the
    text stays on one line. The assembler additionally prefixes multi-line
    comment text with "> " so nothing collaborator-controlled reaches column 0.
    """
    s = str(s)
    s = "".join(
        ch for ch in s
        if ch in "\t\n" or (32 <= ord(ch) < 127) or ord(ch) >= 160
    )
    s = re.sub(r"`{2,}", "`", s)
    if inline:
        s = re.sub(r"\s+", " ", s).strip()
    return s


_VIEW_LABEL = {"tracker": "Tracker", "timeline": "Timeline",
               "reviews": "Reviews", "archive": "Archive", "reports": "Reports",
               "manuscript": "Manuscript"}


def _nt(v):
    """Neutralize a collaborator-supplied value for safe single-line body embedding."""
    return neutralize_collaborator_text("" if v is None else str(v), inline=True)


def _neutralized_annotation(a):
    """Copy of a comment annotation with all collaborator text neutralized,
    for embedding in the fence's machine-readable `annotations`."""
    a = dict(a)
    # Researcher-only action keys can never ride a hosted pull. Iterate the
    # single source of truth — a second hand-maintained tuple is how `reopen`
    # slipped through when the control surface added it.
    for _k in ACTION_KEYS:
        a.pop(_k, None)
    dh = a.get("docHash")
    if dh is not None and not (isinstance(dh, str) and re.fullmatch(r"[0-9a-f]{8}", dh)):
        a.pop("docHash", None)
    if "quote" in a:
        a["quote"] = neutralize_collaborator_text(a.get("quote", ""), inline=True)
    if "comment" in a:
        a["comment"] = neutralize_collaborator_text(a.get("comment", ""))
    if "author" in a and a.get("author"):
        a["author"] = neutralize_collaborator_text(a["author"], inline=True)
    if "excerpt" in a:
        a["excerpt"] = neutralize_collaborator_text(a.get("excerpt", ""))
    if "sectionHeading" in a and a.get("sectionHeading"):
        a["sectionHeading"] = neutralize_collaborator_text(a["sectionHeading"], inline=True)
    if "view" in a and a.get("view"):
        a["view"] = _nt(a["view"])
    tgt = a.get("target")
    if isinstance(tgt, dict):
        tgt = dict(tgt)
        if "quote" in tgt:
            tgt["quote"] = neutralize_collaborator_text(tgt.get("quote", ""), inline=True)
        if "artifactId" in tgt and tgt.get("artifactId"):
            tgt["artifactId"] = _nt(tgt["artifactId"])
        if "metricLabel" in tgt and tgt.get("metricLabel"):
            tgt["metricLabel"] = _nt(tgt["metricLabel"])
        a["target"] = tgt
    return a


_REPORT_DOCKEY_RE = re.compile(r"plans/reports/[A-Za-z0-9._-]+-r\d+-report\.md")
# Component regex must start alphanumeric (real components are NN-slug) — this
# rejects "." and ".." so a poisoned component can't path-escape upward.
_COMPONENT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
# Only md/docx are ever annotatable (see _read_manuscript_file) — hwp/hwpx
# never render an AnnotationLayer client-side, so no comment can carry that docKey.
_MANUSCRIPT_DOCKEY_RE = re.compile(r"plans/manuscript\.(?:md|docx)")


def _doc_stale(root, a):
    """True/False when the comment's docHash is verifiable against a plain file
    on disk; None when not our job (no root, unsupported type, bad fields).
    JSON-serialization-hashed types (result/script comments) are NOT verifiable
    here — JSON.stringify is not byte-portable to Python."""
    dh = a.get("docHash")
    if root is None or not isinstance(dh, str) or not re.fullmatch(r"[0-9a-f]{8}", dh):
        return None
    t = a.get("type")
    if t == "plan-comment":
        comp, ver = a.get("component"), a.get("version")
        if (not isinstance(comp, str) or not _COMPONENT_RE.fullmatch(comp)
                or not isinstance(ver, int) or isinstance(ver, bool)
                or not (0 <= ver <= 9999)):
            return None
        p = root / "plans" / "execution" / comp / ("v%d.md" % ver)
    elif t == "doc-comment" and a.get("view") == "reports":
        key = a.get("docKey")
        if (not isinstance(key, str) or len(key) > 300
                or not _REPORT_DOCKEY_RE.fullmatch(key)):
            return None
        p = root / key
    elif t == "doc-comment" and a.get("view") == "manuscript":
        key = a.get("docKey")
        if (not isinstance(key, str) or len(key) > 300
                or not _MANUSCRIPT_DOCKEY_RE.fullmatch(key)):
            return None
        p = root / key
    else:
        return None
    try:
        if not p.is_file():
            return True  # target gone — definitely not current
        if t == "doc-comment" and a.get("view") == "manuscript" and p.suffix == ".docx":
            # Must match collect_payload's extraction, not the raw file bytes —
            # the client hashed the EXTRACTED text, not the docx binary.
            content = _extract_docx_text(p)
        else:
            content = p.read_text(encoding="utf-8", errors="replace")
        if t == "doc-comment" and a.get("view") == "reports":
            content = _strip_report_marker(content)
        return fnv1a_hex(content) != dh
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError):
        return None  # unverifiable, not stale


def assemble_hosted_document(annotations, meta, root=None):
    """Assemble ONE collaborator feedback document (comment annotations only).

    NEVER emits verdict/review/report blocks — those are researcher-only actions
    taken on the researcher's own board, never through a pulled document.
    """
    KNOWN_COMMENT_TYPES = {"plan-comment", "result-comment", "script-comment", "doc-comment", "general"}
    annotations = [a for a in annotations if a.get("type") in KNOWN_COMMENT_TYPES]
    lines = ["# Board Feedback", ""]
    n = len(annotations)
    if n == 0:
        lines.append("No feedback.")
    else:
        lines.append("I've reviewed the board and have %d piece%s of feedback:"
                     % (n, "" if n == 1 else "s"))
        lines.append("")
    for i, a in enumerate(annotations, 1):
        author = _nt(a.get("author") or "")
        via = " (via %s)" % author if author else ""
        t = a.get("type")
        if t == "plan-comment":
            head = "%s v%s%s%s" % (
                _nt(a.get("component", "")), _nt(a.get("version", "")),
                " (draft)" if a.get("isDraft") else "",
                (" — %s" % _nt(a["sectionHeading"]))
                if a.get("sectionHeading") else "")
            lines.append("## %d. [%s]%s" % (i, head, via))
            lines.append('Feedback on: "%s"'
                         % _nt(a.get("quote", "")))
        elif t == "result-comment":
            tgt = a.get("target", {})
            kind = tgt.get("kind")
            desc = ("artifact %s" % _nt(tgt.get("artifactId")) if kind == "artifact"
                    else "metric %s" % _nt(tgt.get("metricLabel")) if kind == "metric"
                    else "report")
            lines.append("## %d. [%s r%s — %s]%s"
                         % (i, _nt(a.get("component", "")), _nt(a.get("resultsVersion", "")),
                            _nt(desc), via))
            if tgt.get("quote"):
                lines.append('Feedback on: "%s"'
                             % _nt(tgt["quote"]))
        elif t == "script-comment":
            script = str(a.get("script", "")).split("/")[-1]
            lines.append("## %d. [%s r%s — %s lines %s-%s]"
                         % (i, _nt(a.get("component", "")), _nt(a.get("resultsVersion", "")),
                            _nt(script),
                            _nt(a.get("lineStart", "")), _nt(a.get("lineEnd", ""))))
            for ln in neutralize_collaborator_text(a.get("excerpt", "")).split("\n"):
                lines.append("> " + ln)
        elif t == "doc-comment":
            label = _VIEW_LABEL.get(a.get("view", "")) or _nt(a.get("view", ""))
            head = "%s%s" % (
                label,
                (" — %s" % _nt(a["sectionHeading"]))
                if a.get("sectionHeading") else "")
            lines.append("## %d. [%s]%s" % (i, head, via))
            lines.append('Feedback on: "%s"'
                         % _nt(a.get("quote", "")))
        elif t == "general":
            lines.append("## %d. [%s — general]"
                         % (i, _nt(a.get("view", ""))))
        else:
            continue  # unknown type — never route it
        for ln in neutralize_collaborator_text(a.get("comment", "")).split("\n"):
            lines.append("> " + ln)
        if _doc_stale(root, a):
            lines.append("")
            lines.append("⚠ This comment may refer to an older version of its target document.")
        lines.append("")
    body = "\n".join(lines).rstrip()
    fence_meta = {
        "sessionId": meta.get("sessionId"),
        "generatedAt": meta.get("generatedAt"),
        "mode": "hosted",
        "focus": meta.get("focus"),
        "reviewer": meta.get("reviewer"),
        "shareHash": meta.get("shareHash"),
        "annotations": [_neutralized_annotation(a) for a in annotations],
    }
    return (body + "\n\n```json board-feedback\n"
            + json.dumps(fence_meta, indent=1, ensure_ascii=False) + "\n```\n")


def inspect_feedback_document(root, doc):
    meta = parse_fence(doc)
    if meta is None:
        print(
            "board: warning — no parseable ```json board-feedback``` fence; "
            "route from the markdown body.",
            file=sys.stderr,
        )
    elif meta.get("mode") in ("remote", "hosted") and meta.get("shareHash"):
        try:
            current = collect_payload(root, meta.get("mode"), meta.get("focus"))
            fresh = current.get("shareHash")  # defensive: None if not stamped
        except SystemExit:
            fresh = None  # e.g. focused component no longer exists
        if fresh != meta["shareHash"]:
            print(
                "board: STALE — plans changed since this feedback was produced "
                "(share %s, now %s). Relay this to the researcher before "
                "routing." % (meta["shareHash"], fresh or "unknown"),
                file=sys.stderr,
            )
    print(doc)
    return 0


def collect_file(root, path):
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    if not p.is_file():
        die("no feedback file at %s" % p)
    doc = p.read_text(encoding="utf-8", errors="replace")
    # Hand-delivered ingress never carries action authority: strip the keys
    # and demote the headings. (The live pending file goes through
    # collect_pending and is NOT sanitized — it is server-written.)
    doc, stripped = strip_action_keys_from_document(doc)
    doc, demoted = neutralize_action_headings(doc)
    if stripped or demoted:
        print("board: stripped researcher-action markers from hand-delivered "
              "file (%s%s)" % (", ".join(stripped) if stripped else "",
                               ("; %d heading(s) demoted" % demoted)
                               if demoted else ""),
              file=sys.stderr)
    return inspect_feedback_document(root, doc)


def write_ticket(root, slug, version, content, batch_id, order_action_id=None):
    """Write a sign-session ticket that signoff_gate.check_ticket accepts.
    Hashed over the NORMALIZED draft (sign-off-trailer-invariant), so the later
    signed vN.md write matches and the gate allows it without reopening a browser."""
    doc = {
        "slug": slug,
        "version": version,
        "contentHash": hashlib.sha256(
            normalize_plan(content).encode("utf-8")).hexdigest(),
        "approver": os.environ.get("USER", "researcher"),
        "batchId": batch_id,
        "approvedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "expiry": time.time() + TICKET_TTL,
    }
    if order_action_id is not None:
        doc["orderActionId"] = order_action_id
    tp = root / "plans" / "execution" / ("%s%s-v%d" % (TICKET_PREFIX, slug, version))
    models.atomic_write(tp, json.dumps(doc, indent=1))
    return tp


def build_sign_feedback(slug, version, note, annotations):
    """Durable, human-readable request-changes record for one sign item."""
    lines = ["# Sign feedback — %s v%d" % (slug, version)]
    if note.strip():
        lines.extend(["", "## Note", "", note.strip()])
    kept = [a for a in annotations if isinstance(a, dict)]
    if kept:
        lines.extend(["", "## Annotations"])
    for index, annotation in enumerate(kept, 1):
        section = str(annotation.get("sectionHeading") or "").strip()
        quote = str(annotation.get("quote") or "").strip()
        comment = str(annotation.get("comment") or "").strip()
        lines.extend(["", "### %d%s" % (
            index, " — %s" % section if section else "")])
        if quote:
            lines.extend(["", "> " + quote.replace("\n", "\n> ")])
        if comment:
            lines.extend(["", comment])
    return "\n".join(lines).rstrip() + "\n"


def retire_orphan_order_tickets(root):
    """Retire live-order tickets whose durable order never committed.

    Sign-session approvals have no orderActionId and are never touched. A bound ticket
    stays valid while its matching pending order exists, and is inert once the
    signed version exists. Otherwise it is an orphan from the ticket-first
    crash window and must force a fresh researcher approval.
    """
    pending_action_id = None
    pending = root / "plans" / ".board-feedback.md"
    if pending.is_file():
        try:
            meta = parse_fence(pending.read_text(encoding="utf-8"))
            pending_action_id = meta.get("actionId") if meta else None
        except OSError:
            pass

    retired = []
    exec_dir = root / "plans" / "execution"
    if not exec_dir.is_dir():
        return retired
    for ticket in sorted(exec_dir.glob(TICKET_PREFIX + "*-v*")):
        try:
            doc = json.loads(ticket.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        action_id = doc.get("orderActionId")
        slug = doc.get("slug")
        version = doc.get("version")
        if not isinstance(action_id, str):
            continue
        if pending_action_id == action_id:
            continue
        if (isinstance(slug, str) and isinstance(version, int)
                and (exec_dir / slug / ("v%d.md" % version)).is_file()):
            continue
        try:
            ticket.unlink()
        except FileNotFoundError:
            continue
        retired.append(ticket)
    return retired


def apply_sign(root, payload, component=None):
    """Collect current-tracker drafts into a one-shot ticket sign session."""
    master = payload["files"]["masterPlan"]["content"]
    items = []
    for group in payload["files"]["executionPlans"]:
        slug = group["component"]
        if "execution/%s/" % slug not in master:
            continue
        if component not in (None, "ALL") and slug != component:
            continue
        draft = group.get("draft")
        if draft is None:
            continue
        content = draft["content"]
        tr = parse_trailer(content)
        if tr["kind"] != "none":
            print(
                "board: skipping %s: trailer state is %s; repair the mutable "
                "draft so it has no sign-off or amendment trailer"
                % (draft["path"], tr["kind"]),
                file=sys.stderr,
            )
            continue
        version = int(draft["proposedVersion"])
        items.append({
            "component": slug,
            "proposedVersion": version,
            "path": draft["path"],
            "content": content,
            "contentHash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "ticketed": has_valid_ticket(root, slug, version, content),
        })
    if not items:
        scope = " for %s" % component if component not in (None, "ALL") else ""
        print("board: no eligible pending drafts%s — no sign session opened"
              % scope, file=sys.stderr)
        return None
    payload["sign"] = {
        "batchId": uuid.uuid4().hex[:8],
        "transport": "ticket",
        "items": items,
    }
    return payload


def has_valid_ticket(root, slug, version, content):
    """True when .aict-approved-<slug>-vN exists, is unexpired, and hashes
    over the CURRENT draft — i.e. the draft is approved awaiting its vN.md
    write, not pending. Mirrors signoff_gate.check_ticket's validity rules."""
    tp = root / "plans" / "execution" / ("%s%s-v%d" % (TICKET_PREFIX, slug, version))
    if not tp.is_file():
        return False
    try:
        doc = json.loads(tp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if doc.get("slug") != slug or doc.get("version") != version:
        return False
    exp = doc.get("expiry")
    if isinstance(exp, (int, float)) and time.time() > exp:
        return False
    action_id = doc.get("orderActionId")
    if isinstance(action_id, str):
        pending = root / "plans" / ".board-feedback.md"
        try:
            meta = parse_fence(pending.read_text(encoding="utf-8"))
        except OSError:
            return False
        if not meta or meta.get("actionId") != action_id:
            return False
    return doc.get("contentHash") == hashlib.sha256(
        normalize_plan(content).encode("utf-8")).hexdigest()


def apply_gate(root, payload, gate_spec):
    """gate_spec is '<slug>/vN'. Reads the proposal from .gate-vN.md (skipping
    the reservation header comment) and injects it as the component's draft."""
    m = re.fullmatch(r"(.+)/v(\d+)", gate_spec)
    if not m:
        die("--gate expects <component-slug>/vN")
    slug, version = m.group(1), int(m.group(2))
    gate_file = root / "plans" / "execution" / slug / (".gate-v%d.md" % version)
    if not gate_file.is_file():
        die("gate proposal missing at %s" % gate_file)
    lines = gate_file.read_text(encoding="utf-8").split("\n")
    if lines and lines[0].startswith("<!-- gate"):
        lines = lines[1:]
    content = "\n".join(lines)

    entry = {
        "component": slug,
        "proposedVersion": version,
        "path": "plans/execution/%s/.gate-v%d.md" % (slug, version),
        "content": content,
        "contentHash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "ticketed": False,
    }
    payload["sign"] = {
        "batchId": uuid.uuid4().hex[:8],
        "transport": "hook",
        "items": [entry],
    }
    payload["focus"] = slug
    groups = payload["files"]["executionPlans"]
    group = next((g for g in groups if g["component"] == slug), None)
    if group is None:
        group = {"component": slug, "versions": []}
        groups.append(group)
    group["draft"] = dict(entry)
    return payload


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _valid_seed(s):
    """A well-formed seed the client can render/anchor without crashing.

    Scope-aware (v0.9 Phase 4). Every scope shares sectionHeading/quote/comment/
    author; the routing fields differ:
      - plan (default when scope absent): planPath, component, version, isDraft
      - master: no extra fields (anchors container-wide on the tracker)
      - results: component, resultsVersion
    """
    if not isinstance(s, dict):
        return False
    if not (
        isinstance(s.get("sectionHeading"), str)
        and isinstance(s.get("quote"), str) and bool(s["quote"])
        and isinstance(s.get("comment"), str) and bool(s["comment"])
        and isinstance(s.get("author"), str)
    ):
        return False
    scope = s.get("scope", "plan")
    if scope == "plan":
        return (
            isinstance(s.get("planPath"), str)
            and isinstance(s.get("component"), str)
            and _is_int(s.get("version"))
            and isinstance(s.get("isDraft"), bool)
        )
    if scope == "master":
        return True
    if scope == "results":
        return isinstance(s.get("component"), str) and _is_int(s.get("resultsVersion"))
    return False


def load_seed_annotations(path):
    """Reviewer-produced comments (JSON list) for --seed-annotations (agent plan
    review). Returns only well-formed items — a bad seed file OR a bad item must
    never block the board or crash the client."""
    try:
        seeds = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("board: could not read --seed-annotations %s: %s" % (path, e),
              file=sys.stderr)
        return []
    if not isinstance(seeds, list):
        return []
    valid = [s for s in seeds if _valid_seed(s)]
    if len(valid) != len(seeds):
        print("board: dropped %d malformed seed annotation(s)"
              % (len(seeds) - len(valid)), file=sys.stderr)
    return valid


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="aict")
    ap.add_argument("--focus", default=None, metavar="NN-slug")
    ap.add_argument("--export", nargs="?", const="DEFAULT", default=None, metavar="PATH")
    ap.add_argument("--share", nargs="?", const="DEFAULT", default=None, metavar="PATH")
    ap.add_argument("--publish", action="store_true",
                    help="publish the static board to the repo's GitHub Pages (gh-pages branch)")
    ap.add_argument("--collect", nargs="?", const="PENDING", default=None, metavar="FILE")
    ap.add_argument("--ack", action="store_true",
                    help="acknowledge (delete) the routed pending order")
    ap.add_argument("--gate", default=None, metavar="SLUG/vN")
    ap.add_argument("--sign", nargs="?", const="ALL", default=None,
                    metavar="NN-slug",
                    help="one-shot sign session over current-tracker drafts")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-open", action="store_true")
    # Default None = no idle timeout for plain live serving (Plannotator-style).
    # Sign sessions pass an explicit timeout; serve() also keeps a bounded wait for
    # those modes even if one is omitted. An explicit --timeout always bounds.
    ap.add_argument("--timeout", type=int, default=None, metavar="SECONDS")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--seed-annotations", default=None, metavar="FILE",
                    help="inject reviewer-produced comments (JSON list) as pending "
                         "annotations — agent plan review (v0.9)")
    ap.add_argument("--publish-web", action="store_true")
    ap.add_argument("--pull", action="store_true")
    ap.add_argument("--web-connect", action="store_true")
    ap.add_argument("--web-clear", action="store_true")
    ap.add_argument("--set-password", action="store_true")
    ap.add_argument("--install-launcher", action="store_true",
                    help="write the mechanical ./aict-board launcher and exit")
    ap.add_argument("--project-root", default=None, metavar="DIR",
                    help="use DIR as the project root instead of inferring it "
                         "(the aict-board launcher passes --project-root .)")
    ap.add_argument("--reuse", action="store_true",
                    help="on a plain-live launch, open an already-running board "
                         "for this project instead of failing or double-serving")
    return ap.parse_args(argv)


_ACTION_FLAGS = ("export", "share", "publish", "publish_web", "pull",
                 "web_connect", "web_clear", "set_password", "ack",
                 "install_launcher")


def selected_actions(args):
    out = []
    for name in _ACTION_FLAGS:
        v = getattr(args, name, None)
        if v not in (None, False):
            out.append(name)
    if getattr(args, "collect", None) is not None:
        out.append("collect")
    return out


def check_action_exclusivity(args):
    acts = selected_actions(args)
    if len(acts) > 1:
        die("choose one action at a time (got: %s)" % ", ".join(acts))
    if getattr(args, "publish_web", False) and args.focus:
        die("--publish-web publishes the full board; --focus is not supported for hosted boards.")


def main():
    args = parse_args()
    check_action_exclusivity(args)

    if args.project_root:
        # The aict-board launcher passes --project-root . after cd'ing to its own
        # dir, pinning the board to THIS project even when a parent git repo also
        # has plans/ (find_root() would otherwise prefer the git toplevel).
        root = Path(args.project_root).resolve()
        if not (root / "plans" / "master-plan.md").is_file():
            die("no plans/master-plan.md at --project-root %s" % root)
    else:
        root = find_root()
        if not (root / "plans" / "master-plan.md").is_file():
            # find_root may have picked a git root above a non-initialized cwd
            if (Path.cwd() / "plans" / "master-plan.md").is_file():
                root = Path.cwd()
            else:
                die("no plans/master-plan.md found — run /aict:init first")

    if args.collect is not None:
        if args.collect == "PENDING":
            collect_pending(root)
        else:
            collect_file(root, args.collect)
    elif args.ack:
        ack_pending(root)
    elif args.share is not None:
        share(root, args)
    elif args.export is not None:
        export(root, args)
    elif args.publish:
        publish_pages(root, args)
    elif args.publish_web:
        publish_web(root, args)
    elif args.pull:
        pull(root, args)
    elif args.web_connect:
        web_connect(root, args)
    elif args.web_clear:
        web_clear(root, args)
    elif args.set_password:
        set_password(root, args)
    elif args.install_launcher:
        ensure_launcher(root, explicit=True)
    else:
        # Plain live serving (not a gate/sign session, which deliberately shut
        # down a prior board and can return without serving). Keep the launcher
        # current, and — for the launcher's own --reuse — reconnect to an
        # already-running board instead of failing on the lock or double-serving.
        plain_live = not args.gate and args.sign is None
        if plain_live:
            ensure_launcher(root)
            if args.reuse:
                port = healthy_running_board(root)
                if port is not None:
                    url = "http://127.0.0.1:%d" % port
                    print("Board already open: %s" % url, file=sys.stderr)
                    if not args.no_open:
                        try:
                            webbrowser.open(url)
                        except Exception:
                            pass
                    return
        slug, focus_results, focus_view = split_focus(args.focus)
        # Agent plan review (v0.9): reviewer-produced comments, seeded as
        # pending annotations for the researcher to curate and Send to Claude.
        seeds = (load_seed_annotations(args.seed_annotations)
                 if args.seed_annotations else None)
        payload = build_live_payload(root, slug, focus_results, focus_view,
                                     seeds or None)
        if args.gate:
            payload = apply_gate(root, payload, args.gate)
        elif args.sign is not None:
            payload = apply_sign(root, payload, component=args.sign)
            if payload is None:
                return
        if args.gate or args.sign is not None:
            request_shutdown(root / "plans")
        serve(root, payload, args)


if __name__ == "__main__":
    main()
