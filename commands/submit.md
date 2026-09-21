---
description: Submit the current project state to your instructor's classroom server for the roster dashboard
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Submit everything under `plans/` to your instructor's classroom server, where they review it alongside the rest of the class on one roster dashboard. Script: `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/scripts/submit.py` (python3, stdlib only). This is a separate, opt-in surface from `/aict:board` — nothing here changes anything about sign-off, review, or the local board.

1. **Gate.** Requires `plans/master-plan.md` with its marker; if absent, say so and suggest `/aict:init`. Stop.

2. **First-run setup.** Run `python3 <script> --dry-run` first (it works with no server configured — it only needs local files). While that is being reviewed (step 3), check whether a classroom server is already configured: if `--dry-run`'s output shows no course id and this is plainly the first submission, or if a later real-submit attempt reports no classroom server configured, ask the student for:
   - **Server URL** — the instructor gave this out, e.g. in the syllabus or an announcement.
   - **Personal token** — the instructor issued this to the student individually, out of band (never in this chat, never pasted into a file that gets committed). Stress explicitly: this is **personal**, not the single shared board password the student may already know from `/aict:board` — it identifies them individually to the instructor's server. Do not have the student paste it anywhere it would be logged or committed; it goes directly as a CLI argument to this session's `--url`/`--token` call in step 5.
   - **Course id** (optional) — only if the instructor's syllabus or announcement names one.

   Do not run any command with `--url`/`--token` yet — collecting this information does not save it or contact the server; that only happens together with the actual submission in step 5, after the student has approved sending.

3. **Always review before sending — never submit silently.** Run `python3 <script> --dry-run` and translate its output into plain language for the student: how many components, analysis-plan versions, and results bundles are included; the git commit range and count from the `plans/` history excerpt; the total size (and relay the size warning verbatim if `--dry-run` prints one — it means the real submission risks the server's own size limit); and any pre-flight warning lines about a trailer problem. Then state plainly, in the same spirit as `/aict:board`'s sharing reminders: **"This will be visible to your instructor on the roster dashboard, including your full decision log and every signed plan version — not just your current draft."** This is a bigger disclosure than the board's collaborator share: the instructor sees the whole submitted history, not one focused component.

4. **Require explicit go-ahead.** This is a real send-data-to-a-third-party action — do not proceed without the student clearly saying to go ahead. If they want changes first (e.g. to trim what is captured, or to sign a pending draft), stop here and let them make those changes, then return to step 3.

5. **Submit.** On the first submission, run `python3 <script> --url <url> --token <token> [--course <courseId>]` — this saves the classroom config locally and submits in the same call, immediately after the student's go-ahead from step 4. On every later submission, `--url`/`--token` are no longer needed — the saved config is reused automatically; run `python3 <script>` bare. Handle the result:
   - **Success (submission created)** — tell the student it was recorded, and relay the server's reverification lines one by one so any `mismatch`/`flag` is visible immediately, not buried.
   - **Replay (identical content already submitted)** — tell the student nothing new was sent because the content is unchanged since their last submission; still relay any reverification lines.
   - **Token rejected (401)** — tell the student their token was rejected; they need a fresh one from the instructor. Do not retry with the same token.
   - **Payload too large (413)** — tell the student which size limit was hit and suggest trimming large artifacts (e.g. large embedded images) before retrying.
   - **Malformed envelope (400)** — relay the server's detail message; this points at a bug in the submission format, not something the student can fix by editing plan content — mention it if it recurs.
   - **Network error** — tell the student the server may be unreachable or the URL may be wrong; suggest checking the URL with the instructor.

   This command only submits — it never checks for instructor feedback itself. After a created or replayed submission, tell the student to run `/aict:check` (any time, not just right after a submit) to see whether the instructor left a comment on any of their past submissions.

6. **Log it.** Append a `plans/decision-log.md` entry recording the submission (real timestamp via `date +"%Y-%m-%d %H:%M"`, standard Context / Response / Effect format): Context = what was submitted (component/version/results-bundle counts, git range) and why; Response = the student's go-ahead; Effect = the server's result (created/replay, submission id, any reverification flags worth noting). Do this whether the submission succeeded or was a no-op replay — a rejected submission (401/413/400/network error) is not logged, since nothing reached the server.

Re-submission needs no special flag — running `/aict:submit` again is always safe: it is idempotent via the envelope's content hash, exactly like `--publish-web`'s "republishing is idempotent." A no-op resend costs nothing but a moment's review.
