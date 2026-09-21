"""aict: shared client-side state for the instructor-hosted classroom
server, used by both submit.py (submission) and check.py (comment check).

Split out of submit.py so neither script has to import the other just to
reach the classroom config — both are peers of board.py, not of each other.
Stdlib only, Python 3.9+.
"""

import json
import os
from pathlib import Path

from board import plugin_data_dir, web_project_hash  # noqa: E402


def _classroom_data_dir():
    # Shares board.py's legacy-directory migration: a pre-rename install kept
    # the student's server URL and token under ~/.papertrail/classroom.
    return plugin_data_dir("classroom")


# --- Local classroom config (student's server URL + personal token) ---
# Mirrors board.py's read_web_config/write_web_config exactly, but under a
# separate "classroom" namespace so it never collides with the existing
# single-shared-password web-board config.

def classroom_config_path(root):
    return _classroom_data_dir() / ("%s.json" % web_project_hash(root))


def read_classroom_config(root):
    name = "%s.json" % web_project_hash(root)
    try:
        return json.loads((_classroom_data_dir() / name).read_text())
    except (OSError, ValueError):
        return None


def write_classroom_config(root, cfg):
    p = classroom_config_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg))
    os.chmod(p, 0o600)


# --- Locally remembered "pulled" instructor comment ids ---
# Comment ids are server-generated UUIDs, globally unique across every
# shareHash — a flat set is enough, no shareHash-keyed structure needed
# (unlike the old seen_comments.json this replaces). Mirrors board.py's own
# _pulled_path/_read_pulled shape for --pull, one file per project.

def pulled_comments_path(root):
    return _classroom_data_dir() / ("%s-comments-pulled.json" % web_project_hash(root))


def _legacy_seen_comments_path(root):
    # submit.py <= v0.3.0 checked for comments as a side effect of every
    # submission and remembered them here as {shareHash: [id, ...]}. That
    # code was split out into check.py + this module; migrate its state once
    # so a student who already used the old flow does not re-see old
    # comments on their first /aict:check.
    return _classroom_data_dir() / ("%s-seen-comments.json" % web_project_hash(root))


def read_pulled_comment_ids(root):
    try:
        return set(json.loads(pulled_comments_path(root).read_text()))
    except (OSError, ValueError):
        pass
    try:
        legacy = json.loads(_legacy_seen_comments_path(root).read_text())
    except (OSError, ValueError):
        return set()
    ids = set()
    for per_share in legacy.values():
        if isinstance(per_share, list):
            ids.update(i for i in per_share if isinstance(i, str))
    return ids


def write_pulled_comment_ids(root, ids):
    p = pulled_comments_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(sorted(ids)), encoding="utf-8")
    os.replace(tmp, p)


def comments_inbox_dir(root):
    return _classroom_data_dir() / ("%s-comments-inbox" % web_project_hash(root))
