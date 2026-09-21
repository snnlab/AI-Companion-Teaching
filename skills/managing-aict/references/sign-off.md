# Signing plans

Use these named procedures whenever a command signs a pending plan or records a sign decision. Commands must cite the section name. They must not copy these rules by step number.

## The finalization transaction

Complete this transaction for each approved item:

1. Read the matching draft and its valid ticket. Copy the exact approved draft bytes without changing the plan text or model marker.
2. Append `Signed off: <name>, <YYYY-MM-DD>` as the final nonempty line. Use the student's name. Use `git user.name` when it is available and confirmed.
3. Write `plans/execution/<NN-slug>/v<N>.md`. The hook validates the ticket for this exact component, version, and content hash.
4. Delete `plans/execution/<NN-slug>/.draft-v<N>.md`. Keep every `v<N>-draft-<K>.md` snapshot.
5. Delete `.sign-feedback-v<N>.md` for this item if it exists. The feedback has now been consumed.
6. Run the review workflow on the signed plan. A scorecard for the matching draft moves to the signed path at the same version. An existing signed scorecard makes this step a no-op.
7. Update the tracker plan link to `v<N>.md`. Keep the status set by the caller. A first plan made by `/plan` stays `planned`. `/execute` sets `in progress` when execution begins. `/adopt` leaves the existing status unchanged. Never move a status backward during finalization.
8. Append the sign decision and its effect to the decision log with the current timestamp.

Do not hand-write a ticket. Do not edit an existing `v<N>.md`.

## Launching a sign session

Before launch, inspect every selected draft for an old placeholder trailer. If a draft ends with a `Signed off:` placeholder, remove that line and its trailing `---` separator when present. Tell the student that you repaired the mutable draft before signing.

Run this command with background Bash when the harness supports it:

`python3 ${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/scripts/board.py --sign [NN-slug] --no-open`

Follow the live board pattern in `/aict:board`. Open the printed URL for the student. A live persistent board closes automatically before the sign server takes over. Exit 5 from that board is the expected shutdown handoff. The existing board tab may show that it is sleeping.

After the sign server exits, enumerate the valid `.aict-approved-<slug>-v<N>` tickets and all `.sign-feedback-v<N>.md` files on disk. Those files are the durable record. Do not rely on stdout alone. Apply **The finalization transaction** to each valid approved item. Route each feedback file into draft revision, then delete it only after the feedback has been applied.

## Recovery

An interruption, timeout, or Ctrl-C does not remove a draft, a valid ticket, or saved sign feedback. Run `/aict:sign` again. If a valid unexpired ticket exists and `v<N>.md` does not, complete **The finalization transaction** without opening a browser. Pending items without tickets return to the sign session.
