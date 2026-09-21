---
description: Archive the master plan and start a new direction while preserving component numbering and reusable work
argument-hint: [optional: one-line description of the new direction]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(git:*), Bash(ls:*), Bash(date:*), Bash(mkdir:*), Bash(mv:*), Bash(python3:*)
---

Renew a project: keep the accomplishments, change the direction. Skill context: `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/SKILL.md`. This is the forward-looking counterpart to `/aict:adopt` (which reconstructs what already happened under the current direction): renew archives the current master plan, writes a fresh one for the new target, and carries forward the prior components the student still relies on. Prefer renew over adopt when initiating the workflow in a repo full of exploration the student wants to take somewhere new.

This is an optional, advanced command — most students never need it. Reach for it only if the paper's direction changes mid-semester (e.g. the research question shifts after early findings or advisor feedback) and the existing master plan and components need to be re-pointed at the new target.

1. **Preflight.** Resolve the project root (as in `/aict:init` step 1: `git rev-parse --show-toplevel`, confirm with the student if it differs from the current directory). Detect state: **initialized** (`plans/master-plan.md` with its marker) or **uninitialized** (an exploratory repo). If initialized, suggest committing the current `plans/` state first — the archive move is about to restructure it. `$ARGUMENTS`, if provided, seeds the new direction; confirm rather than re-ask.

2. **Inventory the existing work (read-only).** Cluster the repo's history into activities the way `/aict:adopt` step 2 does: `git log --format='%ad %h %s' --date=short` by period, top-level directories, script and output inventories, in-repo planning docs. Ask where any out-of-repo plan docs live — **never scan outside the repo unprompted**. On an initialized repo, also read the current master plan and tracker. Produce a short prior-work inventory: what was accomplished, which assets (data, cleaned panels, scripts, results) are worth reusing.

3. **Interview the new direction** (AskUserQuestion; proposals INSIDE the options): the new target and research questions (they become RQ1, RQ2, …), what changes about data or constraints, and the **target journal** for figures/tables (it fills rule 7 of the CLAUDE.md block; "none yet" writes generic publication-quality defaults). Then propose the new components (each with a `Serves` entry), derived from the new research design — the inventory informs status and reuse, never structure. Confirm the list.

4. **Carry-over (initialized repos only).** Walk the current tracker rows with the student (multi-select): **carry over** (the new plan still relies on it) or **leave archived**. Carried rows keep their number, slug, execution dir, status, plan link, and results untouched; only their `Serves` is re-mapped to the new RQs (or `—`). Everything else lives on in the archive only — still browsable on the board's Archive view, never nagged about.

5. **Archive (initialized repos only).** Confirm with the student immediately before acting, then `mkdir -p plans/archive` and `mv plans/master-plan.md plans/archive/master-plan-$(date +%Y-%m-%d).md` (append `-2`, `-3`, … if that name exists). Archived plans are immutable — the sign-off hook denies edits; treat the file as a record.

6. **Write the fresh `plans/master-plan.md`** from `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/templates/master-plan.md`: the marker on line 1; new Project context; new `### Research questions`; components table = carried rows first (verbatim except Serves), then the new components at **next-available numbers** — the max across current rows, every `plans/execution/*/` dir on disk, and every archived tracker, plus one; numbers are never reused across renewals. `Initialized:` is **copied from the archived plan unchanged** (the honesty cutoff survives renewal; on an uninitialized repo stamp it now, `date +"%Y-%m-%d %H:%M"`). Fill the `Renewed:` line: `Renewed: <YYYY-MM-DD> — <one line: the pivot and why>; supersedes archive/master-plan-<date>.md` (omit the line on an uninitialized repo — nothing was renewed away from). Fill `## Foundations`: what was carried vs left archived (one-line reason each) and the reusable prior assets from the inventory; delete the Sequencing notes section unless dependencies are non-linear. Create `plans/execution/<NN-slug>/` dirs for the new components. On an uninitialized repo also create `plans/decision-log.md` from the template and `plans/execution/.gitkeep` (Write tool, not `touch`).

7. **Bind conventions in CLAUDE.md** exactly as `/aict:init` step 6 (create / append / replace the marked block), including rule 7 with the journal answer from step 3 — preserve an existing `target journal:` value unless the student changed it here.

8. **Log the renewal.** Append a decision-log entry (real timestamp via `date +"%Y-%m-%d %H:%M"`): the old direction, the new one, why, what was carried vs archived. On an uninitialized repo this is the log's first entry.

9. **Offer the follow-ups — never run them unasked:** `/aict:adopt` for carried (or newly added prior-work) rows that lack execution plans — adopt's step-1 hand-built-tracker path consumes the confirmed rows as-is; `/aict:results --adopt` for pre-existing figures/tables worth bundling; `/aict:plan` to scope the first new component.

10. **Wrap up.** Verify every artifact from steps 5–7 exists on disk and report only what exists — if a write was denied or skipped, say so plainly. Suggest a commit such as `plans: renew — <old target> → <new target>` (do not run without approval).
