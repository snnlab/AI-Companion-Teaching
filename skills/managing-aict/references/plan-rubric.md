# Plan Rubric — five channels

**v0.4** (five-channel reframe, July 2026; supersedes the v0.3 two-stage threshold+grade). Scoring anchors remain provisional; treat results as structured feedback, not verdicts on the student.

The definition this rubric implements:

> A plan is a written, jointly-produced **contract** that keeps the agent from improvising outside the human's awareness — concrete enough to govern and check an agent's execution, open enough to be revised when the data push back.

The rubric scores **five channels, each 0–3**. Each channel is one place where authorship and control can leak from the human to the agent. There is **no pass/fail threshold** — a plan is scored, not gated. The score is never the deliverable: the rubric produces a **diagnosis** (a five-number profile, the biggest leak, the open forks to fix) that points at the next revision.

Two rules apply throughout. **Form is free; extractability is required** — a channel's content may live anywhere in the plan; if a template section is missing but the content is extractable elsewhere, score the content and name the missing section as an improvement. **Score from the plan itself** — the plan is the artifact; a good plan stands on its own without the chat that produced it.

## Readability precondition (before scoring)

Before scoring, check that all five channels' content (goal & success, decisions, steps, validation, boundaries) can be extracted from the plan at all. If it cannot — the plan is unintelligible without the session that produced it — return **unscorable: fix readability first**, naming what cannot be extracted, and do **not** fabricate channel scores. This is a narrow extractability gate, not style policing; brevity and plain language are an authoring concern, not scored here.

## The five channels (0–3 each)

### 1 · Goal & success — *is the target checkable, and is the plan in service of it?*
Extractability of an objective AND success criteria, plus goal-drivenness (every step traces to the goal).
- **0** — No extractable objective or success criteria. Nothing says what the work is for or how success will be judged. A task list, not a plan.
- **1** — An objective is extractable but the success criteria are implicit ("find significant predictors" — at what threshold? which model?); or a goal is stated yet the plan reads as a backlog of actions not visibly in service of it.
- **2** — A goal plus partial criteria a reader could mostly check, and most steps trace back to the goal — but a consequential success condition is still implicit or deferred without a rule.
- **3** — An objective plus success criteria a third party could check without asking the author (any deferred criterion stated as a rule, not omitted), and every part of the plan is visibly in service of the goal.

### 2 · Decisions & reasons — *the depth of the consequential choices and their link to the goal (the spine)*
Are the choices that change the outcome resolved with reasons that have real **depth** and **connect to the project's research questions or goal**? Scored from the plan's decisions and reasons. Control is not authorship: a choice among options, an approval of a proposed reason, and joint authorship all count as **full** control — a coarse "keep all" over options the human genuinely chose is fine. What is scored is the quality of the reasoning on the page, not who first phrased it. The failure the channel hunts is a **shallow reason, or one disconnected from the research goal** — not the human choosing efficiently.
- **0** — Substantive choices with no reasons (an empty "why," or a reason that merely restates the choice); or a consequential fork the agent settled with no human choice at all.
- **1** — Each substantive choice has a stated reason, but the reasons are shallow or generic — they go no deeper than the choice and are not connected to the project's research questions or goal.
- **2** — Reasons are real and specific to this study, but some consequential forks carry thin reasons, or their link to the broader research goal is left implicit.
- **3** — Every consequential fork is settled with a reason that has genuine depth and is visibly connected to the project's research questions or goal; nothing consequential rests on a shallow or disconnected rationale. Authored reasons, choices among options, approvals, and joint authorship all count as full control.

### 3 · Steps — *can execution be checked?*
Is the method concrete enough that "did the agent do this?" has an answer? (execution-fidelity)
- **0** — No steps, or a one-line gesture. The method is improvised.
- **1** — A generic skeleton that fits any project of this type ("clean the data, run the model, report").
- **2** — Steps with some specifics, but a consequential context-specific step is missing or vague ("handle missing data" without saying how this data's missingness should be handled).
- **3** — Steps at a grain where "did the agent do this?" has an answer, with the non-obvious, outcome-affecting specifics surfaced. Interchangeable/standard steps left appropriately open. A high-level approach may guide without determining — do not lower the score for a high-level framing when the build steps are precise. Verbosity on trivia does not raise the score.

### 4 · Validation — *can the plan test that it hit its goal?*
Does the plan include tests or checks that let the agent (or student) confirm the **success criteria from channel 1 were actually met** — not merely that code ran? This is *validation*, not bare verifiability. A plan with no way to test goal-accomplishment fails this channel. It is separate from channel 3: channel 3 asks whether the agent did the steps; this asks whether the plan can tell the goal was reached.
- **0** — No test of goal-accomplishment. Nothing in the plan would show whether the work met its success criteria.
- **1** — Checks are named, but they test the wrong thing (a script ran, a file exists) rather than whether the success criteria were met.
- **2** — Tests cover some success criteria but leave a consequential one untested.
- **3** — Concrete tests/checks — executable tests, data audits, citation validation, named outputs a human will review — that let the agent or student confirm each success criterion was actually met.

### 5 · Boundaries — *does the agent know how far to go and what to leave alone?*
Where channel 1 fixes the target, this fixes the negative space — the stopping point and the blast radius.
- **0** — Nothing about limits. The agent decides on its own how far to go and what to touch.
- **1** — Extent only inferable from the goal; nothing explicit about what is excluded or off-limits.
- **2** — Partial: either what is out of scope or what not to touch is stated, but not both.
- **3** — Both stated: what is out of scope, and what to leave alone.

## Scoring and diagnosis

Sum the five channels for a 0–15 total, but **read the profile, not the total**. A missing channel must not hide behind a strong total: `3·3·3·0·3 = 12/15` is not "80% good," it is a plan with no validation. So the five-number profile is the headline, and **any channel scoring 0 is flagged as a missing control channel**. There is no band or headline percentage that lets one channel's strength cover another's absence.

Every score requires **evidence** — a short quoted span of plan text for the score. For each plan the review reports:
- The **profile** — `G<0-3> · D<0-3> · S<0-3> · V<0-3> · B<0-3> = <total>/15`.
- The **biggest leak** — the lowest channel, named as "where the most authorship is being handed to the agent."
- The **unresolved forks** — the specific open decisions dragging the score down; the fix-it list for the next revision.
- **One suggested move per leak.**

## Not scored (but still tracked)

- **Readability** — a precondition (above), not a channel.
- **Prospective / revisable / retrospective source-support** — properties of how a plan is *held*, not of its content, and not mechanically guaranteed (the sign-off gate blocks edits but does not commit; deviations depend on `/sync` catching them). They are reported as **non-numeric workflow-integrity flags** beside the profile — e.g. `uncommitted` (no commit before the governed work), `unsupported-sources` (a retrospective plan whose cited Sources do not resolve), `unrecorded-deviation` (execution departed the plan with no amendment). A flag diagnoses process, never lowers a channel score.
- **Revision trace** — how much a plan improved across feedback rounds measures responsiveness, not intrinsic quality. Kept out of the score entirely; it is a separate analysis for the research question.
- **Right-sizing** — reported as a `split` assessment (right-sized, or the concrete proposed split per `split-criteria.md`) alongside the diagnosis, not a scored channel. A plan spanning multiple independent components should be split.
- **Basic requirements** — that a plan *has* a goal, reasons, validation, and boundaries at all is built in during authoring (the `/plan` dialogue and the generated `CLAUDE.md` conventions), not policed here. The rubric grades quality, not existence.

## Output contract

The review returns one `board-scorecard` JSON object, schemaVersion 3 — see `templates/review-scorecard.md` for the exact shape. In brief: `status: "scored"` carries the five `channels` (ids `goal`/`decisions`/`steps`/`validation`/`boundaries`, integer `score` 0–3, `evidence`, `justification`), the `total`/`max`, the `profile` string, `biggestLeak`, `suggestedMoves`, `unresolvedForks`, `integrityFlags`, and the `split`. `status: "unscorable"` carries only a `reason`. No threshold block, no percent, no band.
