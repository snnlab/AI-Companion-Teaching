"""Contract tests for command instructions that have no runtime module."""

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


class TestCommandInventoryDocs(unittest.TestCase):
    def test_expected_command_files_exist(self):
        for name in ("adopt", "board", "execute", "init", "models", "plan",
                     "sign",
                     "renew", "report", "results", "review", "sync"):
            self.assertTrue((REPO / "commands" / (name + ".md")).is_file(), name)


class TestInitPortabilityDocs(unittest.TestCase):
    def test_headless_recovery_lists_every_required_answer(self):
        command = (REPO / "commands" / "init.md").read_text(encoding="utf-8")

        self.assertIn("AskUserQuestion is unavailable", command)
        self.assertIn("create nothing", command)
        self.assertIn("/aict:init Paper type:", command)
        for field in ("Paper:", "RQs:", "source=", "rough size=", "sensitivity=",
                      "Course:", "model profile=", "reader detail="):
            self.assertIn(field, command)


class TestBoardReviewerPortabilityDocs(unittest.TestCase):
    def test_external_reviewers_have_preflights_and_permission(self):
        command = (REPO / "commands" / "board.md").read_text(encoding="utf-8")
        review = (REPO / "skills" / "managing-aict" / "references"
                  / "board-review.md").read_text(encoding="utf-8")

        # The permission lives on the command that dispatches; the preflights
        # live with the dispatch instructions themselves.
        self.assertIn("Bash(command:*)", command)
        self.assertIn("command -v codex", review)
        self.assertIn("command -v agy", review)
        self.assertIn("not available — pick another reviewer", review)


class TestSignTransactionDocs(unittest.TestCase):
    def test_sign_reference_names_the_shared_procedures(self):
        reference = (REPO / "skills" / "managing-aict" /
                     "references" / "sign-off.md").read_text(encoding="utf-8")

        for heading in ("## The finalization transaction",
                        "## Launching a sign session", "## Recovery"):
            self.assertIn(heading, reference)
        self.assertIn("--sign [NN-slug] --no-open", reference)
        self.assertIn(".sign-feedback-v<N>.md", reference)
        self.assertIn("Do not rely on stdout alone", reference)

    def test_plan_leaves_a_scored_pending_draft(self):
        command = (REPO / "commands" / "plan.md").read_text(encoding="utf-8")

        self.assertIn("draft ready — it signs at /aict:execute", command)
        self.assertIn("link it to the draft path", command)
        self.assertNotIn("--gate-batch", command)
        self.assertNotIn("clicks **Approve**", command)

    def test_sync_records_an_amendment_without_a_ticket(self):
        command = (REPO / "commands" / "sync.md").read_text(encoding="utf-8")
        amendment = (REPO / "skills" / "managing-aict" / "references"
                     / "amendment.md").read_text(encoding="utf-8")

        # The procedure lives in the shared reference; sync points at it and
        # keeps the board-facing label.
        self.assertIn("Amendment recorded, <YYYY-MM-DD>", amendment)
        self.assertIn("without a ticket", amendment + command)
        self.assertIn("amended △", command)
        self.assertIn("amendment.md", command)
        for text in (command, amendment):
            self.assertNotIn("new signed version", text)

    def test_sign_and_execute_share_the_recommitment_recipe(self):
        sign = (REPO / "commands" / "sign.md").read_text(encoding="utf-8")
        execute = (REPO / "commands" / "execute.md").read_text(encoding="utf-8")
        amendment = (REPO / "skills" / "managing-aict" / "references"
                     / "amendment.md").read_text(encoding="utf-8")
        recipe = ("Copy the amendment `v<N>.md` to `.draft-v<N+1>.md`. "
                  "Use `strip_trailer` from `signoff_gate.py`")

        # One copy of the recipe, both commands routed to it.
        self.assertIn(recipe, amendment)
        self.assertIn("re-commitment for re-execution", amendment)
        self.assertIn("trailer state `none`", amendment)
        for command in (sign, execute):
            self.assertIn("amendment.md", command)
            self.assertIn("Re-committing an amendment for re-execution", command)

    def test_board_has_no_plan_approval_route(self):
        texts = [(REPO / "commands" / "board.md").read_text(encoding="utf-8")]
        refs = REPO / "skills" / "managing-aict" / "references"
        texts += [(refs / f"board-{n}.md").read_text(encoding="utf-8")
                  for n in ("routing", "review", "modes")]

        for text in texts:
            self.assertNotIn("Sign-off order", text)
            self.assertNotIn("clicked Approve", text)

    def test_board_reopens_on_a_produced_draft(self):
        command = (REPO / "commands" / "board.md").read_text(encoding="utf-8")
        routing = (REPO / "skills" / "managing-aict" / "references"
                   / "board-routing.md").read_text(encoding="utf-8")
        # A produced/refined plan draft is a third reopen trigger beside review/report.
        self.assertIn("produced a new or refined plan draft", command)
        # ...and the reopen focuses that component's draft.
        self.assertIn("reopen the board focused on that component", routing)

    def test_results_uses_the_governing_canonical_version(self):
        command = (REPO / "skills" / "managing-aict" / "references"
                   / "capture.md").read_text(encoding="utf-8")
        validator = (REPO / "skills" / "managing-aict" /
                     "templates" / "agents" /
                     "aict-results-validator.md").read_text(encoding="utf-8")

        self.assertIn("governing plan version", command)
        self.assertIn("valid signed or amendment trailer", command)
        self.assertIn("approval does not gate validation eligibility", command)
        self.assertIn("governing plan version", validator)

    def test_live_doctrine_no_longer_routes_approval_through_the_board(self):
        roots = (REPO / "commands", REPO / "skills")
        live_text = "\n".join(
            path.read_text(encoding="utf-8")
            for root in roots
            for path in root.rglob("*.md")
        )

        for stale in ("Approve on the board", "board Approve", "review room",
                      "gate-batch"):
            self.assertNotIn(stale, live_text)


if __name__ == "__main__":
    unittest.main()
