# AICT conventions in depth

SKILL.md carries the three rules you cannot get wrong from memory. This file
carries the rest — load it when a question turns on provenance, numbering,
renewal, trailers, or how a revision is supposed to travel.

## Conventions

- **Versions are immutable and mechanically enforced.** `v1.md, v2.md, ...` are never overwritten or edited. The PreToolUse hook matches Claude's Write and Edit tools in initialized projects. It admits a new canonical version through a valid sign-session ticket or through `/sync`'s amendment path. Use `/aict:sign` for one or many pending drafts. A direct canonical Write opens the same slim sign view through the hook transport. A denial or timeout preserves the proposal as `.draft-vN.md` for recovery. Headless and CI sessions may set `AICT_NO_GATE=1`; this explicit bypass leaves a stderr trace. Bash-mediated writes are also outside the hook matcher. These are documented enforcement boundaries, so do not claim that the hook covers other write paths. Deviations are recorded, never hidden.
- **The log is append-only and real-time.** Never backfill at the end of a session. Late captures happen only via `/aict:sync` and carry the `(late-captured at sync)` label. Pre-adoption decisions go in `plans/history.md`, never the log.
- **Plan provenance.** A plan is prospective by default. Work adopted after it was done gets a full plan carrying `Provenance: retrospective — covers <range>` plus a `Sources` section — an honest label, not a lesser plan, judged by the same five-channel rubric. Provenance is not scored: a plan committed after its work, or a retrospective whose Sources do not resolve, is reported as a non-scored **integrity flag** (`uncommitted` / `unsupported-sources` / `unrecorded-deviation`) beside the score, never a lower channel. `/aict:adopt` drafts retrospective plans in bulk and signs them in one sign session.
- **Numbers are stable identifiers.** A component's `#` and slug are assigned once and never change, move, or get reused — the execution plan and any finalized results bundle are addressed by that slug forever. Work sequence is the **table row order**; reorder rows, never renumber. A late-adopted component shows its true place by moving its row.
- **Pre-adoption history is a record, not the log.** Decisions predating `Initialized:` go in `plans/history.md`: reconstructed, evidence-cited, date-granularity, appendable anytime but scoped strictly to pre-adoption events. The decision log stays real-time; `history.md` never fabricates a clock time.
- **Retrospective work is retrofit, never planned.** A results bundle backfilled under a retrospective plan is `provenance: retrofit` (the plan links it via `planVersion` without claiming to have governed it). Stamping `planned` is the results-layer version of undeclared retrospection — and it is permanent.
- **Renewal (v0.10).** When the project changes direction, `/aict:renew` archives the master plan to `plans/archive/master-plan-<date>.md` (immutable — hook-enforced), writes a fresh one (new context and RQs; carried rows keep their numbers, slugs, and dirs; new components take next-available numbers across all archives), preserves `Initialized:` unchanged (the honesty cutoff never moves), adds a `Renewed:` line and a `Foundations` section, and keeps ONE continuous decision log — the renewal is an entry, not a new log. Pre-renewal components stay browsable on the board (Archive view, quiet badges) and are never flagged as drift.
- **Output conventions (v0.10).** CLAUDE.md rule 7 names the target journal; analysis deliverables are journal-ready figures (vector PDF + PNG) and typeset tables (.png + .tex) — a CSV of estimates is an intermediate, never the deliverable or the board display.
- **Model profiles (v0.14).** `plans/model-profile.md` maps stages to models: interactive stages get a one-line nudge (you decide), delegated stages run in generated `aict-*` project agents pinning model + effort (best-effort — platform overrides win). No profile → zero behavior change. Hand-edits are validated by `/aict:models`, which regenerates the agents; it refuses to overwrite a same-named agent the student owns.
- **The master plan stays light.** One line of outcome per component; detail lives in execution plans and the log. Do not let sync bloat it.
- **The plan is not a preregistration — it is a contract with a built-in amendment process.** A recorded revision is an amendment: legitimate, expected. A silent deviation is a breach. Preregistration freezes the contract; this workflow keeps it amendable and treats only undisclosed change as deviation.
- **Canonical trailers record status.** A canonical execution plan ends with either `Signed off:` after a student sign decision or `Amendment recorded,` after `/sync` records a deviation. Re-execution of an amendment requires a signed re-commitment version.
- **Native plan mode.** If the student uses Claude Code's plan mode anyway, copy the approved plan into the component's next version slot so the repo record stays complete.
- **Commits.** After plan versions, log milestones, or tracker changes, suggest a short commit (e.g., `plan: 02-analysis v2 — switched to multilevel after ICC check`). Do not commit without the student's go-ahead.


## Common mistakes

- **Backfilling the log** to look thorough. A reconstructed log is worse than a sparse one.
- **Editing an existing version** "to fix a typo." Versions are evidence; new version or nothing.
- **Deciding for the student** because the choice seems obvious. Obvious choices are cheap to confirm and expensive to unwind.
- **Updating the tracker without evidence.** Status changes follow artifacts (outputs, commits), not optimism.
- **Letting exploration become analysis.** Bounded exploration informs a plan; results worth keeping belong under a signed or recorded plan.
- **Padding a results bundle.** Zero qualifying artifacts is a legitimate capture outcome; report it and stop. Never guess a producing script — `producedBy: null` beats a fabricated provenance.
- **Editing a finalized bundle** to "fix" a figure. The fix is a re-run captured as the next `rN`; the captured record stays reproducible.
