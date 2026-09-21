# Adopt, reconcile, and regenerate results

Load this reference for `/aict:results --adopt`, reconcile mode, or any capture that needs to run a producing recipe. The mechanics script is `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/scripts/results.py`.

## Adopt existing results (`--adopt`)

For pre-existing figures and tables made before or outside any plan, run `python3 <script> discover`, present the candidates grouped by directory, and interview the student: which artifacts matter, and which component each belongs to. Offer to add a tracker row for work that has no component yet; derive its status from evidence and note `retrofit`.

For each component, follow inline steps 4 through 7 in `commands/results.md` with `provenance` set to `"retrofit"` and `planVersion` set to the latest governing plan version or null. The governing version is the latest canonical plan with a valid signed or amendment trailer. Validation records `not-applicable` as defined by inline step 6. Retrofit bundles use the same review and Reopen flow as other bundles; the provenance chip keeps the record honest.

## Reconcile missing results (no argument)

Build the worklist from the tracker and disk for a project whose plans ran ahead of its results record:

- Components with a done-family status or `in progress` whose `plans/execution/<NN-slug>/results/` has no `r*/` bundle.
- Components whose latest bundle has drifted sources according to `python3 <script> changed --component <NN-slug>`.
- Leftover `results/.staging-*` directories from interrupted captures. Offer to resume or discard them.

Present the worklist and let the student choose whether to walk all, pick some, or skip. For each selected component, in tracker order, follow inline steps 2 through 7 in `commands/results.md`. Apply the provenance rule from inline step 5 to each bundle:

- A prospective governing plan that predates the work gets `provenance: "planned"` and `late: true` because this is a backfill. Its canonical trailer may be signed or amendment.
- A `Provenance: retrospective` plan, or no plan, gets `provenance: "retrofit"`. `planVersion` still cites the retrospective version when one exists.

After `/aict:adopt`, every done component has a retrospective plan, so its backfilled bundles are retrofit, not planned. The plan links them through `planVersion` without claiming to have governed them. Report a component with no qualifying evidence as such and, if the student agrees, add a one-line tracker note. The only zero-artifact bundle that can be finalized is a retrospective report whose figures cannot be reproduced, and only after explicit confirmation under [Summary-only bundles](#summary-only-bundles).

Finish by opening one board session for view-only review over everything captured. Never capture all components silently in bulk. In a manual capture the per-component interview is the verification; in the execution loop the verification is the mechanical validation pass plus the student's Reopen right over an agent-curated, `curatedBy`-labeled bundle. Silent bulk writes are how plan theater starts — both modes stay visible and evidence-based.

## Regeneration and run recipes

### Reproducibility-first capture

When a component has runnable producing code, reproduce its outputs instead of scavenging stale files. Identify the recipe from the plan's `Verification` or build steps, this session's context, or the latest bundle's `producedBy` on a recapture. Ask the student when it is unclear. A recipe is a producing script plus these fields:

- `command`: infer it from the script extension. Use `Rscript` for `.R`, `python3` for `.py` with `python` as a fallback, and `bash` for `.sh`. Unsupported interpreters such as Stata `.do` have no inferred recipe; ask for the command or stop, and never treat them as "no code."
- `cwd`: repo-relative, defaulting to the repo root.
- `args`: the producing command's arguments.
- `expectedOutputs`: repo-relative files the run should produce.
- `approvedHash`: the sha256 of the script source at approval, used as the trust gate for an automatic run.

### Running a recipe

Resolve the script and confirm that it is repo-relative and inside the repo. Reject `..` paths and symlink escapes. Run automatically without asking only when the script's current sha256 matches `approvedHash`; otherwise show the exact command and ask first. Record a run-start timestamp, then run from `cwd` with `set -o pipefail`, teeing stdout and stderr to `logs/$(date +%Y-%m-%d_%H-%M-%S)_results-regenerate-<slug>.log`.

Stop the capture and build no bundle when the run exits nonzero, or when any `expectedOutput` is missing or was not created or modified after the run-start time. Cite the log. Run only this component's recipes, never unrelated code. A capture regenerated in this session is not `late`; a retrospective capture that reused old files or is report-only remains `late: true`.

### Summary-only bundles

A zero-artifact bundle can be finalized only for a retrospective, `--adopt`, or reconcile capture when the student has a report to record but the figures cannot be reproduced because there is no runnable recipe or the sources are gone. The student must explicitly confirm it. An initial or planned capture of a fresh component with nothing to reproduce stops without a bundle, as required by inline step 2 in `commands/results.md`; the board shows its top-level empty state. The board renders a "summary only" notice on the report-only bundle so its empty gallery reads as expected rather than broken.
