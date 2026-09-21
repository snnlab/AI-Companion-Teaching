# When to Split a Plan

The question is never whether an agent *could* execute a long plan. It usually could. The binding constraint is **human readability and manageability**: a plan the student cannot hold in mind is a plan the student cannot meaningfully govern, revise, or sign.

## Split when any of these hold

1. **Multiple independent components.** The plan covers work that could be completed and verified separately — data cleaning and analysis and a simulation are three components, not one plan. Rule of thumb: if two parts could be done in either order, or by different people, they are separate components.
2. **No single verification.** You cannot state one Verification section that covers the whole plan without it becoming a list of unrelated checks.
3. **Too long to govern.** The student would skim rather than read it. If the Scope decisions table mixes decisions about unrelated stages, the plan has outgrown one component.
4. **Different data dependencies.** One part needs outputs that another part produces. The downstream part cannot be honestly planned until the upstream part has run; plan it after.
5. **Repeated fielding — waves and rounds.** Each collection round, pilot wave, retest, or re-fielding is its own component (`<activity>-wave-N` / `<activity>-round-N`), even when one wave is small: it has its own data, dates, quotas, and verification, and its own results bundle and validation state. A wave under an unchanged design is not a plan deviation — the plan states its `Stopping rule:` up front, and the series ends when that rule is met; a *method* change between rounds (a redesigned pipeline) is a new component by rule 1. The extra plan is made cheap by `/aict:plan`'s wave fast-path, not by merging.

## Do NOT split when

- The plan is long but about one coherent task (a single analysis with many steps is still one component).
- The parts are trivially small. A component should be worth its own plan; do not create three plans where one afternoon's work needs one. **Exception: repeated fieldings — waves and rounds — are never merged for being small (split item 5); each wave's own data and verification is the reason, and the fast-path absorbs the cost.**
- The only motive is tidiness. Splitting has a cost: more files, more tracker rows, more sign-offs.

## Mechanics of a split

1. Name the resulting components and add a tracker row for each in `plans/master-plan.md` (sequence = table order; use Sequencing notes if dependencies are non-linear).
2. Give each component its own directory: `plans/execution/<NN-slug>/`.
3. Author an execution plan only for the component being worked on next. Downstream components stay `not started` until their turn — their plans will be better for being written after upstream results exist.
4. If a split happens mid-flight (execution revealed the component was really two), record the decision in the log, mark the original component appropriately, and version its plan rather than silently rescoping it.

The master plan holds the sequence; each execution plan holds one component's reasoning. That is the division of labor.
