# Changelog

## [0.8.0] - 2026-09-24

The board had a tab for the analysis plan, the results, and machine-generated
per-component reports — but nowhere for the actual manuscript, the paper being
graded. Student and instructor had no shared surface to exchange feedback on
the paper itself.

### Added
- **Manuscript tab.** Placed second in the nav bar, right after Tracker.
  `board.py` discovers `plans/manuscript.{md,docx,hwp,hwpx}` (in that priority
  order) and adds it to the payload present-only, exactly like `history`/
  `archives`. Markdown is the encouraged path and renders as-is. A `.docx` is
  read through a small stdlib-only extractor (`zipfile` + `ElementTree` — a
  `.docx` is just a zip of XML, so no mammoth/pandoc dependency), producing
  plain text with best-effort Heading1-6 prefixing; formatting, images, and
  tables are lost, and the board says so. `.hwp`/`.hwpx` are surfaced as
  explicitly unsupported rather than guessed at — there's no reliable
  stdlib-only parse path for either.
- **Feedback on the manuscript reuses the existing hosted-comment pipeline
  unchanged.** The new `Manuscript.tsx` view is wired through the same
  doc-comment/`AnnotationLayer` machinery every other tab uses, so post,
  release, `/me`, and web push already work for it with **zero server-side
  changes** — the classroom server's `validate.ts` never inspects the `view`
  field, only `type`. Staleness detection mirrors the Reports doc-comment
  branch in both `hostedComments.ts` and `board.py`'s `_doc_stale`, hashing
  the same extracted text the payload carries, not raw docx bytes.
- **`/aict:init` scaffolds `plans/manuscript.md`** from a new starter template
  on first init — present-only, never touches an existing manuscript file of
  any supported extension.

## [0.7.0] - 2026-09-21

### Added
- **Legacy-project guard on the sign-off gate.** `find_project_root` fails OPEN by design: an unrecognized opt-in marker returns `None` and every gate riding on it stops firing, silently. After the rename, a repo still carrying `<!-- papertrail:start -->` would therefore have run with no sign-off gate and no results/archive immutability, with nothing said. It now returns a `LEGACY` sentinel and every call site denies the write with a `/aict:init` migration notice instead. Covered by `tests/test_gate_legacy.py`; a project with no markers at all still passes through untouched, exactly as before.
- **One-time data carry-over across the rename.** `plugin_data_dir` (board.py) moves a pre-rename `~/.papertrail/<namespace>` directory to `~/.aict/<namespace>` on first use, and reads it in place if the move fails — it holds the student's roster server URL and personal token, the set of instructor comments already pulled, and the instructor's published board URL and pull key. `me.html` does the same for its `pt-me-token` / `pt-me-seen:` localStorage keys, so a student is not logged out of the feedback page and does not see every released comment marked unread again.
- **Student search on the roster dashboard.** A search box filters the roster table by student name or id as you type — for a class where scrolling a long table to find one student is friction.

### Changed
- **Instruction text restructured for progressive disclosure.** Commands no longer load each other whole. `SKILL.md` is an index (4,471 → 1,869 tok) pointing at `references/`; `commands/board.md` keeps the gate, the serve loop and its exit codes (5,695 → 1,863 tok) and defers feedback routing, reviewer dispatch, and export/share/ingest to `board-routing.md`, `board-review.md`, `board-modes.md`, loaded only when those paths are actually taken. The capture procedure moved to `references/capture.md`, so `/aict:results` (3,763 → 356 tok) and the execution loop share one copy instead of the loop pulling the whole command file. The amendment and re-commitment recipe — previously duplicated across `sync.md`, `sign.md` and `execute.md` — is now `references/amendment.md`. The `SKILL.md` command table is gone: Claude Code already injects every command's description. Measured end to end: a plain board open 10,166 → 3,733 tok, an `/aict:execute` run 19,189 → 11,114 tok, before any project file is read. Nothing the workflow enforces changed — the untrusted-input guard, the sign-off gate rules, the validation contract and the rubric all moved intact, and the doc tests now assert them at their new homes.
- **The CLAUDE.md block is shorter** (1,213 → 1,034 tok). Rules 1–6, 8 and 10 are compressed to one line each; rule 7 (course/deadline and output conventions), rule 9 (evidence before claims) and rule 11 (the student authors the interpretation) are kept **verbatim** — they carry project-specific or academic-integrity content that cannot be inferred from the skill.
- **Renamed to AICT (AI Companion Teaching).** Every case-variant of "papertrail" is now "aict"/"AICT", including `AICT_*` env vars (`AICT_NO_GATE`, `AICT_NO_BOARD`, `AICT_NO_UPDATE_CHECK`, `AICT_GATE_TIMEOUT`) and the `<!-- aict:master-plan -->` / `<!-- aict:start -->` / `<!-- aict:end -->` markers. Provenance markers `<!-- pt-model -->` / `<!-- pt-report -->` are now `<!-- aict-model -->` / `<!-- aict-report -->`; the generated review agents are `aict-plan-reviewer` / `aict-results-validator` / `aict-board-reviewer`; the skill directory is `skills/managing-aict/`; the no-LLM board launcher is `./aict-board`; the sign-session ticket prefix is `.aict-approved-`. This is a clean break: no `papertrail`/`pt-*` dual-read code exists anywhere, and none should be added. The GitHub repo and the deployed roster server keep their existing names — the roster URL is configured per project, not derived from the plugin name, so existing student tokens keep working.
- **Instructor comments post as you leave them.** In the drilled-in student board (hosted mode) a new comment now goes to the server the moment it is added — no second per-card **Save** click. Pressing Return in the comment box commits it (Shift+Return for a newline); the per-card Save stays only as a retry affordance if the POST fails or the reviewer name is still blank.
- **`/aict:check` opens the board itself.** When there are anchored instructor comments, `check.py` now launches the local board (detached) on the seed file directly — releasing any board already holding `plans/.board.lock` first — instead of relying on a separate command step. Prints `[aict:check] opening the board…`; set `AICT_NO_BOARD=1` to suppress (headless runs).

## [0.6.0] - 2026-08-31

Instructor feedback lands where a student can actually use it: anchored comments now reopen on the student's own board, painted on the exact passage they target, and the instructor's name pre-fills so the first comment can't silently fail to save.

### Added
- **`/papertrail:check` reopens the board with the instructor's comments in place.** Anchored comments (a quote on a plan version, the tracker, or a results report) are written as a `--seed-annotations` file; `check.py` prints a `[papertrail:check] board-seeds: <path>` line and the command opens the local board so the student reads the instructor's exact wording on the passage it targets — not a relayed summary. The comments still arrive as an untrusted-DATA ` ```json board-feedback ` document for routing (`commands/check.md` step 5), and general (unanchorable) notes still come through as text only. `check.py` gains `annotation_to_seed` / `write_seed_file`; the seed path is gitignored and cleared when nothing is new.
- **`COURSE_INSTRUCTOR_NAME`** (`/papertrail:host --init`, optional but recommended) — pre-fills the comment-author field when the instructor drills into a student's board. There is one instructor login, so a blank author field was pure friction — and a blank field silently disables the **Save comment** button, so a first comment from a fresh browser looked saved when it wasn't. `GET /api/roster` now carries `course.instructorName`; the board uses it as the reviewer-name default (`BoardData.defaultReviewer`), and a name the reviewer already typed on that device still wins.

### Changed
- `docs/hosting-the-roster.md` describes both: the instructor-name default and the in-place comment reopen.
- version 0.5.0 -> 0.6.0 (plugin.json + board/package.json).

## [0.5.0] - 2026-08-30

Splits instructor-feedback checking out of `/papertrail:submit` into its own command, `/papertrail:check`, and backs it with a server endpoint that returns a student's comments across **all** their submissions in one call — so a check from a second machine (or after a fresh install) can't silently miss feedback left on an older submission.

### Added
- **`/papertrail:check`** (`commands/check.md`, `skills/managing-papertrail/scripts/check.py`) — pulls every instructor comment on any of the student's past submissions (`GET /api/my-comments`, authenticated with the student's own bearer token) and routes anything not already seen through the same hosted-feedback pipeline `/papertrail:board --pull` uses: one ` ```json board-feedback ` document per instructor/session, `"mode": "hosted"`, so the student's existing board-feedback routing treats it as instructor **data, not instructions**. Crash-safe (inbox-then-mark-pulled). Runnable any time, not only right after a submit. There is still no push notification anywhere in this tool — no email, no webhook.
- **`GET /api/my-comments`** (`skills/managing-papertrail/assets/classroom-template/api/my-comments.ts`) — bearer-token-only route: resolves the token to a student, walks their full submission history server-side, and returns every comment across all of it, sorted by time. Exempted from the instructor-cookie middleware gate (`lib/gate.ts`, `middleware.ts`) the same way `/api/submissions` and `/api/comments` already are.
- **Local classroom state module** (`skills/managing-papertrail/scripts/classroom.py`) — the server URL + personal token config and the "pulled comment ids" set, shared by `submit.py` and `check.py` (neither imports the other). Migrates the pre-0.5 `<hash>-seen-comments.json` (written by the old submit-time check) into the new flat `<hash>-comments-pulled.json` on first read, so an existing student doesn't re-see old comments.
- **UTF-8 output** in `check.py` — routed feedback documents can contain any character the instructor typed; the script forces UTF-8 on stdout/stderr so a non-UTF-8 console (e.g. cp949 on Korean Windows) can't crash routing.

### Changed
- **`/papertrail:submit` only submits now.** The submit-time comment check (`check_for_new_comments` / `fetch_comments` in `submit.py`, and its `<hash>-seen-comments.json` bookkeeping) is gone; on a created or replayed submission the command tells the student to run `/papertrail:check`. `commands/submit.md`, `docs/hosting-the-roster.md`, `commands/host.md`, `README.md`, and `SKILL.md`'s command table updated to match (the skill table also gains the `submit` and `host` rows it was missing).
- **`/papertrail:host --deploy`** documents that a plugin upgrade needs the deploy directory's server code refreshed from the template before redeploying — `--deploy` alone does not re-copy plugin code.

### Fixed
- The [0.3.0] entry described the comment check as living in `submit.py` and firing on every submit; that behavior moved to `/papertrail:check` in this release.

## [0.4.0] - 2026-08-25

Adds a second supported paper type: a literature review (systematic/PRISMA-style), alongside the original quantitative-analysis paper. This was already almost entirely supported — the execution-plan template, the results-bundle schema (`producedBy: null`, `kind: "other"`), and the five-channel rubric were already written in method-agnostic language — so this is a prose/template change, not a code or schema change.

### Added
- **`/papertrail:init` now asks the paper's type first** — quantitative or literature review — as its own single-question round before the usual interview, stored as `Paper type:` in `plans/master-plan.md`. The answer decides which `CLAUDE.md` conventions block gets installed and how the components table's second column is labeled ("Analysis step" vs. "Review step" — a display label only, parsed by no code).
- **`skills/managing-papertrail/templates/claude-md-section-review.md`** — a review-paper variant of the CLAUDE.md conventions block. Identical to the existing `claude-md-section.md` in every rule except 7 (output conventions: a PRISMA flow diagram, an extraction table that may belong in a supplementary/appendix file, and a narrative-synthesis paragraph are now named as legitimate deliverable shapes) and 9 (evidence-before-claims: phrased around a search/screening/extraction pass instead of code execution). Rules 1–6, 8, 10, 11 — the workflow governance itself — are byte-identical between the two files.
- **`docs/review-papers.md`** — a worked systematic-review walkthrough parallel to `QUICKSTART.md`'s quantitative example: example components (search-strategy, screening, extraction, quality-appraisal, synthesis), a decision-log entry example, and a results-bundle example using the schema's existing `producedBy: null`/`kind: "other"` conventions for hand-produced artifacts.
- `commands/init.md` step 4's component-derivation guidance now proposes review-methodology stages when `paperType: review`, instead of quantitative-analysis steps.

## [0.3.0] - 2026-08-25

Closes a gap in the roster server (v0.2.0): drilling into a student's board from the roster dashboard had no way to actually leave a comment, and nothing told a student one had been left. Both are now real, in keeping with the existing "no push notifications anywhere in this tool" design: the instructor's comment is stored, and a student finds out only by running `/papertrail:submit`, which now also checks their own submissions for anything new.

### Added
- **Instructor comments on a submitted board.** Drilling into a student's board from the roster reuses the exact same hosted-comment flow a `--publish-web` collaborator link already has (select text, leave a comment) — `board/src/views/Roster.tsx` marks the drilled-in payload `mode: "hosted"` so `App.tsx`'s existing comment machinery fires unmodified. The classroom server gained `GET/POST /api/comments` (`skills/managing-papertrail/assets/classroom-template/{lib,api}/comments.ts`), storing comments scoped by `shareHash` (a submission's content hash), resolved to a student via a new `submission-index/` reverse lookup written at submission-accept time. Reads are authorized either by the instructor's session (any student) or a student's own bearer token (their own submissions only, never another student's).
- **A student learns about a comment by running `/papertrail:submit`.** No email, no webhook — consistent with this tool never sending anything on its own. Every submit now also fetches the student's own comments (`skills/managing-papertrail/scripts/submit.py`'s `check_for_new_comments`), diffs against a locally remembered "seen" set keyed by shareHash, and prints anything new under an "Instructor feedback" heading.
- **A "new" badge on the roster table** for any row submitted since the instructor's last visit to the dashboard (`isNewSinceLastView`, computed server-side from a single last-viewed pointer in `lib/roster.ts` — there being only one instructor login, no per-person state is needed).

### Changed
- `board/src/App.tsx`'s hosted-comment fetch now includes `?shareHash=` in its `GET /api/comments` call — a no-op for the existing single-project `web-template` deploy (one project, one shareHash-space, the extra query param is ignored), required for the classroom server to know which student's comments to return.
- `docs/hosting-the-roster.md` and the README's roster section now describe this accurately — they previously undersold what the drill-down view could do (nothing) and oversold it (comment-capable) at different points; both are now correct.

## [0.2.0] - 2026-08-25

Adds an instructor-hosted classroom roster server: students submit their project state to one central, multi-tenant server (separate from the existing single-project `--publish-web` sharing) so the instructor reviews everyone from one dashboard instead of opening each student's board individually.

### Added
- **`/papertrail:submit`** (`commands/submit.md`, `skills/managing-papertrail/scripts/submit.py`) — packages a student's current project state (`collect_payload` + inlined artifacts + a bounded git-log excerpt of `plans/`, commit hash/date/author/subject only, no diffs or code) into a versioned envelope and submits it to the instructor's server. Always shows a full preview (components, versions, results bundles, commit range, size) and requires explicit confirmation before sending — never silent. Idempotent: resubmitting identical content is a no-op.
- **`/papertrail:host`** (`commands/host.md`) — instructor command to stand up and administer the classroom server: first-run Vercel setup (`--init`), student registration/token minting (`--add-student` / `--roster <file>`), redeploy (`--deploy`), opening the dashboard (`--roster-view`), and token rotation (`--rotate-token`). Never gains a sign/approve action — the "comment-only instructor role" invariant carries over unchanged.
- **`skills/managing-papertrail/assets/classroom-template/`** — a new, parallel Vercel deployment template (alongside the existing single-project `web-template/`) for the multi-tenant server: per-student bearer tokens (never a shared password), an instructor-only login session, and Blob-backed roster/submission storage.
- **Server-side mechanical re-verification** on every submission: independently recomputes each results bundle's checksum/artifact-reference integrity and F·A·I score from the submitted bytes (never trusts the client-sealed values), re-checks each signed plan's sign-off trailer grammar, and cross-checks sign-off dates against the submitted git-log excerpt for a timing-based flag. Content-level mismatches are always stored and flagged, never rejected — only a malformed or oversized envelope is refused.
- **Cross-student similarity signal** (`/papertrail:host` dashboard, instructor-triggered) — k-shingling + Jaccard similarity over normalized decision-log text, surfaced as a neutral "worth a look" flag with a concrete shared-phrase example. No automatic consequence.
- **Roster dashboard** (`board/src/views/Roster.tsx`, `board/src/RosterApp.tsx`) — a new view, additive to the existing single-project board (no changes to `Tracker`/`PlanReader`/`Results`/`Timeline`/etc.). Each row deep-links into that student's full board, rendered by the same unmodified single-project UI. Includes a **trust-tier legend** distinguishing mechanically re-verified checks from descriptive/timing-derived signals from self-attested claims, so a green check is never over-trusted.
- `docs/hosting-the-roster.md` — setup/troubleshooting/privacy guide for the classroom server, with an explicit callout that it now aggregates every registered student's decision log and git history in one place.

### Fixed
- `board/package.json`'s version had drifted to a stale `1.1.0` inherited from the Planboard fork instead of tracking `.claude-plugin/plugin.json`; both are now `0.2.0` per this project's own version-parity rule.

## [0.1.0] - 2026-08-24

Initial release of PaperTrail, forked from [Planboard](https://github.com/letitbk/planboard) v1.1.0 and retargeted from a solo-researcher tool into a plan-based bridge between a graduate student, their AI assistant, and their instructor for a quantitative-methods final paper. The plan/sign-off/decision-log/results-bundle mechanics carry over unchanged; the naming, prose, and a handful of academic-integrity controls are new.

### Changed
- **Renamed to papertrail.** Every case-variant of "planboard" is now "papertrail"/"PaperTrail"/"PAPERTRAIL", including `PAPERTRAIL_*` env vars and the `<!-- papertrail:master-plan/start/end -->` markers. Provenance markers `<!-- pb-model -->` / `<!-- pb-report -->` are now `<!-- pt-model -->` / `<!-- pt-report -->`; generated review agents `pb-plan-reviewer` / `pb-results-validator` / `pb-board-reviewer` are now `pt-plan-reviewer` / `pt-results-validator` / `pt-board-reviewer`; the no-LLM board launcher is now `./pt-board`; the sign-session ticket file is `.papertrail-approved-<slug>-v<N>`.
- **Retargeted from researcher+AI to student+AI+instructor.** Commands, the skill brain, and templates are rewritten for a graduate student writing a sociology quantitative-methods final paper, with the instructor as a comment-only board participant (unchanged mechanically from the prior "collaborator" role — still no sign/approve capability).
- **`master-plan.md` template** — header "Master Plan" → "Paper Plan"; the Components table's `Component` column is now `Analysis step`.
- **`execution-plan.md` template** — header "Execution Plan" → "Analysis Plan"; the 8-section structure is unchanged.
- **`CLAUDE.md` conventions (rule 7)** — rewritten from target-journal vector-PDF/typeset-table output conventions to coursework deliverable conventions (APA/ASA citations, paper-ready figures/tables, deadline awareness).
- **Plan rubric** — moved from `docs/plan-rubric-v0.4.md` to `docs/plan-rubric.md`; the five channels and their 0–3 anchors are unchanged. The empirical methods note (Planboard's own 14-project provenance) was replaced with a one-line attribution back to the Planboard project.
- **`.claude-plugin/plugin.json` / `marketplace.json`** — new description, `"author": {"name": "PaperTrail contributors"}`, version reset to `0.1.0`, `homepage`/`repository` left as placeholders pending a hosting decision.

### Added
- **Low-Decisions sign-off guard** (`/papertrail:plan`, `/papertrail:sign`). Before a plan whose "Decisions and reasons" rubric channel scores below 2/3 is signed, the AI must recommend revising it first; signing anyway is logged to `decision-log.md` as an explicit override entry.
- **Retrospective-adoption warning** (`/papertrail:adopt`). A callout against using retrospective adoption to backfill legitimacy for a graded component without instructor approval, pointing to the rubric's `unsupported-sources` integrity flag as the existing mechanical safeguard.
- **AI Assistance Disclosure** (`/papertrail:report`). Every generated report now renders a disclosure table from the `modelUsage` data already captured per plan/results bundle, listing which stages used which model, with a pointer to the decision log and results bundle as the verifiable record.
- **No-AI-authored-interpretation rule** (`CLAUDE.md` rule 11). The AI may draft directions, play devil's advocate, and critique, but must never write the paper's sociological interpretation on the student's behalf; a drafted starting point must be flagged in the decision log until the student has revised it in their own words.

### Removed
- **All `research-plans`/`RESEARCH_PLANS_*`/`rp-*` migration-compatibility code.** Planboard carried dual-read support for its own prior name (`research-plans`) across markers, environment variables, generated agent filenames, the board launcher, and a hosted-config directory fallback. PaperTrail has no prior installs to migrate from, so all of that compatibility layer was deleted outright rather than renamed — this is a clean break, not a rename-in-place.
- **`docs/plans/`, `docs/specs/`, `docs/evaluation/`, `docs/images/`, `docs/ROADMAP.md`, `docs/RELEASING.md`** — Planboard's own dev-history, CI, and screenshot artifacts, not applicable to this fork.
- **`.github/`, `scripts/check_pr_policy.py`, `scripts/new-walkthrough.py`** — Planboard's own CI and dev-tooling scripts.
- **`commands/handoff.md`, `skills/managing-papertrail/scripts/handoff.py`** — the Codex-handoff command, out of scope for this fork.
- **`tests/test_rename_compat.py`, `tests/test_check_pr_policy.py`, `tests/test_handoff.py`** — tests for the removed compatibility layer, CI policy, and handoff command.
