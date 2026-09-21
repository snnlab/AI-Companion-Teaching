# The execution loop

Referenced by `/aict:execute` and the post-finalize chain in `/aict:plan`. One human question starts execution; after that, capture, validation, report, and bookkeeping run without stopping — the only interruption is the deviation stop below. `/aict:sync` remains the manual recovery checkpoint for work done outside this loop.

## The execute prompt

Ask ONE AskUserQuestion (never re-ask pieces separately) with three parts:

1. **Execute now, or later?** A yes includes consent to COMMIT the signed plan (and its scorecard) first — say so in the question text: the rubric's `uncommitted` integrity flag stays meaningful only when the plan is committed before the work it governs. On "later", stop here; `/aict:execute <component>` re-enters this prompt any time.
2. **Which model?** Pre-select the profile's `execute` row (`models.py stage execute`) whenever it yields a usable non-`inherit` row — empty output (no profile or no usable row) means omit the pre-selection and say nothing. Offer the standard alternatives (opus / sonnet / haiku / a custom id). On any non-`inherit` selection, print the switch line and WAIT for the student to switch (this is the only place the nudge blocks) — never compare against your own identity. When the selection matches the profile row: `Model profile: this stage is set to <model>. Switch with /model <model> if you're not already on it, or continue as-is.` When the student overrides the row: `Execution choice: use <model> — switch with /model <model> if you're not already on it, or continue as-is.` If already on that model the switch is a harmless no-op.
3. **Generate a shareable report when done?** One answer covers every component in this batch. Default yes when the component's previous bundle has a report.

On yes: commit the plan (`plan: <NN-slug> v<N>` + the scorecard file), **set the component's tracker row to `in progress`** (execution start owns this transition — finalize left it `planned`), then execute.

## During execution

Unchanged doctrine — the plan resolves the big choices, but interpretive choices that arise mid-run still surface to the student before acting (CLAUDE.md rule 4), and decisions append to the log in real time. Multiple components run SEQUENTIALLY in this session — never parallel, never dispatched to subagents. Capture the output of substantive analysis commands to `logs/` (`2>&1 | tee logs/<date>_<step>.log`, gitignored) — rule 9's run evidence; local and temporary, never row-level personal data, credentials, or secrets.

## The per-component tail (after the work of one component ends)

Run steps 1–3 per component, without asking anything. Steps 4–5 (report + tracker/log bookkeeping) also run per component. The COMMIT SUGGESTION and the BOARD OPEN do not — they are deferred to **After all components** below.

1. **Capture — agent-curated, into staging.** Follow `references/capture.md` steps 2, 4, 5 in **autopilot** mode (that file defines both modes): candidates from the plan's Verification section, this session's outputs, and `discover`; you author titles, captions, and finding statements, grouped under findings exactly as the interview would have; stamp `"curatedBy": "agent"` into the staged manifest. Every other capture rule holds verbatim (provenance rule, producedBy honesty, journal-ready renders, late flags). Say in the capture summary that the student's remedy for a mis-curated bundle is Reopen → recapture.
2. **Validate the STAGED bundle** (capture.md step 6 verbatim — integrity is computed at finalize; plan-conformance runs now, mechanical status derivation). Nothing is finalized yet.
3. **Branch on the outcome matrix** (below). `deviations-found` → the deviation stop; anything else → **finalize**: run capture.md step 7's finalize mechanics ONLY — `results.py finalize` + verify the printed `rN` exists on disk. The report offer, decision-log entry, board open, and commit suggestion in that step are all owned by THIS runbook: skip them there.
4. **Report** — only if the execute prompt pre-answered yes AND the bundle has substantive findings (the null-result gate holds): proceed into `/aict:report <component> r<N>` in autopilot mode (report.md names it: write the files and return — no commit suggestion, no board offer). The marker records the validation state (schemaVersion 2).
5. **Bookkeeping (the tail carries these /sync jobs):** tracker row per the matrix + a one-line outcome note (amendment or unverifiable detail goes in the note); decision-log entries for session decisions never logged, each headed `## <YYYY-MM-DD HH:MM> (auto-captured)` — amending one later means APPENDING a corrective entry; `results.py changed` for source drift; a component grown past `references/split-criteria.md` → propose the split as tracker rows (no dialogue).
   NOT carried (manual `/sync` only): hosted-comment pulls, adoption-cutoff handling, no-git evidence handling, reconciliation of work done outside this loop.

## After all components

- **One commit suggestion** covering every bundle, report, tracker row, and log entry (`plans: executed — <slugs>; r<N> captured, validated` — do not run without approval). The ONLY commit prompt in the loop.
- **One board open, view-only:** proceed into the full `/aict:board <NN-slug>:r<N>` workflow (the first captured bundle; the student navigates to the rest). Routing stays live for comments/reopen; nothing waits on a verdict.
- **Loop closure:** propose next steps from the tracker in one short message — the next `not started` row(s) in table order; several ready → offer batch planning (`/aict:plan <a> <b> …`); everything done/dropped → point at `/aict:renew`. Never start the next component without the student's word.

## The deviation stop (the loop's only interruption)

Trigger: validation status `deviations-found` on the STAGED bundle. Nothing has been finalized; write NO tracker status yet. Present the deviating steps/criteria with their evidence, then ask ONE AskUserQuestion with three remedies — each ends by continuing the tail at step 3's finalize:

- **Revise the plan** — record `v<N+1>` with **Recording an amendment** in `references/amendment.md` — Supersedes line, model marker, draft review, amendment trailer. Then bind the staged bundle to the governing plan version, which is the latest canonical version whether its trailer is signed or amendment. Update the staged `manifest.planVersion` and `validation.planVersion` to `<N+1>`, set `trigger` to `"plan-revision"`, re-run validation against `v<N+1>`, and continue to finalize one correctly attributed bundle.
- **Fix the work** — treat the deviations as defects: fix scripts, re-run, refresh the staged artifacts/scripts/manifest (re-stage what changed), re-validate, continue to finalize.
- **Accept and log** — append a decision-log entry (real timestamp, the deviation and why it stands); finalize with `deviations-found` sealed; tracker row `done (unvalidated)` with the note naming the accepted deviation; continue the tail from step 4.

## Outcome matrix (normative)

| Validation outcome | Tracker status | Tail behavior |
|---|---|---|
| `conforms` | `done (validated)` | continue |
| `conforms-with-amendments` | `done (validated)` — note names the amendment | continue |
| `deviations-found` | none until the deviation stop resolves | STOP (above) |
| `unverifiable` | `done (unvalidated)` — note says why | continue; surfaced on the board |
| `skipped` (opt-out / headless) | `done (unvalidated)` | continue |
| `not-applicable` (retrofit) | `done (retrofit)` | continue |
| integrity failed | (orthogonal — any row above) | advisory badge; never blocks |
| zero qualifying artifacts | no bundle | capture.md rule: report honestly and stop — EXCEPT the explicitly-confirmed summary-only retrospective bundle (results-adopt.md, Summary-only bundles), which remains legitimate |

## Headless rules

No AskUserQuestion means: `/aict:execute` never auto-runs. Headless invocation requires explicit flags — `--go` (the authorization; without it, print what is needed and stop), `--model <id>` (optional; absent → profile default, no nudge wait), `--report yes|no` (required with `--go`), `--rerun` (required to re-execute a component whose current bundle already exists; without it such a component is skipped with a note). A mid-run interpretive choice that the plan does not resolve → STOP and report the choice; never decide it headless. The deviation stop cannot ask either: record the deviations, finalize nothing, write no tracker status, report, and stop — never auto-pick a remedy. Validation follows capture.md's headless rule (`skipped` when the Task tool is unavailable).
