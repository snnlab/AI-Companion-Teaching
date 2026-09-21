#!/usr/bin/env python3
"""papertrail: check for new instructor feedback on the classroom server.

Split out of submit.py (which used to check for comments as a side effect of
every submission) so submission and comment-checking are two separate,
independently runnable actions — /papertrail:submit sends, /papertrail:check
looks for feedback, either any time.

Fetches every comment across ALL of the student's own past submissions
(GET /api/my-comments, one call, server-side — never trusts local
bookkeeping alone for which submissions exist), then routes anything not
already seen through the SAME board-feedback document pipeline
board.py's --pull already uses for the single-project hosted board:
assemble_hosted_document -> inspect_feedback_document (prints a document
whose ```json board-feedback``` fence has "mode": "hosted" — the student's
own board.md step 5 routing then discusses/acts on it exactly like any other
collaborator feedback).

Anchored comments (a quote on a plan version, the tracker, or a results
report) are ALSO written as a `--seed-annotations` file so /papertrail:check
can reopen the local board with the instructor's comments painted in place,
at their original anchors — the student reads the instructor's exact words
in context, not a relayed summary. The text document above is still produced
for every comment and stays the authoritative, untrusted-DATA routing path;
the seed file is a viewing aid layered on top.

Stdlib only, Python 3.9+. Exit codes: 0 always (a comment-check failure is
never fatal to the surrounding session — same "fail open" spirit as
submit.py's own git_log_excerpt/fetch_comments); 1 only for a genuine usage
error (no classroom server configured yet).
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Feedback documents are routed to stdout and can contain any Unicode the
# instructor typed (em dashes, curly quotes, non-Latin scripts). On a console
# whose default encoding is not UTF-8 (e.g. cp949 on Korean Windows) a bare
# print() of that text raises UnicodeEncodeError and takes the command down.
# Force UTF-8 on the streams we print through, mirroring what PYTHONUTF8=1
# would do, so routing never crashes on the comment text.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
import classroom  # noqa: E402
from board import (  # noqa: E402
    find_root,
    group_comments,
    assemble_hosted_document,
    inspect_feedback_document,
    request_shutdown,
    _http_get_json,
)


def open_seed_board(root, seed_path, focus):
    """Open the local board, unconditionally, once there is any new instructor
    feedback — anchored comments (seed_path set) paint in place; unanchored
    ones (e.g. a decision-log/timeline note) still bring the board up so the
    student sees it, just without an in-place painting. Detached:
    /papertrail:check returns right away and the board runs on its own — it
    is a viewer here, the routing already happened via the board-feedback
    document(s) printed above. Set PAPERTRAIL_NO_BOARD=1 to skip (tests,
    headless runs)."""
    if os.environ.get("PAPERTRAIL_NO_BOARD"):
        return
    board_py = Path(__file__).resolve().parent / "board.py"
    # Release a board already holding plans/.board.lock so the reopen does
    # not fail with "another board is open".
    try:
        request_shutdown(root / "plans")
    except Exception:
        pass
    cmd = [sys.executable, str(board_py)]
    if seed_path:
        cmd += ["--seed-annotations", str(seed_path)]
    if focus:
        cmd += ["--focus", focus]
    kwargs = {"stdin": subprocess.DEVNULL,
              "stdout": subprocess.DEVNULL,
              "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0)
        )
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen(cmd, **kwargs)
        if seed_path:
            print("[papertrail:check] opening the board with the "
                  "instructor's comments painted in place…")
        else:
            print("[papertrail:check] opening the board…")
    except OSError as e:
        print("[papertrail:check] could not open the board (%s) — run "
              "/papertrail:board to see the comments." % e, file=sys.stderr)


def die(msg, code=1):
    print("check: %s" % msg, file=sys.stderr)
    sys.exit(code)


def fetch_my_comments(url, token):
    endpoint = url.rstrip("/") + "/api/my-comments"
    return _http_get_json(endpoint, {"Authorization": "Bearer %s" % token})


SEED_FILE_NAME = ".pt-seed-instructor.json"  # gitignored via board.py's GITIGNORE_LINES


def annotation_to_seed(comment):
    """Map one stored instructor comment to a board.py --seed-annotations item,
    or None when it has no anchorable quote (a general note — routed as text
    only). Mirrors board.md step 5's own comment->seed conversion; the scopes
    board.py's _valid_seed accepts are plan / master / results."""
    a = comment.get("annotation") or {}
    text = (a.get("comment") or "").strip()
    author = comment.get("author") or a.get("author") or "instructor"
    section = a.get("sectionHeading") or ""
    kind = a.get("type")
    quote = (a.get("quote") or "").strip()
    if not text:
        return None

    if kind == "plan-comment" and quote:
        return {
            "scope": "plan", "sectionHeading": section, "quote": quote,
            "comment": text, "author": author,
            "planPath": a.get("planPath") or "",
            "component": a.get("component") or "",
            "version": int(a.get("version") or 0),
            "isDraft": bool(a.get("isDraft")),
        }
    if kind == "doc-comment" and a.get("view") == "tracker" and quote:
        return {
            "scope": "master", "sectionHeading": section, "quote": quote,
            "comment": text, "author": author,
        }
    if kind == "result-comment":
        tgt = a.get("target") or {}
        q = quote or (tgt.get("quote") or "").strip()
        if not q:
            return None
        return {
            "scope": "results", "sectionHeading": section, "quote": q,
            "comment": text, "author": author,
            "component": a.get("component") or "",
            "resultsVersion": int(a.get("resultsVersion") or 0),
        }
    return None


def write_seed_file(root, seeds):
    """Write the seed array and return (path, focus) — focus is a component
    slug when every seed is a plan-scope comment on the same component (so
    /papertrail:check can open the board with --focus), else None."""
    path = root / "plans" / SEED_FILE_NAME
    path.write_text(json.dumps(seeds, indent=1), encoding="utf-8")
    comps = {s["component"] for s in seeds if s.get("scope") == "plan" and s.get("component")}
    focus = comps.pop() if len(comps) == 1 and all(
        s.get("scope") == "plan" for s in seeds
    ) else None
    return path, focus


def main():
    root = find_root()
    if not (root / "plans" / "master-plan.md").is_file():
        die("no plans/master-plan.md found — run /papertrail:init first")

    cfg = classroom.read_classroom_config(root)
    if not cfg or not cfg.get("serverUrl") or not cfg.get("token"):
        die(
            "no classroom server configured yet — run /papertrail:submit "
            "first, which saves the server URL and your personal token."
        )

    url = cfg["serverUrl"]
    token = cfg["token"]

    # Recover from a prior run that crashed after writing an inbox document
    # but before routing it — drain and route any leftovers before touching
    # the new fetch, same crash-safety shape as board.py's pull().
    inbox = classroom.comments_inbox_dir(root)
    if inbox.is_dir():
        for p in sorted(inbox.glob("*.txt")):
            inspect_feedback_document(root, p.read_text(encoding="utf-8", errors="replace"))
            p.unlink()

    try:
        data = fetch_my_comments(url, token)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            die("Token rejected. Ask your instructor for a fresh personal token.")
        die("Classroom server returned HTTP %s while checking for feedback." % e.code)
        return
    except (urllib.error.URLError, OSError):
        die(
            "Classroom server unreachable (it may be down, or the URL may "
            "be wrong). Check the URL with your instructor and try again."
        )
        return

    comments = data.get("comments", [])
    pulled = classroom.read_pulled_comment_ids(root)
    new = [c for c in comments if c.get("id") and c.get("id") not in pulled]
    if not new:
        print("No new instructor feedback.")
        # A stale seed file from an interrupted prior run is safe to clear.
        try:
            (root / "plans" / SEED_FILE_NAME).unlink()
        except OSError:
            pass
        return

    # Anchored comments -> a seed file the /papertrail:check command opens the
    # board with, so the student sees them in place. Written BEFORE the text
    # docs and the pulled-id mark, same crash-safety order as the inbox.
    seeds = [s for c in new if (s := annotation_to_seed(c)) is not None]
    seed_path = focus = None
    if seeds:
        seed_path, focus = write_seed_file(root, seeds)
        print("[papertrail:check] board-seeds: %s" % seed_path.as_posix())
        if focus:
            print("[papertrail:check] focus: %s" % focus)
        print(
            "[papertrail:check] %d of %d new comment(s) are anchored and will "
            "paint on the board; open it to read them in context." % (len(seeds), len(new))
        )
    else:
        try:
            (root / "plans" / SEED_FILE_NAME).unlink()
        except OSError:
            pass

    groups = group_comments(new)
    inbox.mkdir(parents=True, exist_ok=True)
    docs = []
    for (author, client_id), group in groups.items():
        meta = {
            "sessionId": client_id or author,
            "generatedAt": "",
            "focus": None,
            "reviewer": author,
            "shareHash": group[-1].get("shareHash"),
        }
        doc = assemble_hosted_document(
            [dict(c["annotation"], docHash=c.get("docHash")) for c in group],
            meta, root=root,
        )
        prefix = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in "%s-%s" % (author, client_id))[:40] or "group"
        fname = "%s-%d.txt" % (prefix, len(docs))
        inbox_path = inbox / fname
        inbox_path.write_text(doc, encoding="utf-8")  # inbox FIRST
        docs.append((inbox_path, doc))

    # Only after every document is safely on disk do we mark ids pulled.
    all_ids = pulled | {c["id"] for c in new}
    classroom.write_pulled_comment_ids(root, all_ids)

    for inbox_path, doc in docs:
        inspect_feedback_document(root, doc)  # route (prints)
        inbox_path.unlink()

    # Open the board unconditionally on any new feedback — anchored comments
    # (seed_path set above) paint in place; unanchored ones (e.g. a
    # decision-log/timeline note) still bring the board up.
    open_seed_board(root, seed_path, focus)


if __name__ == "__main__":
    main()
