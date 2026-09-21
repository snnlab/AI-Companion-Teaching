# AGENTS.md

## Repository

AICT is a Claude Code plugin, forked from [Planboard](https://github.com/letitbk/planboard) and retargeted from a solo-researcher tool into a student–AI–instructor workflow for a graduate quantitative-methods course's final paper.

The product name and current identifiers are `aict` and `aict-*` (plan/report provenance markers, generated review agents, the `aict-board` launcher, the `.aict-approved-*` sign-off ticket prefix). AICT was renamed from `papertrail` (itself a Planboard fork), and that rename **was** a clean break: no `papertrail`/`pt-*` dual-read code exists, and none should be added. The single deliberate exception is the legacy guard in `signoff_gate.py` — `find_project_root` fails OPEN, so a repo still carrying `<!-- papertrail:start -->` would run with every integrity gate silently off. It returns `LEGACY` and each call site denies with a `/aict:init` migration notice instead. Two one-time data carry-overs ride along for the same reason: `plugin_data_dir` in `board.py` moves `~/.papertrail/<ns>` across (roster token, board pull key), and `me.html` carries over its `pt-me-*` localStorage keys. No legacy `research-plans`/`rp-*`/`pb-*` dual-read code is left in this tree by design. If you find a `research-plans`, `RESEARCH_PLANS_*`, `rp-*`, or `pb-*` reference somewhere in `aict/` (outside a handful of intentional historical mentions of Planboard's own prior name in `README.md`, `AGENTS.md`, `CHANGELOG.md`, and `docs/plan-rubric.md`'s attribution line), treat it as a leftover that should be cleaned up, not as intentional compatibility code to preserve.

## Anti-cheating / academic-integrity design

Several rules in this repo exist specifically to keep the tool from becoming a way to launder ungoverned or AI-authored work into a graded paper. When touching `commands/plan.md`, `commands/sign.md`, `commands/adopt.md`, `commands/report.md`, or `skills/managing-aict/templates/claude-md-section.md`, preserve these controls rather than treating them as ordinary prose:

- **Low-Decisions sign-off guard** (`plan.md`, `sign.md`). Before a plan whose "Decisions and reasons" rubric channel scored below 2/3 is signed, the AI must recommend revising it first. If the student signs anyway, that override is logged to `decision-log.md` as an explicit entry — never silently absorbed. This keeps a rubber-stamped, shallow-reasoning plan from acquiring the same unremarked legitimacy as a well-reasoned one.
- **Retrospective-adoption warning** (`adopt.md`). `/aict:adopt`'s retrospective plans are the main way a student could do analysis entirely outside the tool and then fabricate a plausible-looking plan and decision log after the fact. The command warns against using it to backfill legitimacy for a graded component without instructor approval, and points to the rubric's mechanical `unsupported-sources` integrity flag as the existing safeguard against undated, unsupported retrospective sourcing.
- **No AI-authored interpretation** (`claude-md-section.md` rule 11). The AI may draft directions, play devil's advocate, and critique, but it must never write the paper's sociological interpretation/argument on the student's behalf. If it drafts interpretive prose as a starting point, it must immediately log a decision-log entry flagging that the text is AI-drafted and not yet revised in the student's own words, so the gap can never be silently carried into the final paper.
- **AI Assistance Disclosure** (`report.md`). Every generated report renders a disclosure table from the `modelUsage: {model, effort}` data already captured per plan/results bundle, so which stages used which model is a verifiable part of the record, not a claim anyone has to take on faith.
- **Comment-only instructor role** (`board.md`). The instructor can read, annotate, and comment on the board, but has no sign or approve action anywhere in the tool — plan sign-off is exclusively the student's action. Do not add an instructor sign/approve capability; that boundary is deliberate, not an oversight.

## Working rules

Keep changes limited to the requested work. Preserve unrelated changes in a
dirty worktree. Stage files by explicit path.

Canonical plan versions and finalized result bundles are immutable. A change
must not weaken sign-off binding, stale-client checks, checksum validation, or
retry safety. Do not weaken any of the academic-integrity controls listed
above either — they are enforced the same way as the mechanical gates: as
documented steps in the prompt-driven commands and skill references, not as
code, so "weakening" them looks like quietly deleting or softening a
paragraph, not just changing a script.

## Validation

Before completing a code change, run:

```sh
python3 -m pytest tests/ -q
(cd board && npm test && npx tsc --noEmit)
(cd skills/managing-aict/assets/web-template && npm test)
(cd skills/managing-aict/assets/classroom-template && npm test && npx tsc --noEmit)
```

If `board/src/` changes, run `cd board && npm run build`. Commit the regenerated
`skills/managing-aict/assets/board-template.html`. Run the build again and
require a clean diff for that template.

## Release policy

Every PR that changes shipped code or behavior is a release. Use a patch bump
by default. Use a minor bump for a larger feature.

Keep these versions identical:

- `.claude-plugin/plugin.json`
- `board/package.json`
- The root package fields in `board/package-lock.json`

Run `cd board && npm install --package-lock-only` after changing the version.
Add the new version as the first release entry in `CHANGELOG.md`.

Documentation-only, test-only, and maintenance-only PRs do not require a
version bump.

## Code Review Rules

- Flag changes that weaken immutable artifact handling, sign-off binding,
  content-hash checks, stale-client protection, or idempotent retries.
- Flag changes that weaken or quietly remove any of the academic-integrity
  controls listed above (the low-Decisions guard, the retrospective-adoption
  warning, the no-AI-interpretation rule, the AI Assistance Disclosure, or the
  instructor's comment-only boundary) unless the PR explicitly and
  deliberately changes that policy.
- Do not reintroduce `research-plans`/`rp-*`/`pb-*` dual-read compatibility
  code — this project has no installs that need migrating, so a PR proposing
  such a reader should be questioned, not assumed correct.
- For board lifecycle changes, check persistent, sign-session, hosted, offline,
  and stale-tab paths. Do not assume one mode represents all modes.
- Treat reported model provenance as self-attested. Do not present it as
  confirmed runtime identity.
