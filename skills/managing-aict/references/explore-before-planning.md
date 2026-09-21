# Explore Before Planning

Plans written after a bounded look at the data are better plans. Scope decisions become grounded choices ("treat 97/98 as missing; the codebook confirms they are refusals") instead of guesses ("handle missing values appropriately"). For any data-facing component that has not been explored yet, offer a short exploration before authoring the plan.

## What a bounded exploration is

- **Timeboxed and read-only.** Look at the data; do not build anything. Descriptives, distributions, missingness, codebook checks, a handful of cross-tabs. No models, no cleaning, no outputs that could tempt post-hoc planning.
- **Targeted at the decisions.** Explore what the Scope decisions table will need: candidate variables and their coverage, coding quirks, sample sizes after plausible restrictions, obvious data problems.
- **Reported back, not acted on.** Findings go to the student as input to the planning dialogue.

## Where findings go

- Findings that shape a choice → the **Why** column of the Scope decisions table.
- Surprises (a variable is unusable, a category is nearly empty, the panel is unbalanced) → an entry in `plans/decision-log.md`, since they change what happens next.

## The line to hold

Exploration informs the plan; it must not quietly become the analysis. If exploration starts producing results the student wants to keep, stop. That work belongs under a signed or recorded plan. See `sign-off.md`.
