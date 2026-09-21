# <Component> — Analysis Plan v<N>

Component: `<NN-slug>` · Master plan: [master-plan.md](../../master-plan.md) · Date: <YYYY-MM-DD>
Provenance: <omit for a prospective plan. For work already done when this plan is written: `retrospective — written <YYYY-MM-DD>; covers work executed <start>–<end>`>
Supersedes: v<N-1> — <one line: what changed and why>
<!-- Keep this metadata in the body, not YAML frontmatter (some renderers strip frontmatter).
     Omit the Supersedes line for v1. Never edit an earlier version; a revision is a new file.
     Drafts (`.draft-vN.md`) contain no canonical trailer. The finalization transaction appends
     `Signed off:` after a sign session. `/sync` appends `Amendment recorded,` for an amendment.
     Provenance absent = prospective (the default, and every plan written before its work).
     A retrospective plan is an honest label, not a lesser plan; cite each claim to its dated
     source or commit, and tag anything reconstructed with hindsight inline as (reconstructed).

     WRITE IT SHORT. A plan is read cold by a coauthor, so plain language and brevity win:
     carry only what the rubric scores — the goal, the consequential decisions with their
     reasons, the approach and steps, how success is validated, and the boundaries — and
     nothing else (no speculation about results, no boilerplate, no padding). Visual emphasis
     is part of readability: **bold** the decision keyword in each Decisions row and each build
     step's verb phrase; *italics* for rationale asides. Keep paragraphs under ~4 lines. One
     sentence per build step, elaboration in an indented follow-up line — the board renders
     Build steps as numbered cards. Push low-level how (code, exact commands, dense technical
     detail) into collapsible agent-detail blocks:

       <details class="agent-detail"><summary>Agent detail — exact commands</summary>

       ```bash
       python3 analysis/fit_model.py --spec ...
       ```

       </details>

     Keep the blank lines around the inner fenced block so it renders. Put each agent-detail
     block right where it belongs in the flow; a reader can skip it, the agent can open it. -->

## Context

<Why this work, what it builds on, and the question it answers — the narrative opening. A paragraph or two, readable by a coauthor with no chat context. Fold in a one-sentence statement of what this component is for.>

## Goal and success criteria

Serves: <RQ numbers from the master plan, e.g. `RQ1` or `RQ1, RQ2`; `—` for infrastructure>

<What this component will produce or establish, and the concrete criteria by which the student will judge that it succeeded. State the criteria so a third party could check them (thresholds, models, named outputs) rather than leaving them implicit. Every step below must trace back to this goal.>

Stopping rule: <only for an iterated component — a collection round, a pilot/retest wave, a re-fielding. The condition that ends the series (target N reached, saturation, budget spent, a fixed number of waves). Delete this line for a single-shot component.>

## Decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| <e.g., dependent variable> | <chosen option> | <the reason, tied to this study's aims — with real depth, not a restatement of the choice> |
| <e.g., sample restriction> | <chosen option> | <one-line reason> |

<Every substantive choice that would change the outcome gets a row: what was chosen and why. The reason is what a reviewer checks first — give it depth and connect it to the research question or goal. The reason may be authored, chosen among options, approved, or jointly reached; what matters is that it is grounded, not who first phrased it. A list is fine instead of a table for small components.>

## Approach

<The high-level pipeline, two to four stages, in a form another agent could pick up and execute. Prose, not code.>

## Build steps

1. <Numbered steps at a grain where "did the agent do this?" has an answer. Surface the non-obvious, context-specific specifics; leave standard/interchangeable steps open. Put code and exact commands in agent-detail blocks, not inline.>
2. <...>

## Verification

<How the student (or the agent) will TEST that the success criteria above were actually met — validation, not "review the results". Name the concrete checks: executable tests, data audits, citation validation, and the deliverable files a human will review. For an analysis component, name the paper-ready figure(s) and table(s) this component will produce, formatted per the project's output conventions (CLAUDE.md rule 7). A plan with no test of whether it hit its goal is not done here.>

## Out of scope

<Boundaries. Name both: the tempting adjacent work this plan will NOT do, and any files, data, or systems the agent must NOT touch — so the agent knows where to stop and what to leave alone.>

## Files to reuse

<Optional. Existing code or data this work should build on rather than rebuild. Delete this section if empty.>

## Sources

<Retrospective plans only — delete this section in a prospective plan. The dated documents and evidence this reconstruction rests on: the ad-hoc plan docs that actually governed the work, review notes, and the commits/outputs that show what was done and when. In-repo docs are cited by relative path (their own git history is the evidence). Out-of-repo docs (e.g. `~/.claude/plans/*.md`) are snapshotted into `sources/<date>-<name>.md` and listed here as original-path → snapshot → date. A reviewer resolves every entry against the declared coverage range.>

| Source | In repo? | Date | Snapshot |
|--------|----------|------|----------|
| <original path> | <yes: cite path / no: snapshotted> | <YYYY-MM-DD from git/mtime> | <sources/…-name.md, or — for in-repo> |
