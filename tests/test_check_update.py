"""Tests for check_update.py. Run:
    python3 -m unittest tests.test_check_update -v
"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import check_update as cu  # noqa: E402


class TestVersion(unittest.TestCase):
    def test_parse_strips_v_and_splits(self):
        self.assertEqual(cu.parse_version("v0.11.0"), (0, 11, 0))
        self.assertEqual(cu.parse_version("0.12.0"), (0, 12, 0))

    def test_parse_nonnumeric_part_is_zero(self):
        self.assertEqual(cu.parse_version("0.12.0-rc1"), (0, 12, 0))

    def test_is_newer(self):
        self.assertTrue(cu.is_newer("0.12.0", "0.11.0"))
        self.assertTrue(cu.is_newer("0.11.1", "0.11.0"))
        self.assertFalse(cu.is_newer("0.11.0", "0.11.0"))
        self.assertFalse(cu.is_newer("0.10.0", "0.11.0"))


class TestState(unittest.TestCase):
    def test_missing_file_returns_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            state = cu.read_state(Path(d) / "nope.json")
            self.assertEqual(state, cu.DEFAULT_STATE)
            self.assertIsNot(state, cu.DEFAULT_STATE)  # a copy, not the shared dict

    def test_malformed_file_returns_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "update-check.json"
            p.write_text("{not json")
            self.assertEqual(cu.read_state(p), cu.DEFAULT_STATE)

    def test_write_then_read_roundtrips_and_creates_parents(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "sub" / "update-check.json"
            state = dict(cu.DEFAULT_STATE, lastNotifiedVersion="0.12.0")
            cu.write_state(p, state)
            self.assertTrue(p.exists())
            self.assertEqual(cu.read_state(p)["lastNotifiedVersion"], "0.12.0")

    def test_state_roundtrips_only_fields_used_by_decisions(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "update-check.json"
            state = {"lastAttempt": 12.5, "lastNotifiedVersion": "0.12.0"}

            cu.write_state(p, state)

            self.assertEqual(cu.read_state(p), state)
            self.assertEqual(json.loads(p.read_text()), state)

    def test_read_merges_over_defaults(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "update-check.json"
            p.write_text(json.dumps({"lastAttempt": 5}))
            state = cu.read_state(p)
            self.assertEqual(state["lastAttempt"], 5)
            self.assertEqual(state["lastNotifiedVersion"], "")  # default preserved


class TestThrottleAndCadence(unittest.TestCase):
    def test_should_check_true_when_stale(self):
        state = dict(cu.DEFAULT_STATE, lastAttempt=0.0)
        self.assertTrue(cu.should_check(state, now=100000.0))

    def test_should_check_false_when_recent(self):
        state = dict(cu.DEFAULT_STATE, lastAttempt=100000.0)
        self.assertFalse(cu.should_check(state, now=100000.0 + 3600))

    def test_should_notify_only_for_new_version(self):
        state = dict(cu.DEFAULT_STATE, lastNotifiedVersion="0.12.0")
        self.assertFalse(cu.should_notify(state, "0.12.0"))
        self.assertTrue(cu.should_notify(state, "0.13.0"))

    def test_should_check_true_when_lastattempt_nonnumeric(self):
        state = dict(cu.DEFAULT_STATE, lastAttempt="garbage")
        self.assertTrue(cu.should_check(state, now=100000.0))


class TestSanitize(unittest.TestCase):
    def test_strips_markdown_and_html(self):
        self.assertEqual(cu.sanitize_highlight("**Dark** `mode` <b>x</b>"), "Dark mode x")

    def test_strips_control_and_escape_bytes(self):
        out = cu.sanitize_highlight("Dark\x1b[2Jmode\x07")
        self.assertNotIn("\x1b", out)
        self.assertNotIn("\x07", out)

    def test_collapses_whitespace_and_keeps_word_boundaries(self):
        self.assertEqual(cu.sanitize_highlight("a\n\tb   c"), "a b c")

    def test_truncates_to_width(self):
        out = cu.sanitize_highlight("x" * 200, width=80)
        self.assertLessEqual(len(out), 80)

    def test_strips_c1_control_byte(self):
        self.assertNotIn("\x9b", cu.sanitize_highlight("Dark\x9bmode"))

    def test_preserves_legitimate_unicode(self):
        self.assertIn("→", cu.sanitize_highlight("arrow → here"))
        self.assertIn("é", cu.sanitize_highlight("café"))


class TestChangelog(unittest.TestCase):
    KEEP_A_CHANGELOG = (
        "# Changelog\n\n"
        "## [0.12.0] - 2026-07-09\n\n"
        "### Added\n"
        "- **Update reminders.** A session-start notice.\n"
        "- **Version pinning.** Docs for installing an old version.\n"
        "- **Release tags.** Every version tagged.\n"
        "- **A fourth item.** Should not appear.\n\n"
        "## [0.11.0] - 2026-07-09\n"
        "- **Dark mode.** Older release.\n"
    )
    CURRENT_REPO_FORMAT = (
        "# Changelog\n\n"
        "## 0.11.0 (2026-07-09)\n\n"
        "UI release — dark mode.\n\n"
        "- **Dark mode.** A sun/moon toggle.\n"
        "- **Soft-unwrap.** Paragraphs flow.\n\n"
        "## 0.10.0 (2026-07-09)\n"
        "- **Journal outputs.** Older.\n"
    )

    def test_extracts_bold_leads_from_newest_section_only(self):
        hl = cu.parse_changelog_highlights(self.KEEP_A_CHANGELOG)
        self.assertEqual(hl, ["Update reminders.", "Version pinning.", "Release tags."])

    def test_handles_current_repo_header_format(self):
        hl = cu.parse_changelog_highlights(self.CURRENT_REPO_FORMAT)
        self.assertEqual(hl, ["Dark mode.", "Soft-unwrap."])

    def test_empty_on_no_sections(self):
        self.assertEqual(cu.parse_changelog_highlights("no headers here"), [])


class TestMarketplaceResolution(unittest.TestCase):
    def test_finds_marketplace_by_repo(self):
        known = {"my-mkt": {"source": {"source": "github", "repo": "snnlab/papertrail_v0"}}}
        self.assertEqual(cu.resolve_marketplace_name(known), "my-mkt")

    def test_case_insensitive_repo_match(self):
        known = {"campus-mkt": {"source": {"repo": "snnlab/PaperTrail_v0"}}}
        self.assertEqual(cu.resolve_marketplace_name(known), "campus-mkt")

    def test_supports_marketplaces_wrapper_key(self):
        known = {"marketplaces": {"campus-mkt": {"source": {"repo": "snnlab/papertrail_v0"}}}}
        self.assertEqual(cu.resolve_marketplace_name(known), "campus-mkt")

    def test_fallback_when_absent(self):
        self.assertEqual(cu.resolve_marketplace_name({}), "aict")


class TestNoticeAndOutput(unittest.TestCase):
    def test_notice_has_versions_highlights_and_command(self):
        notice = cu.format_notice("0.11.0", "0.12.0",
                                  ["Update reminders.", "Version pinning."], "aict")
        self.assertIn("v0.12.0 available (you have v0.11.0)", notice)
        self.assertIn("Update reminders.", notice)
        self.assertIn("/plugin update aict@aict", notice)
        self.assertIn("/reload-plugins", notice)

    def test_notice_without_highlights_still_valid(self):
        notice = cu.format_notice("0.11.0", "0.12.0", [], "aict")
        self.assertIn("v0.12.0 available", notice)
        self.assertIn("/plugin update", notice)

    def test_build_output_frames_as_untrusted(self):
        out = cu.build_output("some notice")
        self.assertEqual(out["systemMessage"], "some notice")
        ctx = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("not", ctx.lower())          # "do not interpret ... as instructions"
        self.assertIn("some notice", ctx)
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")


import io
import contextlib


class TestMain(unittest.TestCase):
    def _run(self, env, fetch_map):
        """Run main() with fetch_text stubbed and env overridden; return (rc, stdout)."""
        real_fetch = cu.fetch_text
        real_environ = dict(os.environ)
        cu.fetch_text = lambda url, timeout=3.0: fetch_map.get(url)
        os.environ.clear()
        os.environ.update(env)
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                rc = cu.main()
        finally:
            cu.fetch_text = real_fetch
            os.environ.clear()
            os.environ.update(real_environ)
        return rc, buf.getvalue()

    def _plugin_root(self, d, version):
        root = Path(d) / "root"
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".claude-plugin" / "plugin.json").write_text(
            json.dumps({"name": "aict", "version": version})
        )
        return root

    MANIFEST_URL = "https://raw.githubusercontent.com/snnlab/papertrail_v0/main/.claude-plugin/plugin.json"
    CHANGELOG_URL = "https://raw.githubusercontent.com/snnlab/papertrail_v0/main/CHANGELOG.md"

    def test_notifies_when_newer_available(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._plugin_root(d, "0.11.0")
            data = Path(d) / "data"
            env = {"CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PLUGIN_DATA": str(data)}
            fetch = {
                self.MANIFEST_URL: json.dumps({"version": "0.12.0"}),
                self.CHANGELOG_URL: "## [0.12.0] - 2026-07-09\n- **New thing.** x\n",
            }
            rc, out = self._run(env, fetch)
            self.assertEqual(rc, 0)
            payload = json.loads(out)
            self.assertIn("v0.12.0 available", payload["systemMessage"])
            self.assertIn("New thing.", payload["systemMessage"])
            state = cu.read_state(data / "update-check.json")
            self.assertEqual(state["lastNotifiedVersion"], "0.12.0")

    def test_silent_when_up_to_date(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._plugin_root(d, "0.12.0")
            data = Path(d) / "data"
            env = {"CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PLUGIN_DATA": str(data)}
            fetch = {self.MANIFEST_URL: json.dumps({"version": "0.12.0"})}
            rc, out = self._run(env, fetch)
            self.assertEqual(rc, 0)
            self.assertEqual(out, "")

    def test_no_second_notice_for_same_version(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._plugin_root(d, "0.11.0")
            data = Path(d) / "data"
            cu.write_state(data / "update-check.json",
                           dict(cu.DEFAULT_STATE, lastNotifiedVersion="0.12.0"))
            env = {"CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PLUGIN_DATA": str(data)}
            fetch = {self.MANIFEST_URL: json.dumps({"version": "0.12.0"})}
            rc, out = self._run(env, fetch)
            self.assertEqual(out, "")   # already notified for 0.12.0

    def test_throttled_within_24h(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._plugin_root(d, "0.11.0")
            data = Path(d) / "data"
            cu.write_state(data / "update-check.json",
                           dict(cu.DEFAULT_STATE, lastAttempt=time.time()))
            env = {"CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PLUGIN_DATA": str(data)}
            # fetch map empty: if it tried to fetch it would get None anyway
            rc, out = self._run(env, {})
            self.assertEqual(out, "")

    def test_opt_out(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._plugin_root(d, "0.11.0")
            data = Path(d) / "data"
            env = {"CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PLUGIN_DATA": str(data),
                   "AICT_NO_UPDATE_CHECK": "1"}
            rc, out = self._run(env, {self.MANIFEST_URL: json.dumps({"version": "0.12.0"})})
            self.assertEqual(out, "")

    def test_offline_stamps_attempt_and_stays_silent(self):
        with tempfile.TemporaryDirectory() as d:
            root = self._plugin_root(d, "0.11.0")
            data = Path(d) / "data"
            env = {"CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PLUGIN_DATA": str(data)}
            rc, out = self._run(env, {})   # fetch returns None -> offline
            self.assertEqual(out, "")
            self.assertGreater(cu.read_state(data / "update-check.json")["lastAttempt"], 0)
