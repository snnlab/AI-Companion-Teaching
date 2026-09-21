"""Tests for models.py. Run:
    python3 -m unittest tests.test_models -v
"""
import contextlib
import hashlib
import io
import re
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = (
    Path(__file__).resolve().parents[1]
    / "skills" / "managing-aict" / "scripts"
)
sys.path.insert(0, str(SCRIPTS))
import models  # noqa: E402

TEMPLATES = SCRIPTS.parent / "templates"
DEFAULT_PROFILE = (TEMPLATES / "model-profile.md").read_text(encoding="utf-8")


def make_project(tmp, profile=DEFAULT_PROFILE):
    root = Path(tmp)
    (root / "plans").mkdir(parents=True, exist_ok=True)
    (root / "plans" / "master-plan.md").write_text("<!-- aict:master-plan -->\n")
    if profile is not None:
        (root / "plans" / "model-profile.md").write_text(profile, encoding="utf-8")
    return root


class TestParseProfile(unittest.TestCase):
    def test_default_template_parses_all_six_stages(self):
        stages, warnings = models.parse_profile(DEFAULT_PROFILE)
        self.assertEqual(warnings, [])
        self.assertEqual(
            set(stages),
            {"plan", "execute", "sync", "plan-review", "results-validation", "board-reviewer"},
        )
        self.assertEqual(
            stages["plan"],
            {"stage": "plan", "model": "opus", "effort": "max", "mechanism": "nudge"},
        )
        self.assertEqual(
            stages["execute"],
            {"stage": "execute", "model": "sonnet", "effort": None, "mechanism": "nudge"},
        )
        self.assertEqual(stages["sync"]["model"], "inherit")
        self.assertEqual(stages["plan-review"], {"stage": "plan-review", "model": "opus", "effort": "medium", "mechanism": "agent"})
        self.assertEqual(stages["results-validation"]["effort"], "low")
        self.assertEqual(stages["board-reviewer"]["mechanism"], "agent")

    def test_stage_label_parenthetical_and_case_insensitive(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| Plan (whatever text) | opus | max | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertIn("plan", stages)
        self.assertEqual(warnings, [])

    def test_full_model_id_accepted(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | claude-sonnet-5 | — | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages["sync"]["model"], "claude-sonnet-5")
        self.assertEqual(warnings, [])

    def test_unknown_stage_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| deploy | opus | max | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertEqual(len(warnings), 1)
        self.assertIn("unknown stage", warnings[0])

    def test_unknown_model_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | gpt-5.5 | — | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("unknown model", warnings[0])

    def test_unknown_effort_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | turbo | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("unknown effort", warnings[0])

    def test_unknown_mechanism_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | — | pinned |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("unknown mechanism", warnings[0])

    def test_duplicate_stage_first_wins_later_warned(self):
        text = (
            "| stage | model | effort | mechanism |\n|---|---|---|---|\n"
            "| sync | opus | — | nudge |\n| sync | sonnet | — | nudge |\n"
        )
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages["sync"]["model"], "opus")
        self.assertIn("duplicate stage", warnings[0])

    def test_wrong_cell_count_warned_and_skipped(self):
        text = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | nudge |\n"
        stages, warnings = models.parse_profile(text)
        self.assertEqual(stages, {})
        self.assertIn("4 cells", warnings[0])

    def test_no_table_at_all_warns(self):
        stages, warnings = models.parse_profile("# nothing here\n\njust prose\n")
        self.assertEqual(stages, {})
        self.assertEqual(len(warnings), 1)

    def test_effort_variants_mean_unset(self):
        for dash in ("—", "-", "–", ""):
            text = f"| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | {dash} | nudge |\n"
            stages, warnings = models.parse_profile(text)
            self.assertIsNone(stages["sync"]["effort"], repr(dash))
            self.assertEqual(warnings, [])

    def test_all_effort_levels_accepted(self):
        for level in ("low", "medium", "high", "xhigh", "max"):
            text = f"| stage | model | effort | mechanism |\n|---|---|---|---|\n| sync | opus | {level} | nudge |\n"
            stages, _ = models.parse_profile(text)
            self.assertEqual(stages["sync"]["effort"], level)


class TestStageCommand(unittest.TestCase):
    def _run(self, root, key):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), "stage", key])
        return code, out.getvalue(), err.getvalue()

    def test_no_profile_is_total_silence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            code, out, err = self._run(root, "plan")
            self.assertEqual((code, out, err), (0, "", ""))

    def test_valid_row_prints_json(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            code, out, err = self._run(root, "plan")
            self.assertEqual(code, 0)
            self.assertEqual(err, "")
            self.assertEqual(
                json.loads(out),
                {"stage": "plan", "model": "opus", "effort": "max", "mechanism": "nudge"},
            )

    def test_malformed_target_row_empty_stdout_warning_on_stderr(self):
        bad = "| stage | model | effort | mechanism |\n|---|---|---|---|\n| plan (co-authoring) | gpt-5.5 | max | nudge |\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=bad)
            code, out, err = self._run(root, "plan")
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
            self.assertIn("unknown model", err)

    def test_unreadable_profile_warns_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            (root / "plans" / "model-profile.md").write_bytes(b"\xff\xfe broken")
            code, out, err = self._run(root, "plan")
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
            self.assertIn("unreadable", err)


class TestFindRoot(unittest.TestCase):
    def test_walks_up_to_master_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            sub = root / "analysis" / "deep"
            sub.mkdir(parents=True)
            self.assertEqual(models.find_root(sub), root.resolve())

    def test_no_marker_returns_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "loose"
            p.mkdir()
            self.assertEqual(models.find_root(p), p.resolve())


class TestGenerate(unittest.TestCase):
    def _generate(self, root):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), "generate"])
        return code, out.getvalue(), err.getvalue()

    def test_default_profile_writes_three_marked_agents(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            code, out, err = self._generate(root)
            self.assertEqual(code, 0)
            sha = hashlib.sha256((root / "plans" / "model-profile.md").read_bytes()).hexdigest()
            for name in ("aict-plan-reviewer", "aict-results-validator", "aict-board-reviewer"):
                path = root / ".claude" / "agents" / f"{name}.md"
                self.assertTrue(path.exists(), name)
                text = path.read_text(encoding="utf-8")
                self.assertIn(f"name: {name}", text)
                self.assertIn("model: opus", text)
                m = models.MARKER_RE.search(text)
                self.assertIsNotNone(m, name)
                self.assertEqual(m.group(1), sha)
                self.assertNotIn("{{", text, name)  # no unsubstituted placeholders
                self.assertIn(f"wrote .claude/agents/{name}.md", out)
            self.assertIn("effort: medium", (root / ".claude" / "agents" / "aict-plan-reviewer.md").read_text())
            self.assertIn("effort: low", (root / ".claude" / "agents" / "aict-results-validator.md").read_text())
            self.assertIn("tools: Read, Grep, Glob, Bash", (root / ".claude" / "agents" / "aict-plan-reviewer.md").read_text())
            self.assertIn("tools: Read, Grep, Glob\n", (root / ".claude" / "agents" / "aict-board-reviewer.md").read_text())
            self.assertIn("note: .claude/agents/ was just created", out)

    def test_unset_effort_drops_the_line(self):
        profile = DEFAULT_PROFILE.replace(
            "| results validation | opus | low | agent |",
            "| results validation | opus | — | agent |",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=profile)
            self._generate(root)
            text = (root / ".claude" / "agents" / "aict-results-validator.md").read_text()
            self.assertNotIn("effort:", text)
            self.assertIn("model: opus", text)

    def test_refuses_unmarked_user_owned_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            mine = agents / "aict-plan-reviewer.md"
            mine.write_text("---\nname: aict-plan-reviewer\n---\nmy own agent\n")
            code, out, err = self._generate(root)
            self.assertEqual(code, 0)
            self.assertEqual(mine.read_text(), "---\nname: aict-plan-reviewer\n---\nmy own agent\n")
            self.assertIn("refused (user-owned, no marker)", out)
            self.assertTrue((agents / "aict-results-validator.md").exists())
            self.assertNotIn("note: .claude/agents/ was just created", out)

    def test_marked_file_is_regenerated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._generate(root)
            target = root / ".claude" / "agents" / "aict-plan-reviewer.md"
            first = target.read_text()
            profile_path = root / "plans" / "model-profile.md"
            profile_path.write_text(DEFAULT_PROFILE.replace(
                "| plan review (verdict + grade) | opus | medium | agent |",
                "| plan review (verdict + grade) | sonnet | high | agent |",
            ), encoding="utf-8")
            self._generate(root)
            second = target.read_text()
            self.assertNotEqual(first, second)
            self.assertIn("model: sonnet", second)
            self.assertIn("effort: high", second)

    def test_missing_agent_row_skips_that_agent_only(self):
        profile = DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", "")
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=profile)
            code, out, err = self._generate(root)
            self.assertFalse((root / ".claude" / "agents" / "aict-board-reviewer.md").exists())
            self.assertTrue((root / ".claude" / "agents" / "aict-plan-reviewer.md").exists())
            self.assertIn("board-reviewer", err)

    def test_no_profile_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            code, out, err = self._generate(root)
            self.assertEqual(code, 1)
            self.assertIn("nothing to generate", err)


class TestCheck(unittest.TestCase):
    def _run(self, root, cmd):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), cmd])
        return code, out.getvalue(), err.getvalue()

    def test_fresh_generation_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            code, out, err = self._run(root, "check")
            self.assertEqual((code, out), (0, ""))

    def test_edited_profile_prints_hint_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            (root / "plans" / "model-profile.md").write_text(
                DEFAULT_PROFILE + "\nan extra line\n", encoding="utf-8"
            )
            code, out, err = self._run(root, "check")
            self.assertEqual(code, 0)
            self.assertEqual(out.strip(), models.MISMATCH_HINT)
            self.assertEqual(out.count(models.MISMATCH_HINT), 1)

    def test_no_profile_or_no_agents_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=None)
            self.assertEqual(self._run(root, "check")[1], "")
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)  # profile, no agents
            self.assertEqual(self._run(root, "check")[1], "")

    def test_unmarked_files_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            (agents / "aict-plan-reviewer.md").write_text("---\nname: aict-plan-reviewer\n---\nmine\n")
            self.assertEqual(self._run(root, "check")[1], "")


class TestOrphanRemovalAndGuards(unittest.TestCase):
    def _run(self, root, cmd):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = models.main(["--root", str(root), cmd])
        return code, out.getvalue(), err.getvalue()

    def test_removed_row_removes_marked_agent_and_clears_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            profile = root / "plans" / "model-profile.md"
            profile.write_text(DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", ""), encoding="utf-8")
            code, out, err = self._run(root, "generate")
            self.assertEqual(code, 0)
            self.assertFalse((root / ".claude" / "agents" / "aict-board-reviewer.md").exists())
            self.assertIn("removed stale .claude/agents/aict-board-reviewer.md", out)
            code, out, err = self._run(root, "check")
            self.assertEqual(out, "")

    def test_mechanism_flip_removes_marked_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            profile = root / "plans" / "model-profile.md"
            profile.write_text(DEFAULT_PROFILE.replace("| plan review (verdict + grade) | opus | medium | agent |", "| plan review (verdict + grade) | opus | medium | nudge |"), encoding="utf-8")
            code, out, err = self._run(root, "generate")
            self.assertFalse((root / ".claude" / "agents" / "aict-plan-reviewer.md").exists())
            self.assertIn("removed stale .claude/agents/aict-plan-reviewer.md", out)

    def test_user_owned_file_never_removed_on_missing_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp, profile=DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", ""))
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            mine = agents / "aict-board-reviewer.md"
            mine.write_text("---\nname: aict-board-reviewer\n---\nmine\n")
            code, out, err = self._run(root, "generate")
            self.assertTrue(mine.exists())
            self.assertEqual(mine.read_text(), "---\nname: aict-board-reviewer\n---\nmine\n")
            self.assertNotIn("removed stale", out)

    def test_unreadable_profile_bails_without_touching_agents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            before = sorted(p.name for p in (root / ".claude" / "agents").iterdir())
            (root / "plans" / "model-profile.md").write_bytes(b"\xff\xfe broken")
            code, out, err = self._run(root, "generate")
            self.assertEqual(code, 1)
            self.assertIn("unreadable", err)
            after = sorted(p.name for p in (root / ".claude" / "agents").iterdir())
            self.assertEqual(before, after)

    def test_check_skips_unreadable_agent_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            self._run(root, "generate")
            (root / ".claude" / "agents" / "aict-plan-reviewer.md").write_bytes(b"\xff\xfe broken")
            code, out, err = self._run(root, "check")
            self.assertEqual((code, out), (0, ""))


class TestCanonical(unittest.TestCase):
    def test_default_is_canonical(self):
        stages, warnings = models.parse_profile(DEFAULT_PROFILE)
        self.assertTrue(models.profile_canonical(stages, warnings))

    def test_five_row_not_canonical_despite_no_warnings(self):
        # A missing stage parses cleanly (parse_profile only warns at ZERO
        # stages) — so warnings-based editability would be wrong; canonical is not.
        prof = DEFAULT_PROFILE.replace("| sync | inherit | — | nudge |\n", "")
        stages, warnings = models.parse_profile(prof)
        self.assertEqual(warnings, [])
        self.assertFalse(models.profile_canonical(stages, warnings))

    def test_mechanism_flip_not_canonical(self):
        prof = DEFAULT_PROFILE.replace(
            "| plan review (verdict + grade) | opus | medium | agent |",
            "| plan review (verdict + grade) | opus | medium | nudge |",
        )
        stages, warnings = models.parse_profile(prof)
        self.assertEqual(warnings, [])
        self.assertFalse(models.profile_canonical(stages, warnings))

    def test_warning_row_not_canonical(self):
        prof = DEFAULT_PROFILE.replace(
            "| board reviewer panel | opus | low | agent |\n",
            "| board reviewer panel | opus | low | agent |\n| deploy | opus | max | nudge |\n",
        )
        stages, warnings = models.parse_profile(prof)
        self.assertTrue(warnings)
        self.assertFalse(models.profile_canonical(stages, warnings))


class TestLocateTable(unittest.TestCase):
    def test_locate_default(self):
        loc = models.locate_table(DEFAULT_PROFILE)
        self.assertIsNotNone(loc)
        header, first, last = loc
        lines = DEFAULT_PROFILE.splitlines(keepends=True)
        self.assertIn("stage | model | effort | mechanism", lines[header])
        self.assertEqual(last - first + 1, 6)

    def test_locate_none_when_no_table(self):
        self.assertIsNone(models.locate_table("# just prose\n\nnothing\n"))


class TestRewriteRows(unittest.TestCase):
    def test_single_edit_is_a_pure_substring_swap(self):
        new = models.rewrite_rows(DEFAULT_PROFILE, {"plan": {"model": "sonnet", "effort": "max"}})
        self.assertEqual(
            new,
            DEFAULT_PROFILE.replace(
                "| plan (co-authoring) | opus | max | nudge |",
                "| plan (co-authoring) | sonnet | max | nudge |",
            ),
        )
        self.assertEqual(models.parse_profile(new)[0]["plan"]["model"], "sonnet")

    def test_prose_preserved_byte_exact(self):
        orig = models.profile_view(DEFAULT_PROFILE)
        new = models.rewrite_rows(DEFAULT_PROFILE, {"plan": {"model": "sonnet", "effort": "max"}})
        newv = models.profile_view(new)
        self.assertEqual(orig["proseBefore"], newv["proseBefore"])
        self.assertEqual(orig["proseAfter"], newv["proseAfter"])

    def test_crlf_line_endings_preserved(self):
        crlf = DEFAULT_PROFILE.replace("\n", "\r\n")
        new = models.rewrite_rows(crlf, {"plan": {"model": "sonnet", "effort": "max"}})
        self.assertNotIn("\r\r", new)
        self.assertEqual(
            new,
            crlf.replace(
                "| plan (co-authoring) | opus | max | nudge |",
                "| plan (co-authoring) | sonnet | max | nudge |",
            ),
        )

    def test_none_effort_renders_em_dash(self):
        new = models.rewrite_rows(DEFAULT_PROFILE, {"results-validation": {"model": "opus", "effort": None}})
        self.assertIn("| results validation | opus | — | agent |", new)
        self.assertIsNone(models.parse_profile(new)[0]["results-validation"]["effort"])

    def test_label_and_mechanism_kept_verbatim(self):
        new = models.rewrite_rows(DEFAULT_PROFILE, {"plan-review": {"model": "haiku", "effort": "low"}})
        self.assertIn("| plan review (verdict + grade) | haiku | low | agent |", new)

    def test_no_table_raises(self):
        with self.assertRaises(ValueError):
            models.rewrite_rows("# no table here\n", {"plan": {"model": "opus", "effort": "max"}})


class TestProfileView(unittest.TestCase):
    def test_rows_in_stage_order_with_labels(self):
        v = models.profile_view(DEFAULT_PROFILE)
        self.assertEqual(
            [r["stage"] for r in v["rows"]],
            ["plan", "execute", "sync", "plan-review", "results-validation", "board-reviewer"],
        )
        self.assertEqual(v["rows"][0]["label"], "plan (co-authoring)")
        self.assertEqual(v["rows"][0]["model"], "opus")
        self.assertIsNone(v["rows"][1]["effort"])
        self.assertTrue(v["editable"])

    def test_prose_split_reconstructs_original(self):
        v = models.profile_view(DEFAULT_PROFILE)
        self.assertIn("# Model profile", v["proseBefore"])
        self.assertIn("Why these defaults", v["proseAfter"])
        h, f, l = models.locate_table(DEFAULT_PROFILE)
        lines = DEFAULT_PROFILE.splitlines(keepends=True)
        table = "".join(lines[h:l + 1])
        self.assertEqual(v["proseBefore"] + table + v["proseAfter"], DEFAULT_PROFILE)

    def test_non_editable_for_noncanonical(self):
        prof = DEFAULT_PROFILE.replace("| sync | inherit | — | nudge |\n", "")
        self.assertFalse(models.profile_view(prof)["editable"])


class TestGenerateOutcomes(unittest.TestCase):
    def _profile(self, root, text):
        (root / "plans" / "model-profile.md").write_text(text, encoding="utf-8")

    def test_first_generate_creates_all_three(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            res = models.generate(root)
            self.assertEqual(res["code"], 0)
            self.assertEqual({r["outcome"] for r in res["results"]}, {"created"})
            self.assertTrue(res["restartNeeded"])
            self.assertEqual(
                set(res["changedStages"]),
                {"plan-review", "results-validation", "board-reviewer"},
            )

    def test_regenerate_unchanged_profile_no_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.generate(root)
            res = models.generate(root)
            self.assertTrue(all(r["outcome"] == "unchanged" for r in res["results"]))
            self.assertFalse(res["restartNeeded"])

    def test_agent_model_change_is_runtime_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.generate(root)
            self._profile(root, DEFAULT_PROFILE.replace(
                "| plan review (verdict + grade) | opus | medium | agent |",
                "| plan review (verdict + grade) | sonnet | medium | agent |",
            ))
            res = models.generate(root)
            o = {r["stage"]: r["outcome"] for r in res["results"]}
            self.assertEqual(o["plan-review"], "runtimeChanged")
            # profile bytes changed so the other agents re-render with a new
            # checksum stamp only — no runtime change, no restart from them.
            self.assertEqual(o["results-validation"], "checksumOnlyChanged")
            self.assertEqual(res["changedStages"], ["plan-review"])
            self.assertTrue(res["restartNeeded"])

    def test_nudge_only_edit_is_checksum_only_no_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.generate(root)
            self._profile(root, DEFAULT_PROFILE.replace(
                "| execute (analysis) | sonnet | — | nudge |",
                "| execute (analysis) | haiku | — | nudge |",
            ))
            res = models.generate(root)
            self.assertTrue(all(r["outcome"] == "checksumOnlyChanged" for r in res["results"]))
            self.assertFalse(res["restartNeeded"])

    def test_created_in_existing_dir_needs_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.generate(root)
            (root / ".claude" / "agents" / "aict-board-reviewer.md").unlink()
            res = models.generate(root)
            o = {r["stage"]: r["outcome"] for r in res["results"]}
            self.assertEqual(o["board-reviewer"], "created")
            self.assertEqual(res["changedStages"], ["board-reviewer"])
            self.assertTrue(res["restartNeeded"])

    def test_removed_row_outcome_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.generate(root)
            self._profile(root, DEFAULT_PROFILE.replace("| board reviewer panel | opus | low | agent |\n", ""))
            res = models.generate(root)
            o = {r["stage"]: r["outcome"] for r in res["results"]}
            self.assertEqual(o["board-reviewer"], "removed")
            self.assertTrue(res["restartNeeded"])

    def test_user_owned_refusal_excluded_from_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            agents = root / ".claude" / "agents"
            agents.mkdir(parents=True)
            (agents / "aict-plan-reviewer.md").write_text("---\nname: aict-plan-reviewer\n---\nmine\n")
            res = models.generate(root)
            o = {r["stage"]: r["outcome"] for r in res["results"]}
            self.assertEqual(o["plan-review"], "refused-user")
            self.assertNotIn("plan-review", res["changedStages"])

    def test_atomic_write_leaves_no_temp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            models.generate(root)
            leftovers = [p.name for p in (root / ".claude" / "agents").iterdir() if p.name.endswith(".tmp")]
            self.assertEqual(leftovers, [])

    def test_generate_reports_error_when_agent_write_fails_without_raising(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_project(tmp)
            # .claude/agents is a FILE, so the agent mkdir/write fails
            (root / ".claude").mkdir()
            (root / ".claude" / "agents").write_text("not a dir")
            res = models.generate(root)  # must not raise
            self.assertEqual(res["code"], 0)
            self.assertTrue(all(r["outcome"] == "error" for r in res["results"]))
            self.assertFalse(res["restartNeeded"])


class TestAtomicWrite(unittest.TestCase):
    def test_preserves_exact_bytes_including_crlf(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "f.md"
            models.atomic_write(p, "a\r\nb\n")
            self.assertEqual(p.read_bytes(), b"a\r\nb\n")  # no \n->CRLF translation

    def test_round_trip_default_profile_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "model-profile.md"
            models.atomic_write(p, DEFAULT_PROFILE)
            self.assertEqual(p.read_text(encoding="utf-8"), DEFAULT_PROFILE)


class TestReviewDiscipline(unittest.TestCase):
    def test_templates_carry_review_discipline(self):
        tdir = SCRIPTS.parent / "templates" / "agents"
        board = (tdir / "aict-board-reviewer.md").read_text(encoding="utf-8")
        for marker in ("[blocker]", "[major]", "[minor]",
                       "Ground every claim", "Verify before returning"):
            self.assertIn(marker, board)
        for name in ("aict-plan-reviewer.md", "aict-results-validator.md"):
            text = (tdir / name).read_text(encoding="utf-8")
            self.assertIn("Verify before returning", text)


class TestCheckTemplateDrift(unittest.TestCase):
    def _project(self, td):
        root = Path(td)
        (root / "plans").mkdir()
        (root / "plans" / "master-plan.md").write_text(
            "<!-- aict:master-plan -->\n", encoding="utf-8")
        (root / "plans" / "model-profile.md").write_text(
            DEFAULT_PROFILE, encoding="utf-8")
        models.generate(root)
        return root

    def _check_stdout(self, root):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            models.cmd_check(root)
        return out.getvalue()

    def test_freshly_generated_agents_are_silent(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(self._check_stdout(self._project(td)), "")

    def test_template_drift_prints_hint(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            with tempfile.TemporaryDirectory() as tpl:
                src = models._templates_dir()
                for f in src.iterdir():
                    (Path(tpl) / f.name).write_text(
                        f.read_text(encoding="utf-8") + "\nNEW RULE.\n",
                        encoding="utf-8")
                orig = models._templates_dir
                models._templates_dir = lambda: Path(tpl)
                try:
                    self.assertIn("out of date", self._check_stdout(root))
                finally:
                    models._templates_dir = orig

    def test_profile_mismatch_still_hints(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            prof = root / "plans" / "model-profile.md"
            prof.write_text(prof.read_text(encoding="utf-8") + "\n",
                            encoding="utf-8")
            self.assertIn("out of date", self._check_stdout(root))

    def test_row_removed_marked_agent_hints_without_crash(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            prof = root / "plans" / "model-profile.md"
            text = prof.read_text(encoding="utf-8").replace(
                "plan review", "plan review DISABLED")
            prof.write_text(text, encoding="utf-8")
            new_sum = hashlib.sha256(prof.read_bytes()).hexdigest()
            agent = root / ".claude" / "agents" / "aict-plan-reviewer.md"
            agent.write_text(
                re.sub(r"sha256:[0-9a-f]{64}", "sha256:" + new_sum,
                       agent.read_text(encoding="utf-8")),
                encoding="utf-8")
            self.assertIn("out of date", self._check_stdout(root))

    def test_user_owned_agent_stays_silent(self):
        with tempfile.TemporaryDirectory() as td:
            root = self._project(td)
            agent = root / ".claude" / "agents" / "aict-plan-reviewer.md"
            agent.write_text("my own reviewer, no marker\n", encoding="utf-8")
            self.assertEqual(self._check_stdout(root), "")


if __name__ == "__main__":
    unittest.main()
