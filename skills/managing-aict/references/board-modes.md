# Board export, share, and ingest modes

Loaded by `/aict:board` step 3 when `$ARGUMENTS` carries `--export`, `--share`,
or `--collect <file>`. Each mode replaces the live serve entirely.

## Export mode
7. **Export mode.** Run `python3 <script> --export`. Then state the privacy reminder in publishing terms: committing or sharing `plans/board.html` IS publishing everything under `plans/` verbatim — treat it exactly like publishing the plans themselves (participant details and IRB specifics stay out, or export to a non-committed path instead). Suggest a commit such as `plans: export board snapshot`.

## Share mode
8. **Share mode.** Resolve any named component to its `NN-slug`, then run `python3 <script> --share [--focus NN-slug]`. Report the output path and state the privacy reminder in publishing terms: emailing this file IS publishing its embedded plan content to that person — an unfocused share embeds everything under `plans/`; a focused share embeds that component's plans plus the full master plan (always visible by design). Practical notes for the student: some mail providers flag `.html` attachments — zip the file or use a Dropbox/Drive link if delivery fails; the instructor needs only a browser, and sends back a `board-feedback-*.txt` file.

## Ingest mode
9. **Ingest mode.** Run `python3 <script> --collect <file>`. If stderr contains a `STALE` line, relay it to the student before routing anything — never route stale feedback silently; signed versions are immutable so anchors on a signed vN still resolve, but drafts may have moved on. Then route the printed document through step 5 unchanged, with one addition: when the JSON fence has `"mode": "remote"`, attribute decision-log entries as "Board feedback from <reviewer> (remote)" using the fence's `reviewer` field; never add "(remote)" otherwise. Multiple files route one at a time, in the order the student chooses. The source file is never deleted by the script; leave it where it is.
