---
name: managing-aict
description: Use when working in a research repository initialized for the aict workflow (plans/master-plan.md exists AND the repo's CLAUDE.md contains the aict marker) — when a session starts there, when the student asks to adopt the workflow mid-session after exploratory work has begun, when executing analysis or data work, when a decision point arises with the student, when work deviates from an execution plan, or when the student mentions the master plan, an execution plan, or the decision log. Not for software project planning, and not for repositories without both markers.
---

# Managing AICT

## Overview

**The student plans and decides; you carry the bookkeeping.** The project keeps a master plan
(roadmap + components tracker), one versioned execution plan per component, and an append-only
decision log. Keep those three truthful without the student having to think about them.

Artifacts are organized around **the research project and its questions**: the master plan carries
numbered research questions (RQ1, RQ2, …) and every component serves one or more of them (the
`Serves` column; `—` for genuine infrastructure). Components are research activities, never a
history of repository actions.

## When NOT to use (hard gate)

This skill applies only when **both** opt-in markers exist:

1. `plans/master-plan.md` containing `<!-- aict:master-plan -->`
2. The repo's `CLAUDE.md` containing `<!-- aict:start -->`

If either is absent, this workflow does not apply. Stay silent about it, never create `plans/` uninvited, and never suggest initializing unless the student asks. A stray copied `master-plan.md` without the CLAUDE.md marker does not count as opt-in. For software implementation plans, use superpowers writing-plans instead.

## Core pattern

**Session start.** Read `plans/master-plan.md`, then the latest `vN.md` for whichever component the
work touches (`plans/execution/<NN-slug>/`).

**During work.**
- Surface interpretive choices (variable selection, case exclusions, coding rules, model
  specification) to the student *before* acting. Never decide research questions, analytical
  choices, or interpretation on their behalf.
- Append to `plans/decision-log.md` **as decisions happen** — a clarifying question, a scope
  change, a non-trivial interpretive call (flag it), a surprising result that changes what comes
  next. Format in `templates/decision-log.md`, real timestamp (`date +"%Y-%m-%d %H:%M"`). If
  unsure whether to log it: log it.
- If work is about to exceed what the plan covers, pause and say so. The student rescopes, or you
  draft a new version. Do not drift.

**After execution work.** Update the component's tracker row (status + one-line outcome) when
there is real evidence — outputs on disk, commits — and `Last updated:`. A material deviation
becomes `v<N+1>.md` with a `Supersedes` line; `/aict:sync` records the amendment, and re-execution
recommits it through a sign session first.

**Mid-session adoption.** The workflow can be adopted after exploratory work has begun. What the
session established feeds the plan — context, questions, goals, scope reasons — **never the log**.
The log starts at the master plan's `Initialized:` timestamp; nothing before it is loggable or
counts as a deviation.

**Model nudge.** If `plans/model-profile.md` exists, run
`python3 <this skill's directory>/scripts/models.py stage execute` once at the start of execution
work and relay its one-line nudge. Empty output → say nothing. Details in `commands/execute.md`.

## Three rules you cannot get wrong

- **Versions are immutable, and a hook enforces it.** `v1.md, v2.md, …` are never overwritten or
  edited. A revision is a new version. The PreToolUse hook admits a new canonical version only
  through a valid sign-session ticket or `/sync`'s amendment path.
- **The log is append-only and real-time.** Never backfill at the end of a session. Late captures
  go through `/aict:sync` and carry the `(late-captured at sync)` label. Pre-adoption decisions go
  in `plans/history.md`, never the log.
- **Numbers are stable identifiers.** A component's `#` and slug are assigned once and never
  change, move, or get reused. Work sequence is the table row order — reorder rows, never renumber.

The most expensive mistakes: backfilling the log to look thorough; editing an existing version
"to fix a typo"; deciding for the student because the choice seems obvious.

## Artifacts

| Artifact | Path | Rule |
|----------|------|------|
| Artifact | Path | Rule |
|----------|------|------|
| Master plan | `plans/master-plan.md` | Tracker + context; one-line outcomes |
| Execution plans | `plans/execution/<NN-slug>/vN.md` | One component each; versions immutable |
| Decision log | `plans/decision-log.md` | Append-only, timestamped, real-time |
| Reconstructed history | `plans/history.md` | Pre-adoption record; date-granularity, evidence-cited; not the log |
| Drafts | `plans/execution/<NN-slug>/.draft-vN.md` | Unsigned, mutable, gitignored; deleted on sign-off |
| Draft iterations | `plans/execution/<NN-slug>/vN-draft-K.md` | Committed snapshot of each drafting round; kept on sign-off; immutable by convention, read-only on the board |
| Results bundles | `plans/execution/<NN-slug>/results/rN/` | Immutable once finalized; legacy verdict.json remains readable but v0.20 does not write it |
| Results staging | `plans/execution/<NN-slug>/results/.staging-*/` | Mutable, gitignored; finalized via results.py |
| Saved reviews | `plans/reviews/<NN-slug>-vN.md` | Rubric scorecards; prose and JSON fence agree |
| Archived master plans | `plans/archive/master-plan-<date>.md` | Immutable renewal record; readable on the board's Archive view |
| Reports | `plans/reports/<NN-slug>-rN-report.{md,pdf,docx}` | Derived, regeneratable, committed; never part of the bundle; figures embedded under findings; first-line aict-report marker |
| Board snapshot | `plans/board.html` | Read-only export; regenerate, never hand-edit |
| Model profile | `plans/model-profile.md` | Per-stage model/effort; committed; edited via `/aict:models` |
| Generated agents | `.claude/agents/aict-*.md` | Committed, ownership-marked; regenerated by `/aict:models`, never edited by hand |


## Where the rest lives

Load from `references/` only when the task turns on it:

| File | Covers |
|------|--------|
| `conventions.md` | Provenance, renewal, trailers, retrofit, output conventions, model profiles, the full mistakes list |
| `results-bundles.md` | What a finalized bundle contains, field by field |
| `capture.md` | The staging → manifest → validate → finalize procedure |
| `execution-loop.md` | The `/aict:execute` loop, deviation stop, outcome matrix |
| `sign-off.md` | Sign sessions, tickets, the finalization transaction |
| `amendment.md` | Recording an amendment and re-committing for re-execution |
| `plan-rubric.md` · `split-criteria.md` · `planning-doctrine.md` · `explore-before-planning.md` | Plan quality: scoring, when a plan is too big, the authoring standard, bounded exploration |
| `board-routing.md` · `board-review.md` · `board-modes.md` | Routing submitted board feedback, reviewer dispatch, export/share/ingest |
| `results-adopt.md` · `web-publishing.md` | Adopting pre-existing outputs; publishing the board |

**Reporting style.** Report outcomes in a sentence. Do not read plan or bundle content back to the
student — they can see it on the board.
