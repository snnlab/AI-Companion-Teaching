---
description: Sign pending plans — one slim session, tickets, then the finalization transaction
argument-hint: [component name/number]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Sign pending execution plans. Load `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/references/sign-off.md` and follow its named sections. This command requires an initialized project with a marked `plans/master-plan.md`. If the project is not initialized, say so, suggest `/aict:init`, and stop.

1. **Resolve current components.** Read the current tracker and execution plan directories. Only components linked from the current tracker are eligible. A pre-renewal or archived component is permanently browse-only. An unknown name or number is an error that lists the valid current rows and stops.

   With no argument, select every current component that has a pending `.draft-v<N>.md`. Also find every current component with a valid unexpired ticket where the matching `v<N>.md` is absent. With an argument, select that component's pending draft and outstanding ticket. If it has neither, but its latest canonical version has trailer state `amendment`, offer to materialize a re-commitment candidate as described below. Continue only if the student accepts. If none of these cases applies, report that there is nothing to sign and stop.

2. **Recover tickets first.** For each valid outstanding ticket, follow **Recovery** and **The finalization transaction** in the sign-off reference without opening a browser. Remove completed items from the launch set.

3. **Materialize an amendment when requested.** Use this recipe only for an explicitly named component whose latest canonical plan has trailer state `amendment`.

   **Re-commitment materialization.** Load `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/references/amendment.md` and follow
   **Re-committing an amendment for re-execution**, then include the candidate as an
   ordinary draft in this run's sign session.

4. **Low-Decisions guard (academic-integrity control), before launch.** For every draft about to enter the sign session, read its current scorecard (`plans/reviews/<NN-slug>-v<N>.md`) and check the `decisions` channel score. For any draft scoring below 2/3 on that channel, tell the student before opening the browser: name the weakest forks (from the scorecard's `biggestLeak`/`unresolvedForks`) and recommend revising them first. Offer to stop here and route back to `/aict:plan` for that component. If the student wants to sign it anyway, proceed — but at finalization (step 5's finalization transaction), append an explicit decision-log entry for that item in addition to the ordinary sign-off entry: `Signed off despite low Decisions score (channel=<N>) — student proceeded without revision.` This is a documented override, never a silent one.

5. **Launch once.** If any selected drafts remain, follow **Launching a sign session** in the sign-off reference. One session handles one or many drafts. After the server exits, enumerate tickets and `.sign-feedback-v<N>.md` files on disk. Apply **The finalization transaction** to every valid approved item — including the low-Decisions override entry from step 4 for any item that scored below 2/3 and was signed anyway. Apply each feedback file to its draft, preserve the next draft snapshot before a new review round, run the review workflow again, and relaunch only if the student wants to review the revision now. Undecided items remain drafts.

6. **Finish.** Report each signed, revised, and still pending item — call out any low-Decisions override explicitly. The finalization transaction owns each decision-log entry. End with one message that suggests `/aict:execute` for the signed component or components. Do not start execution from this command.
