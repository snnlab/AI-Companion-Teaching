# Amendments and re-commitment

One copy of the amendment procedure, shared by `/aict:sync` step 6, the execution
loop's deviation stop, and the re-commitment step in `/aict:execute` and
`/aict:sign`.

A recorded revision is an **amendment** to the plan — legitimate and expected. A
silent deviation is a **breach**. The plan is not a preregistration: it is a
contract with a built-in amendment process, and only undisclosed change counts as
deviation.

## Recording an amendment

When a material deviation is confirmed, copy the current version to `plans/execution/<NN-slug>/.draft-v<N+1>.md`. Resume an existing draft instead of overwriting it. Apply the changes and add `Supersedes: vN — <what changed and why>`. This line records the trigger and the change.

   Update the first line `<!-- aict-model … -->` marker so it names your session model. The draft has no trailer. Before each fresh review round, copy it to the next unused `v<N+1>-draft-<K>.md` snapshot. Keep these snapshots as read-only history. Run the `/aict:review` workflow on the draft.

   After the review, append `Amendment recorded, <YYYY-MM-DD>` as the final nonempty line and write `v<N+1>.md` directly. The hook admits this amendment path without a ticket or board action. Delete the ephemeral draft and keep every snapshot. Run the review workflow on the recorded plan so the matching draft scorecard moves to the canonical path. Leave the tracker status unchanged. An in-progress component stays in progress, and sync never moves a status backward or advances it. The board displays this version as `amended △`.

   If the recorded version will govern more execution, re-commit it through **Launching a sign session** and **The finalization transaction** in `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/references/sign-off.md`. `/aict:execute` prepares that candidate and opens the sign session. Never edit an existing `vN.md`, including for a typo.

## Re-committing an amendment for re-execution

An amendment records what changed; it does not authorize the next run. Re-execution
needs a signed re-commitment version.

Copy the amendment `v<N>.md` to `.draft-v<N+1>.md`. Use `strip_trailer` from `signoff_gate.py` to strip exactly one canonical final amendment trailer plus its optional preceding `---` separator. Update the title to `v<N+1>`. Set `Supersedes: v<N> — re-commitment for re-execution`. Update the `aict-model` marker to the model used for this authoring pass. Verify that the candidate now parses with trailer state `none`. If it does not, stop and repair it. Run the `/aict:review` workflow on the candidate, then include it as an ordinary draft.
