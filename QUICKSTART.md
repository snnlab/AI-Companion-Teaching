# Quickstart

This is the short path from install to your first plan-review-execute-tail loop. It assumes Claude Code is installed and you have a paper project (new or ongoing) in a folder, ideally a git repository. For what the plugin is and why you'd use it, see the [README](README.md); for the full reference on every command and the board, see [docs/reference.md](docs/reference.md).

Throughout, we'll use a running example from a sociology quantitative-methods course: a student comparing a cross-lagged panel model (CLPM) against a random-intercept cross-lagged panel model (RI-CLPM) for a longitudinal question about social status and well-being. **Writing a literature review instead?** The mechanics below are identical — only the examples are quant-flavored — see [docs/review-papers.md](docs/review-papers.md) for the equivalent walkthrough (search strategy, screening, extraction, PRISMA diagram).

## 1. Install the plugin

In any Claude Code session:

```
/plugin marketplace add snnlab/papertrail_v0
/plugin install aict@aict
```

Restart Claude Code. Type `/aict` and the commands should appear in the menu. Use the full namespaced names (`/aict:init`, not `/init`, which is a different built-in command).

## 2. Initialize your project

Open Claude Code in your project folder and run:

```
/aict:init
```

Claude opens by asking about the paper itself — a working title and what it's about — then your research questions (they become a numbered list in the master plan), the data, and the course/deadline context (course name, section, when the paper is due). It derives the components (analysis steps) from your research design, with each one naming the questions it serves, and looks at what already exists in the folder only to set honest statuses. Adopting mid-project is fine: work you have already done gets marked `done` or `in progress`, and nothing is invented about the past. It also asks whether to use the recommended per-stage model profile — a strong model for planning, a fast one for execution, a smart one for review — or set your own. Then it creates `plans/master-plan.md`, `plans/decision-log.md`, `plans/model-profile.md`, and a marked section in your `CLAUDE.md`. Commit when it looks right.

For our running example, the interview might land on RQ1: "Does socioeconomic status predict subsequent well-being net of prior well-being, and does that association survive once stable between-person differences are modeled out?" — with components like `01-data-prep`, `02-clpm-fit`, `03-riclpm-fit`, `04-model-comparison`.

## 3. Plan your first component

```
/aict:plan
```

Claude proposes the next component (or name one: `/aict:plan clpm fit`). Expect a dialogue, not a generated document. It will walk through the substantive choices one dimension at a time and ask for your reason on each — for the CLPM component, that means the lag structure, which covariates enter the cross-lagged paths, and how missing waves are handled, each with a reason tied back to RQ1. That is deliberate: the reasons are what make the plan yours. If the data has not been explored yet, it will offer a short read-only look first, which makes for much better scope decisions.

When the plan is ready, Claude scores it and leaves it as a pending draft at `plans/execution/02-clpm-fit/.draft-v1.md`, with the tracker row marked `planned`. Nothing is signed yet. Open the board if you want to read the draft, annotate it, or ask for an extra review — there is no approval button there. The draft signs in the next step, at the execution gate.

**A guard worth knowing about:** if the draft's "Decisions and reasons" channel scores below 2 out of 3 — meaning the consequential choices (like the lag structure) don't yet have reasoning with real depth — Claude will tell you before you sign, and recommend revising the weakest forks first. You can still sign anyway if you're confident, but that override gets logged to `plans/decision-log.md` explicitly, so it's never silently absorbed into the paper's record.

## 4. Sign the plan and execute the loop

```
/aict:execute
```

Signing happens here, right before the work. A slim browser session opens with the pending plan exactly as it will be committed: the text, its rubric score, the diff against the previous version, and any annotations you left. Approve it and Claude writes the signed `plans/execution/02-clpm-fit/v1.md` with a `Signed off:` trailer; request changes and Claude revises the draft, rescores it, and offers the session again. One session handles however many plans are pending, one decision each. If you would rather sign now and execute later, run `/aict:sign` — same session, no execution.

Then one prompt asks whether to execute now, which model to use, and whether to generate a report. Choosing now also authorizes the plan commit; Claude marks the tracker `in progress`, executes the signed plan (fitting the CLPM), captures an agent-curated bundle, validates it, generates the report when requested, updates the tracker and decision log, suggests one commit, opens the finished bundle on the board, and proposes the next component (the RI-CLPM fit). Interpretive choices still come back to you before Claude acts — including how to read the model's coefficients, which stays yours to write.

Choose later and re-enter the same prompt any time:

```
/aict:execute clpm fit
```

The loop normally runs without another stop. If validation finds a deviation while the bundle is still staged, it pauses once: revise the plan, fix the work, or accept and log the deviation. The selected remedy finishes the same bundle exactly once.

## 5. Capture and verify results

The execution loop captures results automatically. For work done outside it — or when you want to recapture manually — run:

```
/aict:results clpm fit
```

Claude proposes the artifacts (figures, tables, key numbers — say, the cross-lagged path coefficients table) it can trace to the work, you confirm titles and captions, and it writes an immutable bundle at `plans/execution/<component>/results/r1/` — a brief report, snapshot copies of the files, the exact scripts that produced them, and two automatic advisory checks: a **validation** that compares the signed plan (or its recorded amendment) against what actually ran, and a mechanical **integrity** check (do the artifact checksums match, is every finding backed by an artifact). Both are sealed into the bundle, along with a mechanical **output score** — fidelity, attainment, and integrity, 0 to 3 each — derived from them. The score is a diagnosis, never a gate.

Then open the board on it: the **Output & Validation** view shows the score chips with their derivation, the validation and integrity results, the numbers as tiles, the figure/table gallery, and a click-through to each producing script; the narrative report lives on the Reports view with version chips (a bundle with nothing substantive to report gets no report). Validation is the bundle's standing state and sets the tracker's done-family status. To request a change after finalization, press **Reopen** with comments. Claude fixes the scripts, re-runs, and captures `r2`; `r1` stays exactly as you reviewed it.

Started using the plugin mid-project? `/aict:results --adopt` scans your output folders and brings existing figures and tables under verification, marked `retrofit` — see the warning in `/aict:adopt` about instructor approval before adopting graded work this way.

## 6. Optional: review a plan before executing

```
/aict:review
```

The review scores the plan on five things, each from 0 to 3: whether the goal and success criteria are clear enough for someone else to check; whether the consequential decisions carry real reasons tied to the research goal (the heart of it — a choice you made, approved, or reached together all count); whether the steps are concrete enough to tell if they were done; whether the plan includes a way to test that it actually hit its goal; and whether it says what is out of scope and what not to touch. For the RI-CLPM component, for instance, it would check whether the plan states *why* random intercepts are being added (not just that they are), and whether "success" is defined as something checkable (e.g., a likelihood-ratio test against the CLPM, not just "see if it fits better"). It reports the five numbers as a profile, names the biggest gap ("where the most is being handed to the agent"), and lists the specific decisions to fix next. The numbers are a diagnosis to act on, not a pass or fail.

## 7. Write the report

```
/aict:report
```

Assembles a standalone report from a results bundle: background and goal, data and methods, findings (each finding's figures and tables embedded right beneath it — the CLPM vs. RI-CLPM comparison table, say), a validation summary, a provenance appendix, and an **AI Assistance Disclosure** section — a small table showing which model ran the `plan`, `execute`, `plan review`, and `results validation` stages for this component, built entirely from data already captured along the way, with a pointer to the decision log and the bundle as the underlying verifiable record. This section is meant to be left in when the report material feeds into the paper's methods note — it is the honest, checkable version of "which parts had AI involvement."

## 8. See the whole project on the board

```
/aict:board
```

This opens a dashboard in your browser: the tracker as a status board, every plan version with diffs and its rubric score in the header, the decision log as a timeline, generated reports with version chips, and a Models tab where you can see and adjust which model runs each stage. It is also where reviewing a plan feels best: select any text to attach a comment, add general comments on any view, then press "Send to Claude". Your comments come back to the session, where Claude walks through them with you, proposes plan revisions where you approved changes, and records the exchange in the decision log. Don't want to write the feedback yourself? Press **Review with** (on a plan, the master plan, or a results bundle) and Codex, Gemini, or a Claude subagent produces the section-anchored comments for you — they land on the board as pending annotations you curate, then route exactly like your own. Signing a plan is the one thing that does not happen here; that is the slim session in step 4.

**Opening the board without Claude.** Init writes a small `./aict-board` script into your project, and every board open writes or refreshes it (so a project you started earlier picks it up the next time you open the board). Run `./aict-board` in a terminal, or `!./aict-board` inside a session, and the board opens with no model in the loop — it reconnects to a board that is already running, or serves a fresh one. This is the way in when your Claude session is rate-limited or you just want to read. Anything you send from that board is saved to disk and picked up the next time you run `/aict:board` in a session. The file is specific to your machine and is excluded from git, so it never enters a commit.

To share the project state with someone who does not use Claude Code — typically your **instructor**:

```
/aict:board --export
```

This writes `plans/board.html`, one self-contained file that opens in any browser, offline, read-only (result figures are embedded). One caution, same as committing plans: the file contains everything under `plans/` — including result figures, tables, and script snapshots — so sharing it is publishing your plans and results.

To get feedback from an instructor who does not use Claude Code, `/aict:board --share` emails just as easily — they annotate in their browser and send back a feedback file that `/aict:board --collect <file>` routes into your session with attribution. For an instructor to read and comment from their own browser without any file exchange, `/aict:board --publish-web` publishes to a private, password-protected link — a one-time setup of about 20 minutes, walked through in [docs/hosting-the-board.md](docs/hosting-the-board.md). In every one of these modes, the instructor can comment and annotate but never sign or approve a plan — that stays the student's action alone.

## How versioning works

A plan moves through two stages, and knowing them explains every version number you see on the board.

First you draft and revise. When you run `/aict:plan`, the plan starts as a draft at `plans/execution/<component>/.draft-v1.md`. A draft is a working copy that you can change as many times as you want. Each time you ask for changes, the previous state is saved as a numbered snapshot, `v1-draft-1.md`, then `v1-draft-2.md`, and so on. The board shows these as `v1·d1`, `v1·d2`. They are your revision history, and the plan stays version 1 the whole time.

Then you sign off, and that creates the version. Signing off does two things. The plan is frozen so it can never be edited again, and it is written as `v1.md` with a `Signed off:` line. This happens at the execution gate in step 4, or on its own with `/aict:sign`. The signed `v1` is the plan of record.

After you sign off `v1`, the next round of changes starts a new draft at `.draft-v2.md`, which you revise the same way (`v2·d1`, `v2·d2`) until you sign it as `v2`. This is why a change made after sign off shows up as the next version. The sign off is the line between one version and the next.

One other path creates a version. If the work ends up different from what the signed plan said, `/aict:sync` records the difference as an amendment and writes the next version with an `Amendment recorded` line instead of a sign off. This way the record shows what actually ran.

Reviewing a plan does not change the version. `/aict:review` and the board's **Review with** button read the plan and score it against the rubric, then write that score to a separate scorecard. You can review a draft or a signed version at any point, as many times as you want, and the version does not move. A review can lead you to revise the plan, and that revision is a normal change that stays in the current draft until you sign off. The review on its own never advances the version.

Keep one label separate. On the board, `r1`, `r2` are results bundles, the captured outputs of a run (step 5), not plan revisions.

## FAQ

**My project is not a git repository.** Everything works, but the plugin loses git-based evidence (commit timing, staleness checks) and will say so. A git repository is strongly recommended since the version history is part of the point.

**I already did half the work before adopting this.** Mid-session and mid-project adoption is supported: prior work informs the plan (context, research questions, statuses, scope reasons), never the decision log. The log starts at initialization and is never backfilled. For substantial already-done work, `/aict:adopt` goes further — it decomposes the work into components, drafts a full **retrospective** plan for each (honestly labeled, signed together in one sign session), and reconstructs the pre-adoption decisions into `plans/history.md`, kept out of the real-time log. Retrospective adoption is not a way to backfill legitimacy for a graded component after the fact without your instructor knowing — see the warning in `/aict:adopt`. And when the point of starting the workflow is to take the existing exploration in a NEW direction — a new target, new questions — use `/aict:renew` instead (an optional, advanced command most students never need): it writes a fresh master plan for the new direction, keeps your accomplishments as carried components, and leaves adopt for the pieces you want retro-planned.

**I use Claude Code's plan mode.** Fine. If a plan gets approved through plan mode, Claude copies it into the component's next version slot so the repository record stays complete.

**Which model runs each step?** A per-project profile (`plans/model-profile.md`, written at init) maps each stage to a model: a strong one where planning quality compounds, a fast cheap one for interactive execution, a smart one for short review and validation judgments. Interactive stages just *nudge* you to switch model (you decide; switching mid-conversation is safe); delegated stages like review and validation run in generated `aict-*` agents pinned to the profile. Edit it any time with `/aict:models` or inline on the board's Models tab. Projects without a profile behave exactly as before.

**My project is small.** Use fewer, larger components, and let the Scope decisions be a short list instead of a table. If maintaining the structure feels like more work than the paper, that is real feedback; raise it with your instructor.

**What about sensitive material?** `plans/` is designed to be committed and eventually shared. Keep participant details, IRB specifics, and anything else sensitive out of the plans, or in a gitignored appendix.

**Claude stopped logging decisions mid-session.** It happens; the CLAUDE.md section makes it likely but not guaranteed. `/aict:sync` exists exactly for this. Late captures are labeled so the log stays honest.

**What is this hook the plugin installs?** One PreToolUse hook, the sign-off gate. It runs a small local python script on Claude's file writes; for anything that is not a plan-version write in an initialized project it does nothing (a few milliseconds). A write of a new plan version opens the same sign session described in step 4, and the hook always denies edits to versions that already exist. The one write it lets through unsigned is a `/sync` amendment, which is stamped `Amendment recorded, <date>` rather than signed — and re-executing that plan makes Claude sign a fresh commitment first. The script is plain readable python in the plugin repo.

**I work over SSH or run headless tests.** Set `AICT_NO_GATE=1` in that environment. The bypass prints a notice into the transcript so it is never silent. An unanswered gate times out and denies; nothing is written without approval.

**Will the AI write the interpretation section of my paper for me?** No — by design. It will draft directions, play devil's advocate, and critique your argument, but the final interpretive sentences have to be yours. If it ever drafts interpretive prose as a starting point, that gets logged to the decision log as an explicit flag ("AI drafted interpretive text, student has not yet revised it in their own words") so it's never silently treated as finished, submittable prose.

## Feedback

Friction, confusion, rubric disagreements, ideas: raise them with your instructor or however this course collects feedback on the tool.
