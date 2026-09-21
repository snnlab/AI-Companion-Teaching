#!/usr/bin/env python3
"""aict: submit the project state to an instructor-hosted classroom server.

Builds a submission envelope (the same payload the board serves in "remote"/
"hosted" mode, plus a bounded git-log excerpt of plans/) and, on request,
POSTs it to a classroom server's /api/submissions endpoint with the
student's personal bearer token. Never runs silently — always preview with
--dry-run first (the /aict:submit command enforces this).

Stdlib only, Python 3.9+. Modes:
  --dry-run                    build the envelope, print a summary, no network call
  --url URL --token TOKEN      (first run) save the classroom config, then submit
                                (later runs: both optional, reuse the saved config)
  [--course COURSEID]          optional course identifier, saved with the config

Exit codes: 0 submitted (created or replay) / dry-run printed; 1 usage,
environment, or server-rejection error.
"""

import argparse
import datetime
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from signoff_gate import normalize_plan, parse_trailer  # noqa: E402
from board import (  # noqa: E402
    collect_payload,
    build_assets,
    share_hash,
    payload_files,
    find_root,
)
import classroom  # noqa: E402

ENVELOPE_SCHEMA_VERSION = 1
# Vercel's default serverless function request body limit — a soft warning
# only; the server's own 413 is the authoritative check.
SIZE_WARNING_BYTES = int(4.5 * 1024 * 1024)


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
            capture_output=True, text=True, cwd=str(root), timeout=10,
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
            capture_output=True, text=True, cwd=str(root), timeout=10,
        )
        if head.returncode != 0:
            return empty
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, cwd=str(root), timeout=10,
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
            capture_output=True, text=True, cwd=str(root), timeout=15,
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


def envelope_summary(envelope):
    payload = envelope["payload"]
    groups = payload["files"]["executionPlans"]
    n_components = len(groups)
    n_versions = sum(len(g.get("versions", [])) for g in groups)
    n_results = sum(len(g.get("results", [])) for g in groups)
    size_bytes = len(json.dumps(envelope, ensure_ascii=False).encode("utf-8"))
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


def print_dry_run(envelope, warnings):
    summary = envelope_summary(envelope)
    print("Submission envelope preview (dry run — no network call made)")
    print("  size: %d bytes (%.1f KB)" % (summary["sizeBytes"], summary["sizeBytes"] / 1024.0))
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
    if summary["sizeBytes"] > SIZE_WARNING_BYTES:
        print(
            "  WARNING: envelope exceeds ~4.5MB, Vercel's default serverless "
            "function request body limit — the real submission may be "
            "rejected with HTTP 413. Consider trimming large artifacts before "
            "submitting.",
            file=sys.stderr,
        )
    if warnings:
        print("  pre-flight warnings:")
        for w in warnings:
            print("    - %s" % w)


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


def submit_envelope(url, token, envelope):
    endpoint = url.rstrip("/") + "/api/submissions"
    body = json.dumps(envelope).encode("utf-8")
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
        return
    except (urllib.error.URLError, OSError):
        die(
            "Classroom server unreachable (the server may be down, or the "
            "URL may be wrong). Check the URL with your instructor and try "
            "again."
        )
        return
    _handle_response(code, data)


def _handle_response(code, data):
    if code == 201 and data.get("status") == "created":
        print("Submitted — new submission %s recorded." % data.get("submissionId", "?"))
        print_reverify(data.get("reverify", []))
        print("Run /aict:check to see any instructor feedback.")
        sys.exit(0)
    if code == 200 and data.get("status") == "replay":
        print(
            "Nothing new to send — identical content was already submitted "
            "(submission %s)." % data.get("submissionId", "?")
        )
        print_reverify(data.get("reverify", []))
        print("Run /aict:check to see any instructor feedback.")
        sys.exit(0)
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
    if code == 400 and data.get("error") == "malformed_envelope":
        die(
            "Server rejected the submission as malformed: %s"
            % data.get("detail", "no detail given")
        )
    die("Classroom server returned HTTP %s: %s" % (code, json.dumps(data)[:500]))


# --- CLI ---

def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="aict submit")
    ap.add_argument("--dry-run", action="store_true",
                     help="build the envelope and print a summary; no network call")
    ap.add_argument("--url", default=None, help="classroom server base URL")
    ap.add_argument("--token", default=None, help="personal bearer token from the instructor")
    ap.add_argument("--course", dest="course_id", default=None, metavar="COURSEID")
    return ap.parse_args(argv)


def main():
    args = parse_args()
    root = find_root()
    if not (root / "plans" / "master-plan.md").is_file():
        die("no plans/master-plan.md found — run /aict:init first")

    cfg = classroom.read_classroom_config(root)

    if args.dry_run:
        course_id = (
            args.course_id if args.course_id is not None
            else (cfg.get("courseId") if cfg else None)
        )
        payload = collect_payload(root, "submission", None)
        warnings = preflight_warnings(payload)
        envelope = build_envelope(root, course_id, payload=payload)
        print_dry_run(envelope, warnings)
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
            "band). Run /aict:submit, which walks you through this "
            "once and saves it locally."
        )

    if args.url or args.token or args.course_id is not None:
        classroom.write_classroom_config(
            root, {"serverUrl": url, "token": token, "courseId": course_id}
        )

    payload = collect_payload(root, "submission", None)
    for w in preflight_warnings(payload):
        print("submit: pre-flight warning: %s" % w, file=sys.stderr)

    envelope = build_envelope(root, course_id, payload=payload)
    submit_envelope(url, token, envelope)


if __name__ == "__main__":
    main()
