<!-- aict:master-plan -->
# <Project name> — Paper Plan

Last updated: <YYYY-MM-DD>
Initialized: <YYYY-MM-DD HH:MM>
Detail level: <compact | standard | full>
Paper type: <quantitative | review>
<!-- Initialized is the adoption cutoff: nothing before it is loggable, and nothing before it counts as a deviation — no plan governed that work. Never edit it — a renewal copies it forward unchanged. -->
<!-- Detail level sets how much of each plan the board shows by default: compact = the contract (context, goal, decisions, boundaries); standard = + approach, steps, verification; full = + agent-detail code blocks. Every plan is authored in full; this only sets the default collapse, and any reader can toggle. Default: standard. -->
<!-- Paper type is set once at init from the paper-type question and never changes on its own — it decides which CLAUDE.md conventions block (rules 7 and 9) is installed, and how the Components table's second column is labeled below. A renewal copies it forward unchanged, same as Initialized. -->
Renewed: <YYYY-MM-DD — one line: the new direction and why; names the archived plan. Written only by /aict:renew; delete this line otherwise.>

## Project context

<Two or three paragraphs: what this research project is about and what it is trying to find out — the questions, the data, key constraints. This is the project's frame, not a history of what has happened in the repository. Written once at init; edit only when the project itself changes direction.>

### Research questions

1. RQ1: <the first research question, phrased as a question>
2. RQ2: <the second, if any — delete unused lines>

## Components

| # | <Analysis step | Review step> | Status | Execution plan | Outcome / notes | Serves |
|---|-----------|--------|----------------|-----------------|--------|
| 1 | <e.g., data preparation — or, for a review: search strategy> | not started | — | — | — |
| 2 | <e.g., descriptive analysis — or, for a review: screening> | not started | — | — | RQ1 |

Statuses: `not started` / `planned` / `in progress` / `done` / `dropped`.

Components are **research activities in service of the research questions**; the Serves column names which (`RQ1`, `RQ1, RQ2`, or `—` for genuine infrastructure such as data acquisition). Components are never a chronology of repository actions: what already exists in the repo informs **Status**, never the component structure.

Keep **Outcome / notes to one line per component**. Detail belongs in that component's execution plan and in `decision-log.md`, not here.

**Numbering.** The `#` is a **stable identifier**: assigned once, never changed, never reused (a `dropped` component keeps its number). It is not a sequence — the **table row order is the work sequence**, and rows may be reordered freely to reflect how the work actually ran, so numbers can sit out of order down the column. A component's number and slug never move: its execution plan (`execution/<NN-slug>/`) and any finalized results bundle are addressed by that slug forever. To show a late-adopted component in its true place, move its row — never renumber it.

## Foundations

<Only after a renewal — delete otherwise. What this renewal builds on: the archived master plan (plans/archive/master-plan-<date>.md), which prior components were carried over and which were left archived (one line of reason each), and pointers to reusable prior assets (data, cleaned panels, scripts).>

## Sequencing notes

<Optional. Use only when dependencies are non-linear. Delete this section otherwise.>
