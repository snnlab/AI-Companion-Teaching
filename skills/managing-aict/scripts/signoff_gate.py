#!/usr/bin/env python3
"""aict sign-off gate (PreToolUse hook for Write|Edit).

Blocks the write of a signed plan version (plans/execution/<slug>/vN.md in an
initialized project) until the student approves it on the board in their
browser. Also mechanically enforces version immutability (no edits to, or
overwrites of, an existing vN.md).

Contract: ALL decisions are exit 0 + PreToolUse decision JSON on stdout.
Exit 0 with no output = not gated (normal permission flow).
Escape hatch: AICT_NO_GATE=1. Wait ceiling: AICT_GATE_TIMEOUT
(seconds, clamped to [30, 1500]; default 1500 — always below the 1800s hook
timeout in hooks.json, because timeout-exceeded hook behavior is undocumented).

Stdlib only, Python 3.9+.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

VERSION_RE = re.compile(r"^v(\d+)\.md$")
RESULTS_RE = re.compile(r"/plans/execution/([^/]+)/results/(r\d+)/")
# Content markers that gate find_project_root. NEVER drop these — find_project_root
# fails OPEN, so an unrecognized marker silently disables every gate that rides it.
MASTER_MARKERS = (
    "<!-- aict:master-plan -->",
)
CLAUDE_MARKERS = (
    "<!-- aict:start -->",
)
TICKET_PREFIX = ".aict-approved-"

# Markers from the pre-AICT "papertrail" name. A project carrying ONLY these
# predates the rename, so none of its gates are active. find_project_root must
# NOT treat that as "not an AICT project" — that is the fail-open path this
# file warns about above. It returns LEGACY instead and every call site denies
# loudly, so a student repo can never run ungated without saying so.
LEGACY_MASTER_MARKERS = (
    "<!-- papertrail:master-plan -->",
)
LEGACY_CLAUDE_MARKERS = (
    "<!-- papertrail:start -->",
)
LEGACY = object()
LEGACY_DENY_REASON = (
    "This project carries the pre-AICT papertrail markers, so its integrity "
    "gates (sign-off, results immutability, archived-plan immutability) are "
    "NOT active on it. AICT ships no migration for pre-rename projects: "
    "either start fresh with /aict:init in a new project, or replace the "
    "papertrail markers with the aict ones by hand first "
    "(<!-- aict:master-plan --> on line 1 of plans/master-plan.md, and the "
    "<!-- aict:start --> / <!-- aict:end --> pair in CLAUDE.md). Refusing "
    "rather than letting the write through ungated."
)
ORDER_FENCE_RE = re.compile(r"```json board-feedback\n(.*?)\n```", re.DOTALL)
DEFAULT_TIMEOUT = 1500
MAX_REASON = 2000


def normalize_plan(text):
    """Canonical plan text for hashing, invariant to the sign-off trailer.

    A `.draft-vN.md` is unsigned; the final `vN.md` gets a `Signed off:` line (and
    a `---` rule) appended at write time. Stripping that trailer plus trailing
    whitespace makes normalize(draft) == normalize(signed), so a sign-session
    ticket hashed over the draft authorizes the signed write. Board and gate MUST
    use this same function."""
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    if lines and lines[-1].startswith("Signed off:"):
        lines.pop()
        while lines and lines[-1] == "":
            lines.pop()
        if lines and lines[-1] == "---":
            lines.pop()
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines) + "\n"


TRAILER_SIGNED_RE = re.compile(r"^Signed off: .+$")
TRAILER_AMEND_RE = re.compile(r"^Amendment recorded, \d{4}-\d{2}-\d{2}$")


def parse_trailer(text):
    """One strict trailer grammar (spec §3 rule 3), shared by the hook, board.py,
    and — mirrored line-for-line in board/src/lib/trailer.ts — the board UI.
    The LAST non-empty line may be exactly one canonical trailer; NO other line
    (stripped, code fences included) may match either pattern. Reject, not ignore."""
    lines = text.splitlines()
    idx = len(lines) - 1
    while idx >= 0 and not lines[idx].strip():
        idx -= 1
    final = lines[idx].strip() if idx >= 0 else ""
    kind = "none"
    if TRAILER_SIGNED_RE.match(final):
        kind = "signed"
    elif TRAILER_AMEND_RE.match(final):
        kind = "amendment"
    violations = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if i == idx and kind != "none":
            continue
        if TRAILER_SIGNED_RE.match(s) or TRAILER_AMEND_RE.match(s):
            violations.append("line %d: %s" % (i + 1, s))
    if violations:
        return {"kind": "malformed", "line": final if kind != "none" else None,
                "violations": violations}
    return {"kind": kind, "line": final if kind != "none" else None, "violations": []}


def strip_trailer(text):
    """Remove exactly one canonical final trailer (plus an optional immediately
    preceding --- separator and trailing blanks). Unchanged for none/malformed."""
    tr = parse_trailer(text)
    if tr["kind"] not in ("signed", "amendment"):
        return text
    lines = text.splitlines()
    idx = len(lines) - 1
    while idx >= 0 and not lines[idx].strip():
        idx -= 1
    del lines[idx:]
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and lines[-1].strip() == "---":
        lines.pop()
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines) + "\n"


def check_ticket(ticket, slug, version, content):
    """Validate a sign-session approval ticket for a new vN.md write. Returns
    (decision, reason). Never opens an interactive sign session — a present-but-invalid
    ticket fast-denies with a precise fix, so a bulk write loop cannot silently
    pop an unattended browser gate."""
    try:
        doc = json.loads(ticket.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "deny", (
            "Approval ticket %s is unreadable or corrupt. Run "
            "/aict:sign %s to replace it with a fresh ticket "
            "(the draft must still exist at plans/execution/%s/"
            ".draft-v%d.md)." % (ticket.name, slug, slug, version))
    if doc.get("slug") != slug or doc.get("version") != version:
        return "deny", (
            "Sign ticket %s does not match %s v%d (slug/version mismatch). "
            "Run /aict:sign %s to sign this plan again."
            % (ticket.name, slug, version, slug))
    exp = doc.get("expiry")
    if isinstance(exp, (int, float)) and time.time() > exp:
        return "deny", (
            "Approval for %s v%d has expired. Run /aict:sign %s to "
            "sign the current draft again." % (slug, version, slug))
    action_id = doc.get("orderActionId")
    if isinstance(action_id, str):
        pending = ticket.parent.parent / ".board-feedback.md"
        try:
            matches = ORDER_FENCE_RE.findall(pending.read_text(encoding="utf-8"))
            meta = json.loads(matches[-1]) if matches else None
        except (OSError, ValueError):
            meta = None
        if not isinstance(meta, dict) or meta.get("actionId") != action_id:
            return "deny", (
                "Approval ticket %s is not bound to the current pending board "
                "order. Collect and acknowledge any existing order, then run "
                "/aict:sign %s to sign v%d again."
                % (ticket.name, slug, version))
    got = hashlib.sha256(normalize_plan(content).encode("utf-8")).hexdigest()
    if doc.get("contentHash") != got:
        return "deny", (
            "The draft for %s v%d changed since it was approved (content-hash "
            "mismatch). Run /aict:sign %s to sign the current draft "
            "again." % (slug, version, slug))
    return "allow", (
        "Sign-session approved: %s v%d approved by %s in session %s at %s "
        "(ticket %s; left "
        "in place — inert once v%d.md exists)." % (
            slug, version, doc.get("approver", "student"), doc.get("batchId", "?"),
            doc.get("approvedAt", "?"), ticket.name, version))


def decide(decision, reason):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


def allow(reason):
    decide("allow", reason)


def deny(reason):
    decide("deny", reason)


def _env(name, default=""):
    """Read AICT_<name>."""
    v = os.environ.get("AICT_" + name)
    return default if v is None else v


def gate_timeout():
    raw = os.environ.get("AICT_GATE_TIMEOUT")
    if raw is not None:
        try:
            val = int(raw)
            return max(30, min(val, DEFAULT_TIMEOUT))
        except ValueError:
            pass
    return DEFAULT_TIMEOUT


def find_project_root(path):
    """Walk up from the target file looking for the dual opt-in markers."""
    for parent in path.parents:
        mp = parent / "plans" / "master-plan.md"
        if mp.is_file():
            try:
                text = mp.read_text(encoding="utf-8", errors="replace")
                if not any(mk in text for mk in MASTER_MARKERS):
                    if any(mk in text for mk in LEGACY_MASTER_MARKERS):
                        return LEGACY
                    return None
                cm = parent / "CLAUDE.md"
                if cm.is_file():
                    ctext = cm.read_text(encoding="utf-8", errors="replace")
                    if any(mk in ctext for mk in CLAUDE_MARKERS):
                        return parent
                    if any(mk in ctext for mk in LEGACY_CLAUDE_MARKERS):
                        return LEGACY
            except OSError:
                return None
            return None
    return None


def resolve_root(path):
    """find_project_root, but a legacy-marker project denies instead of
    slipping through as 'not an AICT project'."""
    root = find_project_root(path)
    if root is LEGACY:
        deny(LEGACY_DENY_REASON)  # never returns
    return root


def main():
    raw = sys.stdin.read()
    try:
        event = json.loads(raw)
        tool_name = event.get("tool_name", "")
        tool_input = event.get("tool_input") or {}
        file_path = tool_input.get("file_path", "")
        cwd = event.get("cwd") or os.getcwd()
    except Exception:
        if "/plans/execution/" in raw.replace("\\\\", "/").replace("\\", "/"):
            print(
                "aict gate: unparseable hook payload, write not gated",
                file=sys.stderr,
            )
        sys.exit(0)

    if tool_name not in ("Write", "Edit") or not file_path:
        sys.exit(0)

    p = Path(file_path)
    if not p.is_absolute():
        p = Path(cwd) / p
    p = Path(os.path.realpath(str(p)))
    # Match path-shape regexes against a forward-slash rendering so they work
    # on Windows too (str(WindowsPath) uses backslashes; RESULTS_RE and the
    # bundle-dir slice below are written with "/"). as_posix() keeps the drive
    # letter, which Path() round-trips fine.
    p_posix = p.as_posix()

    # ---- Results-bundle immutability (synchronous file policy; NEVER opens
    # the board — a browser gate here would deadlock capture). ----
    res_m = RESULTS_RE.search(p_posix)
    if res_m:
        if _env("NO_GATE", "") == "1":
            print(
                "aict: results immutability bypassed by "
                "AICT_NO_GATE for %s" % p.name,
                file=sys.stderr,
            )
            sys.exit(0)
        if resolve_root(p) is None:
            sys.exit(0)
        bundle_dir = Path(p_posix[: res_m.end()].rstrip("/"))
        if p.name == "verdict.json" and p.parent == bundle_dir:
            if tool_name == "Write" and not p.exists():
                allow(
                    "One-time verdict for %s %s. Prefer results.py verdict "
                    "(it stamps date and reviewer)." % (res_m.group(1), res_m.group(2))
                )
            deny(
                "verdict.json is written once and never edited. The verdict for "
                "%s %s is already recorded; a redo is a NEW bundle (results.py "
                "stage/finalize), not an edit." % (res_m.group(1), res_m.group(2))
            )
        if bundle_dir.is_dir():
            deny(
                "Finalized results bundles are immutable — %s %s already exists. "
                "Capture a new bundle instead: results.py stage --component %s, "
                "copy artifacts, write manifest.json and report.md in the staging "
                "dir, then results.py finalize."
                % (res_m.group(1), res_m.group(2), res_m.group(1))
            )
        deny(
            "Results bundles are created by results.py finalize (staging, "
            "validation, atomic rename), never by direct writes into %s. Use "
            "results.py stage --component %s and write into the .staging-* dir."
            % (res_m.group(2), res_m.group(1))
        )

    # ---- Archived master plans are immutable (the renewal record). Pure file
    # policy like the results branch — never opens a browser. Creation (the
    # renewal's own archive write) is allowed; edits and overwrites are denied. ----
    if p.parent.name == "archive" and p.parent.parent.name == "plans":
        if _env("NO_GATE", "") == "1":
            print(
                "aict: archive immutability bypassed by "
                "AICT_NO_GATE for %s" % p.name,
                file=sys.stderr,
            )
            sys.exit(0)
        if resolve_root(p) is None:
            sys.exit(0)
        if tool_name == "Edit" or p.exists():
            deny(
                "Archived master plans are immutable — %s is the record of a "
                "direction this project renewed away from. /aict:renew "
                "creates archives; nothing edits them." % p.name
            )
        sys.exit(0)

    # ---- Sign-session ticket forgery guard. Tickets (.aict-approved-*) are
    # written ONLY by board.py --sign (a subprocess, outside the agent's
    # Write/Edit tools). A direct agent write here would forge sign-off — deny it
    # inside the gate's own enforcement domain. ----
    if (
        p.name.startswith(TICKET_PREFIX)
        and p.parent.name == "execution"
        and p.parent.parent.name == "plans"
    ):
        if resolve_root(p) is not None:
            deny(
                "Sign-session approval tickets (%s*) are created only by "
                "board.py --sign, never written directly. Run "
                "/aict:sign; the ticket is written for you."
                % TICKET_PREFIX
            )
        sys.exit(0)

    m = VERSION_RE.fullmatch(p.name)
    if (
        m is None
        or p.parent.parent.name != "execution"
        or p.parent.parent.parent.name != "plans"
    ):
        sys.exit(0)
    version = int(m.group(1))
    slug = p.parent.name

    if _env("NO_GATE", "") == "1":
        print(
            "aict: sign-off gate bypassed by AICT_NO_GATE for %s"
            % p.name,
            file=sys.stderr,
        )
        sys.exit(0)

    root = resolve_root(p)
    if root is None:
        sys.exit(0)

    # Mechanical immutability: never edit a signed version; never overwrite one.
    if tool_name == "Edit" or (tool_name == "Write" and p.exists()):
        deny(
            "Signed plan versions are immutable — %s already exists. A revision "
            "is a new version: write v%d.md with a 'Supersedes: v%d — <trigger and "
            "change>' line (the amendment record). Never edit or overwrite a "
            "signed version." % (p.name, version + 1, version)
        )

    # The gate: Write to a NEW vN.md.
    content = tool_input.get("file_text")
    if content is None:
        content = tool_input.get("content")
    if content is None:
        deny(
            "Sign-off gate could not read the proposed plan content from the "
            "Write payload. Re-attempt the write; if this persists, set "
            "AICT_NO_GATE=1 and report the issue."
        )

    tr = parse_trailer(content)
    if tr["kind"] == "malformed":
        deny(
            "Plan trailer grammar violation for %s: 'Signed off:' / 'Amendment "
            "recorded,' lines may appear ONLY as the single final trailer. "
            "Offending — %s. Remove the interior line(s) and re-attempt."
            % (p.name, "; ".join(tr["violations"]))
        )
    if tr["kind"] == "amendment":
        prev = p.parent / ("v%d.md" % (version - 1))
        if version < 2 or not prev.exists():
            deny(
                "Amendment versions record revisions of an existing plan — "
                "v%d.md does not exist. A first or gap version needs a human "
                "sign-off: run /aict:sign %s." % (version - 1, slug)
            )
        allow(
            "Amendment recorded for %s v%d — ungated revision write. No "
            "human-approval claim is made; the board badges it 'amended'."
            % (slug, version)
        )

    # ---- Sign-session ticket: if the student approved this exact plan in a
    # prior sign session, the ticket authorizes the write without
    # reopening the browser. A present-but-invalid ticket fast-denies (never
    # opens the interactive gate); an absent ticket falls through to it. ----
    ticket = p.parent.parent / ("%s%s-v%d" % (TICKET_PREFIX, slug, version))
    if ticket.exists():
        decision, reason = check_ticket(ticket, slug, version, content)
        if decision == "allow":
            allow(reason)  # H3: leave the ticket; immutability blocks any re-use
        deny(reason)

    timeout = gate_timeout()
    gate_file = p.parent / (".gate-v%d.md" % version)
    nonce = uuid.uuid4().hex[:12]
    header = "<!-- gate %s -->\n" % json.dumps(
        {"pid": os.getpid(), "nonce": nonce, "ts": time.time()}
    )

    # O_EXCL reservation; stale (older than the gate timeout) files are taken over.
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(gate_file), os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(header + content)
    except FileExistsError:
        try:
            age = time.time() - gate_file.stat().st_mtime
        except OSError:
            age = 0
        if age < timeout:
            deny(
                "Another sign-off for %s v%d is already in progress (a gate "
                "opened %ds ago). Wait for it to finish, then re-attempt the "
                "write." % (slug, version, int(age))
            )
        gate_file.write_text(header + content, encoding="utf-8")

    board = Path(__file__).resolve().parent / "board.py"
    try:
        proc = subprocess.run(
            [
                sys.executable,
                str(board),
                "--gate",
                "%s/v%d" % (slug, version),
                "--timeout",
                str(timeout),
            ],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout + 60,
        )
        code = proc.returncode
        out = (proc.stdout or "").strip()
        err = (proc.stderr or "").strip()
    except subprocess.TimeoutExpired:
        code, out, err = 2, "", "board process exceeded its own timeout"
    finally:
        # Owner-verified cleanup: only remove a reservation this process made.
        try:
            first = gate_file.read_text(encoding="utf-8").split("\n", 1)[0]
            if nonce in first:
                gate_file.unlink()
        except OSError:
            pass

    if code == 0:
        if p.exists():
            deny(
                "%s was created while the sign-off gate was open — that approval "
                "no longer applies. Write v%d.md instead (with a Supersedes "
                "line)." % (p.name, version + 1)
            )
        allow(
            "Researcher approved %s v%d in the sign session. %s"
            % (slug, version, out.splitlines()[-1] if out else "")
        )
    elif code == 3:
        summary = out.strip()
        if len(summary) > MAX_REASON:
            summary = summary[:MAX_REASON] + "\n[...truncated...]"
        deny(
            "SIGN-OFF NOT APPROVED. The student reviewed %s v%d in the sign session "
            "and requests changes:\n\n%s\n\nFull feedback is saved at "
            "plans/.board-feedback.md — read it before revising. Revise the "
            "draft to address ALL feedback, then attempt the SAME Write again — "
            "the gate will reopen. Do not write the file via shell redirection "
            "or any other path." % (slug, version, summary)
        )
    elif code == 2:
        # Persist the proposal as the component's working draft so a timed-out
        # gate leaves a durable recovery path for the next sign session.
        draft = p.parent / (".draft-v%d.md" % version)
        saved = ""
        try:
            draft.write_text(strip_trailer(content), encoding="utf-8")
            saved = (" The proposed plan has been saved as "
                     "plans/execution/%s/.draft-v%d.md." % (slug, version))
        except OSError:
            pass
        deny(
            "Sign-off gate timed out — no approval arrived within %ds.%s "
            "Do NOT bypass the gate. Run /aict:sign %s to reopen a "
            "sign session for the saved draft; its durable ticket then admits "
            "the v%d.md write." % (timeout, saved, slug, version)
        )
    else:
        deny(
            "Sign-off gate could not open the sign session (%s). Run "
            "/aict:sign %s, then attempt the write again."
            % (err.splitlines()[-1] if err else "exit %d" % code, slug)
        )


if __name__ == "__main__":
    main()
