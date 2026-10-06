#!/usr/bin/env python3
"""aict: submit the project state to an instructor-hosted classroom server.

Builds a submission envelope (the same payload the board serves in "remote"/
"hosted" mode, plus a bounded git-log excerpt of plans/) and, on request,
POSTs it to a classroom server's /api/submissions endpoint with the
student's personal bearer token. Never runs silently — always preview with
--dry-run first (the /ait:submit command enforces this).

Stdlib only, Python 3.9+. Modes:
  --dry-run                    build the envelope, print a summary, no network call
  --url URL --token TOKEN      (first run) save the classroom config, then submit
                                (later runs: both optional, reuse the saved config)
  [--course COURSEID]          optional course identifier, saved with the config
  [--manuscript PATH]          pin the manuscript file to send (remembered in
                                plans/manuscript-source.txt); "default" unpins

Before sending, the manuscript is checked against other manuscript-like files
in the project: a newer one stops an unpinned submit until the student says
which file is the paper. After a submit, the exact content sent is written to
plans/.aict-submitted/board.html (a read-only board) and opened in the
browser, so the student sees what went in.

Exit codes: 0 submitted (created or replay) / dry-run printed; 1 usage,
environment, or server-rejection error.
"""

import argparse
import base64
import binascii
import copy
import datetime
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Console output is UTF-8 whatever the OS locale: on Korean Windows (cp949) a
# bare print() of an em dash, or of a Korean manuscript excerpt, raises
# UnicodeEncodeError. Same as running under PYTHONUTF8=1 (check.py does this too).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from signoff_gate import normalize_plan, parse_trailer  # noqa: E402
from board import (  # noqa: E402
    collect_payload,
    build_assets,
    iter_bundles,
    share_hash,
    payload_files,
    find_root,
    manuscript_location,
    write_manuscript_source,
    clear_manuscript_source,
    render_snapshot_html,
    ensure_gitignore,
    MANUSCRIPT_SOURCE,
)
import classroom  # noqa: E402

ENVELOPE_SCHEMA_VERSION = 1
# Vercel's serverless function request body limit is 4.5 MB (4,500,000
# bytes, not MiB): a bigger body never reaches the server's own 413 — Vercel
# answers first with an HTML error. So the client stops BEFORE sending, with
# 100 KB of headroom, and says what is too big.
ENVELOPE_HARD_CAP = 4_400_000

# Files sent outside the envelope (manuscript figures, results artifacts):
# uploaded to /api/assets in parts no larger than this, then referenced from
# the payload as "aict-asset:<sha256>". Mirrors ASSET_PART_BYTES in the
# classroom server's lib/assets.ts.
ASSET_PART_BYTES = 4 * 1024 * 1024
ASSET_REF_PREFIX = "aict-asset:"
# Anything this big always goes out separately...
EXTERNALIZE_MIN_BYTES = 32 * 1024
# ...and smaller files follow, largest first, until the envelope fits here
# (headroom under the 4.5 MB cap for the JSON itself).
ENVELOPE_TARGET_BYTES = int(3.5 * 1024 * 1024)
# A manuscript body over this (a long thesis converted from Word) is sent
# separately too, so the envelope stays plans + metadata.
MANUSCRIPT_EXTERNALIZE_BYTES = 1024 * 1024


def die(msg, code=1):
    print("submit: %s" % msg, file=sys.stderr)
    sys.exit(code)


# --- Git log excerpt (plans/ only — hash/author-date/author/subject, no diffs) ---

def _master_plan_first_commit_date(root):
    """First commit date touching plans/master-plan.md — the exact same lookup
    board.py's git_info() already performs (--reverse --format=%cI over one
    path), reused here rather than reimplemented differently."""
    try:
        out = subprocess.run(
            ["git", "log", "--reverse", "--format=%cI", "--", "plans/master-plan.md"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(root), timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip().splitlines()[0]
    except Exception:
        pass
    return None


def _since_cutoff(root, max_days):
    """ISO datetime for git log --since: the SHORTER of max_days-ago and
    plans/master-plan.md's first commit — i.e. whichever cutoff is more
    recent, so the excerpt never reaches further back than the project's own
    start even when max_days is generous, and never exceeds max_days even on
    an old project."""
    cutoff_days = (
        datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=max_days)
    )
    first = _master_plan_first_commit_date(root)
    if first:
        try:
            cutoff_master = datetime.datetime.fromisoformat(first)
        except ValueError:
            cutoff_master = None
        if cutoff_master is not None:
            if cutoff_master.tzinfo is None:
                cutoff_master = cutoff_master.replace(tzinfo=datetime.timezone.utc)
            return max(cutoff_days, cutoff_master).isoformat()
    return cutoff_days.isoformat()


def git_log_excerpt(root, subpath="plans", max_commits=200, max_days=120):
    """Bounded git history excerpt for the submission envelope's gitExcerpt:
    hash / author date / author name / commit-subject only — no diffs, no
    commit bodies. One git log call (not a per-file loop), field-separated by
    \\x1f. Graceful no-git fallback: never raises, matching results.py's
    find_root()/board.py's find_root() "fail open to a usable default"
    philosophy — a missing git repo or missing git binary must never fail the
    whole submission."""
    empty = {"available": False, "head": None, "branch": None, "commits": []}
    try:
        head = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(root), timeout=10,
        )
        if head.returncode != 0:
            return empty
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(root), timeout=10,
        )
    except Exception:
        return empty

    since = _since_cutoff(root, max_days)
    commits = []
    try:
        log = subprocess.run(
            [
                "git", "log",
                "-n", str(max_commits),
                "--since=%s" % since,
                "--format=%h\x1f%aI\x1f%an\x1f%s",
                "--", subpath,
            ],
            capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(root), timeout=15,
        )
        if log.returncode == 0:
            for line in log.stdout.splitlines():
                parts = line.split("\x1f")
                if len(parts) != 4:
                    continue
                h, author_date, author_name, subject = parts
                commits.append({
                    "hash": h,
                    "authorDate": author_date,
                    "authorName": author_name,
                    "subject": subject,
                })
    except Exception:
        commits = []

    return {
        "available": True,
        "head": head.stdout.strip() or None,
        "branch": (branch.stdout.strip() or None) if branch.returncode == 0 else None,
        "commits": commits,
    }


# --- Local pre-flight validation (read-only — reports, never writes plans) ---

def preflight_warnings(payload):
    """Read-only checks over the embedded plan content, run before the
    envelope goes out, so a trailer problem surfaces here rather than only in
    the server's reverify pass. Reuses signoff_gate's own normalize_plan/
    parse_trailer — the exact functions the sign-off gate and board.py hash
    and validate against — never reimplemented."""
    warnings = []
    for g in payload["files"]["executionPlans"]:
        for v in g.get("versions", []):
            tr = parse_trailer(v["content"])
            if tr["kind"] == "malformed":
                warnings.append(
                    "%s: trailer grammar violation (%s)"
                    % (v["path"], "; ".join(tr["violations"]))
                )
            elif tr["kind"] == "none":
                warnings.append(
                    "%s: no sign-off trailer found on a canonical version" % v["path"]
                )
            try:
                normalize_plan(v["content"])
            except Exception as e:
                warnings.append(
                    "%s: could not normalize plan content (%s)" % (v["path"], e)
                )
    return warnings


# --- Manuscript check: is the file being sent the paper the student is writing? ---

MANUSCRIPT_EXTS = (".md", ".docx", ".hwp", ".hwpx")
# Word/HWP files at the project root always count. Markdown files (README,
# CLAUDE.md, notes) and files one folder down count only when their own or
# their folder's name says they are the paper.
_PAPER_NAME_RE = re.compile(
    r"manuscript|paper|draft|thesis|article|원고|논문|초고|본문", re.IGNORECASE)
_SKIP_DIRS = {"plans", "node_modules", "venv", "env", "renv", "__pycache__",
              "site-packages"}
# A copy keeps its source's mtime, and some filesystems store it at 2-second
# resolution — so "newer" means newer by more than this.
_MTIME_SLACK = 2.0


def _stamp(ts):
    return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def _iso_stamp(iso):
    try:
        return datetime.datetime.fromisoformat(iso).astimezone().strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return iso or "?"


def manuscript_candidates(root, exclude=None):
    """[(project-relative path, mtime)] of files that look like the paper,
    newest first, without `exclude` (the file being sent). Word's "~$" lock
    files are skipped."""
    root = Path(root)
    found = []

    def consider(p, named):
        if p.name.startswith("~$") or p.suffix.lower() not in MANUSCRIPT_EXTS:
            return
        if p.suffix.lower() == ".md" and not named:
            return
        try:
            rel = p.relative_to(root).as_posix()
            if rel != exclude and p.is_file():
                found.append((rel, p.stat().st_mtime))
        except (ValueError, OSError):
            pass

    try:
        top = sorted(root.iterdir())
    except OSError:
        top = []
    for p in top:
        if p.is_file():
            consider(p, bool(_PAPER_NAME_RE.search(p.stem)))
        elif p.is_dir() and not p.name.startswith(".") and p.name not in _SKIP_DIRS:
            dir_named = bool(_PAPER_NAME_RE.search(p.name))
            try:
                for f in sorted(p.iterdir()):
                    if f.is_file() and (dir_named or _PAPER_NAME_RE.search(f.stem)):
                        consider(f, True)
            except OSError:
                pass
    for name in ("manuscript.md", "manuscript.docx", "manuscript.hwp", "manuscript.hwpx"):
        consider(root / "plans" / name, True)
    found.sort(key=lambda c: c[1], reverse=True)
    return found


def _excerpt(manuscript, n=160):
    """The manuscript's opening words, as plain text."""
    text = manuscript.get("content") or ""
    if manuscript.get("format") == "docx-html":
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    else:
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)|[#*_>`|]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


def manuscript_check(root, payload):
    """What the submission's manuscript is and whether it looks stale:
    {path, format, modifiedAt, pinned, missing, excerpt, note, newer}.
    `newer` lists [(path, mtime)] of manuscript-like files saved after the
    one being sent — or all of them, when there is none to send."""
    loc = manuscript_location(root)
    m = payload["files"].get("manuscript")
    info = {"path": None, "format": None, "modifiedAt": None, "pinned": False,
            "missing": False, "excerpt": "", "note": None, "newer": []}
    sent_mtime = None
    if loc is not None:
        p, rel, _fmt, pinned = loc
        info.update(path=rel, pinned=pinned, missing=not p.is_file())
        if not info["missing"]:
            sent_mtime = p.stat().st_mtime
    if m:
        info.update(format=m.get("format"), modifiedAt=m.get("modifiedAt"),
                    excerpt=_excerpt(m), note=m.get("note"))
    info["newer"] = [c for c in manuscript_candidates(root, exclude=info["path"])
                     if sent_mtime is None or c[1] > sent_mtime + _MTIME_SLACK]
    return info


_FORMAT_LABEL = {"markdown": "Markdown", "docx-html": "Word",
                 "unsupported": "can't be previewed"}


def manuscript_lines(info):
    """The manuscript part of the preview, as printable lines."""
    if info["path"] is None:
        return ["  manuscript: none (no plans/manuscript.md or plans/manuscript.docx)"]
    if info["missing"]:
        return ["  manuscript: %s — MISSING (set in %s)" % (info["path"], MANUSCRIPT_SOURCE)]
    lines = ["  manuscript: %s (%s) — saved %s" % (
        info["path"], _FORMAT_LABEL.get(info["format"], info["format"]),
        _iso_stamp(info["modifiedAt"]))]
    lines.append("    chosen by: %s" % (
        "your setting in %s" % MANUSCRIPT_SOURCE if info["pinned"]
        else "default location (plans/manuscript.md, then plans/manuscript.docx)"))
    if info["format"] == "unsupported" and info["note"]:
        lines.append("    note: %s" % info["note"])
    elif info["excerpt"]:
        lines.append('    begins: "%s"' % info["excerpt"])
    return lines


def manuscript_warning(info):
    """A warning when the manuscript being sent may not be the student's
    current paper, else None."""
    if info["missing"]:
        return ("the manuscript file set in %s (%s) does not exist. Point it at your "
                'current manuscript with --manuscript "<path>", or use --manuscript '
                "default to go back to plans/manuscript.*." % (MANUSCRIPT_SOURCE, info["path"]))
    if not info["newer"]:
        return None
    listed = "\n".join("    - %s — saved %s" % (rel, _stamp(t)) for rel, t in info["newer"][:5])
    if info["path"] is None:
        return ("no manuscript will be sent, but these look like one:\n%s\n"
                '  To send one, run again with --manuscript "<path>" (remembered for '
                "later submissions)." % listed)
    return ("these manuscript-like files were saved AFTER the one being sent:\n%s\n"
            "  Being sent: %s — saved %s.\n"
            "  Which is your current paper? Run again with --manuscript \"<path>\" and "
            "that file is sent from now on (to keep this one: --manuscript \"%s\")."
            % (listed, info["path"], _iso_stamp(info["modifiedAt"]), info["path"]))


def plan_versions(payload):
    """[(component, [version, ...])] of the canonical plan versions included."""
    return [(g["component"], [v["version"] for v in g.get("versions", [])])
            for g in payload["files"]["executionPlans"]]


def contents_lines(payload):
    """The plan versions and results bundles included, as printable lines."""
    plans = " · ".join("%s v%s" % (c, ", v".join(str(v) for v in vs))
                       for c, vs in plan_versions(payload) if vs) or "none"
    results = " · ".join(
        "%s r%s" % (g["component"], ", r".join(str(b.get("resultsVersion")) for b in g["results"]))
        for g in payload["files"]["executionPlans"] if g.get("results")) or "none"
    return ["  plans: %s" % plans, "  results: %s" % results]


# --- Envelope construction ---

def build_envelope(root, course_id, payload=None):
    """Build the submission envelope. `payload` may be a pre-collected
    collect_payload(root, "submission", None) result (e.g. one already used
    for preflight_warnings) to avoid re-reading the whole plans/ tree; a
    fresh one is collected otherwise."""
    if payload is None:
        payload = collect_payload(root, "submission", None)
    build_assets(root, payload)
    idempotency_key = share_hash(payload_files(payload))
    git_excerpt = git_log_excerpt(root)
    return {
        "envelopeSchemaVersion": ENVELOPE_SCHEMA_VERSION,
        "submittedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "courseId": course_id,
        "idempotencyKey": idempotency_key,
        "payload": payload,
        "gitExcerpt": git_excerpt,
    }


def _asset_maps(payload):
    """Every basename/href -> URL map in the payload: the manuscript's figure
    map and each results bundle's artifact map (what build_assets fills)."""
    maps = []
    manuscript = payload["files"].get("manuscript")
    if manuscript and isinstance(manuscript.get("assets"), dict):
        maps.append(manuscript["assets"])
    for _component, b in iter_bundles(payload):
        if isinstance(b.get("assets"), dict):
            maps.append(b["assets"])
    return maps


def _decode_data_uri(uri):
    """(mime, bytes) for a base64 data: URI, else None."""
    if not isinstance(uri, str) or not uri.startswith("data:"):
        return None
    head, sep, data = uri.partition(",")
    if not sep or not head.endswith(";base64"):
        return None
    try:
        return head[len("data:"):-len(";base64")] or "application/octet-stream", base64.b64decode(data)
    except (ValueError, binascii.Error):
        return None


def envelope_body(envelope):
    """The exact bytes POSTed. UTF-8 with non-ASCII kept as-is: the default
    ensure_ascii=True would send every Hangul character as a 6-byte \\uXXXX
    escape — twice its UTF-8 size — so a Korean manuscript would weigh up to
    double what was measured."""
    return json.dumps(envelope, ensure_ascii=False).encode("utf-8")


def _envelope_bytes(envelope):
    return len(envelope_body(envelope))


def externalize_assets(envelope):
    """Move the envelope's embedded files out of the JSON, in place.

    Every file over EXTERNALIZE_MIN_BYTES — then smaller ones, largest first,
    while the envelope is still over ENVELOPE_TARGET_BYTES — is replaced by
    "aict-asset:<sha256>" and described in payload["externalAssets"].
    Returns {sha: bytes} for the files to upload. The idempotencyKey is
    untouched: share_hash covers the plan text, never the asset maps."""
    payload = envelope["payload"]
    inline = []  # (map, key, mime, data)
    for m in _asset_maps(payload):
        for key, uri in m.items():
            decoded = _decode_data_uri(uri)
            if decoded:
                inline.append((m, key) + decoded)
    inline.sort(key=lambda e: len(e[3]), reverse=True)

    uploads = {}
    meta = {}

    def move(entry):
        m, key, mime, data = entry
        sha = hashlib.sha256(data).hexdigest()
        uploads[sha] = data
        meta[sha] = {
            "mime": mime,
            "size": len(data),
            "parts": max(1, -(-len(data) // ASSET_PART_BYTES)),
        }
        m[key] = ASSET_REF_PREFIX + sha

    rest = []
    for entry in inline:
        if len(entry[3]) > EXTERNALIZE_MIN_BYTES:
            move(entry)
        else:
            rest.append(entry)
    # A very long manuscript body goes out the same way; the board fetches
    # it back by the same reference (externalAssets.ts / check.py).
    manuscript = payload["files"].get("manuscript")
    body = manuscript.get("content") if isinstance(manuscript, dict) else None
    if isinstance(body, str) and len(body.encode("utf-8")) > MANUSCRIPT_EXTERNALIZE_BYTES:
        mime = "text/html" if manuscript.get("format") == "docx-html" else "text/markdown"
        move((manuscript, "content", mime + "; charset=utf-8", body.encode("utf-8")))
    if meta:
        payload["externalAssets"] = meta
    for entry in rest:  # largest first
        if _envelope_bytes(envelope) <= ENVELOPE_TARGET_BYTES:
            break
        move(entry)
        payload["externalAssets"] = meta
    return uploads


def _largest_parts(envelope, n=3):
    """The n biggest pieces of an envelope, as (label, bytes)."""
    size = lambda v: len(json.dumps(v, ensure_ascii=False).encode("utf-8"))
    files = envelope["payload"]["files"]
    parts = []
    m = files.get("manuscript")
    if isinstance(m, dict):
        parts.append(("manuscript text (%s)" % m.get("path", "manuscript"), size(m.get("content", ""))))
    for key in ("masterPlan", "decisionLog"):
        if isinstance(files.get(key), dict):
            parts.append((files[key].get("path", key), size(files[key])))
    for g in files.get("executionPlans", []):
        for v in g.get("versions", []):
            parts.append((v.get("path", g.get("component", "plan")), size(v)))
        for b in g.get("results", []):
            parts.append(("results %s r%s" % (g.get("component"), b.get("resultsVersion")), size(b)))
    parts.append(("git history excerpt", size(envelope.get("gitExcerpt"))))
    return sorted(parts, key=lambda p: p[1], reverse=True)[:n]


def oversize_message(envelope):
    total = _envelope_bytes(envelope)
    biggest = ", ".join("%s %.1f MB" % (label, b / 1e6) for label, b in _largest_parts(envelope))
    return (
        "the submission is %.2f MB even with its figures and files sent separately — "
        "over the %.1f MB a classroom server accepts. Largest parts: %s. Split the "
        "manuscript or move long appendix tables into a separate file, then resubmit."
        % (total / 1e6, ENVELOPE_HARD_CAP / 1e6, biggest)
    )


def envelope_summary(envelope):
    payload = envelope["payload"]
    groups = payload["files"]["executionPlans"]
    n_components = len(groups)
    n_versions = sum(len(g.get("versions", [])) for g in groups)
    n_results = sum(len(g.get("results", [])) for g in groups)
    size_bytes = _envelope_bytes(envelope)
    git = envelope["gitExcerpt"]
    commits = git.get("commits", [])
    date_range = None
    if commits:
        dates = [c["authorDate"] for c in commits]
        date_range = (min(dates), max(dates))
    return {
        "sizeBytes": size_bytes,
        "components": n_components,
        "versions": n_versions,
        "resultsBundles": n_results,
        "gitAvailable": git.get("available", False),
        "gitCommitCount": len(commits),
        "gitDateRange": date_range,
    }


def print_dry_run(envelope, warnings, uploads=None, manuscript=None):
    summary = envelope_summary(envelope)
    print("Submission envelope preview (dry run — no network call made)")
    if manuscript is not None:
        for line in manuscript_lines(manuscript):
            print(line)
    for line in contents_lines(envelope["payload"]):
        print(line)
    print("  size: %d bytes (%.1f KB)" % (summary["sizeBytes"], summary["sizeBytes"] / 1024.0))
    if uploads:
        total = sum(len(b) for b in uploads.values())
        print(
            "  files sent separately: %d (%.1f KB) — figures and results files, "
            "uploaded before the envelope; ones the server already has are skipped"
            % (len(uploads), total / 1024.0)
        )
    print("  components: %d" % summary["components"])
    print("  analysis-plan versions: %d" % summary["versions"])
    print("  results bundles: %d" % summary["resultsBundles"])
    if summary["gitAvailable"]:
        if summary["gitDateRange"]:
            print(
                "  git excerpt (plans/): %d commit(s), %s to %s"
                % (summary["gitCommitCount"], summary["gitDateRange"][0], summary["gitDateRange"][1])
            )
        else:
            print("  git excerpt (plans/): 0 commits in the bounded window")
    else:
        print("  git excerpt (plans/): unavailable (not a git repo, or git missing)")
    print("  idempotency key: %s" % envelope["idempotencyKey"])
    print("  course id: %s" % (envelope["courseId"] or "(not configured)"))
    if summary["sizeBytes"] > ENVELOPE_HARD_CAP:
        print("  WARNING: " + oversize_message(envelope), file=sys.stderr)
    if warnings:
        print("  pre-flight warnings:")
        for w in warnings:
            print("    - %s" % w)
    mw = manuscript_warning(manuscript) if manuscript is not None else None
    if mw:
        print("  MANUSCRIPT CHECK: " + mw)


# --- Network submit ---

def print_reverify(entries):
    if not entries:
        return
    print("Server reverification:")
    for e in entries:
        line = "  - %s: %s" % (e.get("check", "?"), e.get("status", "?"))
        if e.get("detail"):
            line += " — %s" % e["detail"]
        print(line)


def _read_error_body(exc):
    try:
        return json.loads(exc.read().decode("utf-8", "replace"))
    except (OSError, ValueError, AttributeError):
        return {}


class AssetsUnsupported(Exception):
    """The server predates /api/assets — submit the envelope inline instead."""


def _post(url, token, body, content_type, timeout=120):
    """(status, parsed-json-or-{}) for one authenticated POST."""
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": "Bearer %s" % token, "Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.getcode(), (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, _read_error_body(e)


def upload_assets(url, token, envelope, uploads):
    """Send every file the server does not already hold, part by part.
    Raises AssetsUnsupported for a server without /api/assets."""
    if not uploads:
        return 0
    base = url.rstrip("/") + "/api/assets"
    meta = envelope["payload"]["externalAssets"]
    try:
        code, data = _post(
            base + "?op=check", token,
            json.dumps({"assets": [{"sha": s, "parts": meta[s]["parts"]} for s in uploads]}).encode("utf-8"),
            "application/json",
        )
    except (urllib.error.URLError, OSError):
        die("Classroom server unreachable (the server may be down, or the URL may be wrong).")
    # A server without the route answers 404 — or, before its login gate
    # learned the route, 401 {"error": "unauthorized"} (the instructor-cookie
    # gate). A rejected student token is 401 {"error": "invalid_token"}.
    if code in (404, 405) or (code == 401 and data.get("error") != "invalid_token"):
        raise AssetsUnsupported()
    if code == 401:
        _handle_error_response(401, data)
    if code != 200 or not isinstance(data.get("missing"), list):
        die("Classroom server returned HTTP %s while checking files: %s" % (code, json.dumps(data)[:300]))
    missing = [s for s in data["missing"] if s in uploads]
    for n, sha in enumerate(missing, 1):
        blob = uploads[sha]
        parts = meta[sha]["parts"]
        print("  uploading file %d/%d (%.1f KB)" % (n, len(missing), len(blob) / 1024.0))
        for i in range(parts):
            chunk = blob[i * ASSET_PART_BYTES:(i + 1) * ASSET_PART_BYTES]
            qs = "?op=put&sha=%s&part=%d&parts=%d" % (sha, i, parts)
            if parts > 1:
                qs += "&partSha=%s" % hashlib.sha256(chunk).hexdigest()
            try:
                code, data = _post(base + qs, token, chunk, "application/octet-stream")
            except (urllib.error.URLError, OSError):
                die("Upload interrupted — re-run /ait:submit; files already sent are not sent again.")
            if code != 200:
                die("Classroom server rejected a file upload (HTTP %s): %s" % (code, json.dumps(data)[:300]))
    return len(missing)


def submit_envelope(url, token, envelope):
    """POST the envelope. Returns the server's answer for a created or
    replayed submission; dies on anything else."""
    endpoint = url.rstrip("/") + "/api/submissions"
    body = envelope_body(envelope)
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer %s" % token,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            code = resp.getcode()
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        code = e.code
        data = _read_error_body(e)
        _handle_error_response(code, data)
        return None
    except (urllib.error.URLError, OSError):
        die(
            "Classroom server unreachable (the server may be down, or the "
            "URL may be wrong). Check the URL with your instructor and try "
            "again."
        )
        return None
    return _handle_response(code, data)


def _handle_response(code, data):
    if code == 201 and data.get("status") == "created":
        print("Submitted — new submission %s recorded." % data.get("submissionId", "?"))
        print_reverify(data.get("reverify", []))
        return data
    if code == 200 and data.get("status") == "replay":
        print(
            "Nothing new to send — identical content was already submitted "
            "(submission %s)." % data.get("submissionId", "?")
        )
        print_reverify(data.get("reverify", []))
        return data
    die(
        "Classroom server returned an unexpected %s response: %s"
        % (code, json.dumps(data)[:500])
    )


def _handle_error_response(code, data):
    if code == 401:
        die(
            "Token rejected. Ask your instructor for a fresh personal token — "
            "do not retry with the same one."
        )
    if code == 413:
        die(
            "Submission too large: the server's limit is %s bytes."
            % data.get("limitBytes", "?")
        )
    if code == 400 and data.get("error") == "missing_assets":
        die(
            "The server has not received %d of this submission's files. "
            "Re-run /ait:submit to upload them again." % len(data.get("missing") or [])
        )
    if code == 400 and data.get("error") == "malformed_envelope":
        die(
            "Server rejected the submission as malformed: %s"
            % data.get("detail", "no detail given")
        )
    die("Classroom server returned HTTP %s: %s" % (code, json.dumps(data)[:500]))


# --- Receipt: what was sent, as a read-only board ---

SUBMITTED_DIR = ".aict-submitted"


def write_receipt(root, envelope, result, manuscript):
    """Write plans/.aict-submitted/{board.html,receipt.json}: the payload
    exactly as sent, as a read-only board whose banner names the submission,
    the manuscript file and its saved time, and the plan versions. Each
    submit overwrites it — it is the latest send, not a history (/ait:check
    --history is that). `envelope` is the inline one, so figures are embedded
    and the page works offline. Returns the board path."""
    payload = envelope["payload"]
    receipt = {
        "status": result.get("status"),
        "submissionId": result.get("submissionId"),
        "manuscript": None if manuscript["path"] is None else {
            "path": manuscript["path"],
            "modifiedAt": manuscript["modifiedAt"],
            "pinned": manuscript["pinned"],
        },
        "plans": [{"component": c, "versions": vs} for c, vs in plan_versions(payload)],
        "results": [{"component": g["component"],
                     "versions": [b.get("resultsVersion") for b in g["results"]]}
                    for g in payload["files"]["executionPlans"] if g.get("results")],
    }
    board_payload = dict(payload, mode="snapshot", shareHash=envelope["idempotencyKey"],
                         snapshot={"submittedAt": envelope["submittedAt"], "releasedAt": None,
                                   "comments": [], "receipt": receipt})
    plans = Path(root) / "plans"
    ensure_gitignore(plans)
    out = plans / SUBMITTED_DIR
    out.mkdir(parents=True, exist_ok=True)
    board_path = out / "board.html"
    board_path.write_text(render_snapshot_html(board_payload), encoding="utf-8")
    (out / "receipt.json").write_text(json.dumps(
        dict(receipt, submittedAt=envelope["submittedAt"], idempotencyKey=envelope["idempotencyKey"]),
        ensure_ascii=False, indent=1), encoding="utf-8")
    return board_path


def print_receipt(payload, manuscript, board_path):
    print("What was sent:")
    for line in manuscript_lines(manuscript)[:1] + contents_lines(payload):
        print(line)
    print("Submitted copy (read-only board): %s" % board_path.as_posix())


def open_receipt(board_path):
    if os.environ.get("AICT_NO_BOARD"):
        return
    try:
        import webbrowser
        webbrowser.open(board_path.resolve().as_uri())
    except Exception:
        pass


# --- CLI ---

def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="AITCW submit")
    ap.add_argument("--dry-run", action="store_true",
                     help="build the envelope and print a summary; no network call")
    ap.add_argument("--url", default=None, help="classroom server base URL")
    ap.add_argument("--token", default=None, help="personal bearer token from the instructor")
    ap.add_argument("--course", dest="course_id", default=None, metavar="COURSEID")
    ap.add_argument("--manuscript", default=None, metavar="PATH",
                     help="the manuscript file to send, remembered for later "
                          'submissions; "default" goes back to plans/manuscript.*')
    return ap.parse_args(argv)


def apply_manuscript_arg(root, value):
    if value is None:
        return
    if value.strip().lower() == "default":
        clear_manuscript_source(root)
        print("Manuscript: back to the default location (plans/manuscript.*).")
        return
    try:
        rel = write_manuscript_source(root, value)
    except ValueError as e:
        die("--manuscript: %s" % e)
    print("Manuscript set to %s (saved in %s — commit it with your plans)."
          % (rel, MANUSCRIPT_SOURCE))


def main():
    args = parse_args()
    root = find_root()
    if not (root / "plans" / "master-plan.md").is_file():
        die("no plans/master-plan.md found — run /ait:init first")

    cfg = classroom.read_classroom_config(root)
    apply_manuscript_arg(root, args.manuscript)

    if args.dry_run:
        course_id = (
            args.course_id if args.course_id is not None
            else (cfg.get("courseId") if cfg else None)
        )
        payload = collect_payload(root, "submission", None)
        warnings = preflight_warnings(payload)
        manuscript = manuscript_check(root, payload)
        envelope = build_envelope(root, course_id, payload=payload)
        uploads = externalize_assets(envelope)
        print_dry_run(envelope, warnings, uploads, manuscript)
        sys.exit(0)

    url = args.url or (cfg.get("serverUrl") if cfg else None)
    token = args.token or (cfg.get("token") if cfg else None)
    course_id = (
        args.course_id if args.course_id is not None
        else (cfg.get("courseId") if cfg else None)
    )
    if not url or not token:
        die(
            "no classroom server configured — the first submission needs "
            "--url and --token (given to you by your instructor, out of "
            "band). Run /ait:submit, which walks you through this "
            "once and saves it locally."
        )

    if args.url or args.token or args.course_id is not None:
        classroom.write_classroom_config(
            root, {"serverUrl": url, "token": token, "courseId": course_id}
        )

    payload = collect_payload(root, "submission", None)
    for w in preflight_warnings(payload):
        print("submit: pre-flight warning: %s" % w, file=sys.stderr)
    # The manuscript is what a student most easily sends a stale copy of (a
    # Word file edited outside plans/). An unpinned manuscript with a newer
    # look-alike, or a pinned file that is gone, stops here: one more question
    # beats silently sending the wrong paper. A pinned file is the student's
    # explicit choice, so a newer look-alike only warns.
    manuscript = manuscript_check(root, payload)
    mw = manuscript_warning(manuscript)
    if mw and (manuscript["missing"] or (manuscript["path"] and not manuscript["pinned"])):
        die("not sent — " + mw)
    if mw:
        print("submit: manuscript check: %s" % mw, file=sys.stderr)

    inline_envelope = build_envelope(root, course_id, payload=payload)
    envelope = copy.deepcopy(inline_envelope)
    uploads = externalize_assets(envelope)
    # Stop before uploading anything: a body over the cap would only fail
    # at Vercel's edge after every figure went up.
    if _envelope_bytes(envelope) > ENVELOPE_HARD_CAP:
        die(oversize_message(envelope))
    try:
        upload_assets(url, token, envelope, uploads)
    except AssetsUnsupported:
        # An older classroom server: everything inline, as before.
        envelope = inline_envelope
        if _envelope_bytes(envelope) > ENVELOPE_HARD_CAP:
            die(
                "this classroom server does not accept separately uploaded "
                "files yet, and the submission is over its 4.5 MB limit — "
                "ask your instructor to update the server."
            )
    result = submit_envelope(url, token, envelope)
    board_path = write_receipt(root, inline_envelope, result, manuscript)
    print_receipt(payload, manuscript, board_path)
    print("Run /ait:check to see any instructor feedback.")
    open_receipt(board_path)
    sys.exit(0)


if __name__ == "__main__":
    main()
