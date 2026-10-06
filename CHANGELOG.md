# Changelog

## [0.15.3] - 2026-10-06

**Instructors: redeploy the classroom server** (refresh `api/` from
`classroom-template/`, regenerate `me-board.html`, then `--deploy`).

### Fixed
- **Figures missing on the student's version board when the browser was
  also signed in as the instructor.** `/api/assets` saw the instructor
  cookie, took the request for the instructor's, and refused it, because the
  history board names no student. A request that names no student now uses
  the student token it carries. The history board also stops sending cookies
  with its figure downloads.

## [0.15.2] - 2026-10-06

**Instructors: redeploy the classroom server** (refresh `me.html` from
`classroom-template/`, regenerate `me-board.html`, then `--deploy`).

### Changed
- **`/me` is laid out like the instructor's roster.** A left panel lists
  **All feedback** and every version (Version N, submitted date, and a
  Waiting / New / Reviewed badge).
  - **All feedback** shows every comment sent so far, newest first. Each
    comment is tagged with its version and links to its place on the board.
  - **Selecting a version** shows its dates, its comments, and an **Open
    Version N** button to its board.
  - **A waiting version** says it has not been reviewed yet.
  - The selection is in the address (`/me#v2`), so Back and bookmarks work,
    and the board's "← My feedback" returns to the same version. On a phone
    the panel sits above the content.

## [0.15.1] - 2026-10-06

**Instructors: redeploy the classroom server** (refresh `me.html` from
`classroom-template/`, then `--deploy`). Nothing else changes.

### Added
- **`/me` has a top bar.** It holds **🔔 Turn on notifications**, or a
  "Notifications on" pill once they are on, and **↻ Refresh**. A student
  no longer scrolls past every version to reach them. The button does the
  same thing as the one at the bottom, and a problem shows in both places.
- **A reviewed version's title is a link** to its board, like its **Open
  version** button.

### Fixed
- The submit tests no longer save a classroom config into the real
  `~/.aict/classroom` of whoever runs them.

## [0.15.0] - 2026-10-06

From student feedback on `/me`: notifications in Chrome and Whale arrived
only sometimes or late, and there was no way to go through submissions
version by version. **Instructors: redeploy the classroom server.** Refresh
the deploy directory from `classroom-template/` (it now ships a new
`me.html` and `sw.js`), regenerate `index.html` and `me-board.html` (see
`/ait:host` `--init`), then `--deploy`.

### Added
- **Submissions are numbered versions.** `/me` lists every submission as
  *Version N* (oldest = 1; a number never changes). A version not yet
  reviewed shows only "Waiting for review": its content and comments still
  stay hidden until **Send feedback to student**. **Open version** opens a
  reviewed version's board. There, Older / Newer and a version list move
  between reviewed versions, and the header says "Version N of M".
  `/ait:check --history` uses the same numbers, and `--open v<N>` opens
  Version N.
- **"Send a test notification"** on `/me` sends a test to every device the
  server holds for the student and says how many there were. The page also
  has a **"Not getting notifications?"** checklist covering:
  - the browser must be running;
  - Windows notification settings and Do not disturb;
  - the site permission.
  The test goes through the existing `/api/push-subscribe` function, so the
  Hobby-plan function count is unchanged.
- **`/me` refreshes itself.** While it is open it checks for new feedback
  every two minutes and marks the tab "(New)", so feedback shows up there even
  when a notification is missed. A badge is cleared only while the page is
  actually visible.
- **The roster says when a send notified nobody.** It shows "No notification
  device is registered for this student" when that is the case, and "sent to
  N device(s)" instead of "delivered", which the server cannot know.

### Fixed
- **Notifications are held longer and sent promptly.** The push service now
  keeps a message for 7 days, not 24 hours. On a desktop a push arrives only
  while Chrome/Whale is running, so a browser closed for a day used to lose
  it. Messages are now sent with high urgency, so an idle device is woken.
- **A lapsed subscription repairs itself.** `/me` used to show
  "notifications are on" without telling the server again. A subscription
  the server had dropped, or one made under an older key, stayed dead
  silently. Now every visit to `/me` or the history board re-registers it,
  and a subscription under an old key is replaced.
- **The notification stays on screen** until it is dismissed, instead of
  sliding into the Windows Action Center after a few seconds. It names the
  submission ("…feedback on your submission of Oct 4, 20:06"). Clicking it
  opens that version's board, moving an open `/me` tab there. Its fallback
  text is in English like the rest of the UI.

## [0.14.0] - 2026-10-06

From a student report: `/ait:submit` sent a two-day-old copy of
`plans/manuscript.docx` while the student was writing in a Word file at the
project root, and nothing in the output showed it. No server redeploy is
needed. Instructors who regenerate the roster's `index.html` also get the
manuscript's saved time on the Manuscript tab.

### Added
- **`/ait:submit` checks the manuscript before sending.** The dry run starts
  with the manuscript: which file, when it was last saved, and its opening
  words. Then it lists the plan versions and results bundles included. If
  another manuscript-like file was saved more recently, the dry run warns
  with both files and their saved times. Such files are Word/HWP files at the
  project root, `plans/manuscript.*`, and files whose name or folder says
  manuscript/paper/draft/원고/논문. With that warning, a real submit refuses
  to send until the student picks a file.
- **The manuscript can live anywhere in the project.** `--manuscript "<path>"`
  pins the file in `plans/manuscript-source.txt` (committed). From then on
  the board and every submit use that file. `--manuscript default` removes
  the pin. A pinned file that disappears is reported as missing and never
  silently replaced by an old `plans/` copy. The live board refreshes when
  the pinned file is saved.
- **A submit opens what was sent.** After a created or replayed submission,
  `plans/.aict-submitted/board.html` (git-ignored, replaced by each submit)
  opens in the browser. It is a read-only board of exactly the content sent,
  with a banner naming the submission id and time, the manuscript file and
  its saved time, and the plan and results versions. The terminal prints the
  same summary under `What was sent:`.
- **The Manuscript tab shows the file and its saved time** above the text,
  and the printed copy carries them too.

### Fixed
- **Korean Windows (cp949) no longer crashes the scripts.** `submit.py` died
  on its own em dash (`UnicodeEncodeError`), and git output with Korean
  commit subjects failed to decode (`UnicodeDecodeError` in subprocess
  reader threads). All entry scripts now write UTF-8 to the console. Every
  `git`/`vercel`/`gh` call decodes UTF-8, as if `PYTHONUTF8=1` were set.

## [0.13.1] - 2026-10-02

### Fixed
- **The classroom server deploys on Vercel's Hobby plan again.** 0.13.0 added
  a twelfth API function and the Hobby plan's limit of 12 functions per
  deployment was exceeded (`exceeded_serverless_functions_per_deployment`;
  the previous deployment kept serving, so nothing went down). Three routes
  are now served by an existing function through a `vercel.json` rewrite —
  `/api/logout` by `login`, `/api/vapid-public-key` by `push-subscribe`,
  `/api/my-submission` by `my-comments` — leaving nine. The URLs are
  unchanged, so `/me`, the history board and `/ait:check` need no update.
  A test now fails if the template grows past ten API functions.
- **Refreshing the deploy directory removes files the template no longer
  has.** `/ait:host --deploy` copied the new `api/` and `lib/` over the old
  ones, so a dropped function stayed deployed. It now replaces both
  directories. **Instructors who already refreshed to 0.13.0:** refresh again
  with the updated `--deploy` steps (or delete `api/logout.ts`,
  `api/vapid-public-key.ts` and `api/my-submission.ts` from
  `plans-admin/.classroom-web/` after copying), then deploy.

## [0.13.0] - 2026-10-02

Instructor feedback on the review workflow, plus a way back to past
submissions. **Instructors: redeploy the classroom server** — refresh the
deploy directory from the plugin's `classroom-template/`, regenerate
`index.html` **and the new `me-board.html`** (see `/ait:host` `--init`), then
`--deploy`.

### Added
- **Comments stay highlighted, Word-style.** A saved comment keeps its
  highlight (it used to vanish the moment it was saved, and comments loaded
  from the server were never highlighted). Clicking a highlight opens a
  balloon beside the text with the comment, author and time; overlapping
  comments show together. Sent comments are solid yellow; a comment whose
  save failed is lighter with a dashed underline and says "Not saved yet".
  Clicking a "Sent" card in the panel jumps to its highlight and opens the
  balloon (manuscript comments used to jump to the Tracker tab).
- **Instructors can edit and delete sent comments** — from the balloon or the
  panel card, with a confirmation before deleting. Edits are marked
  "Edited · <time>" everywhere the student sees them. New `PATCH`/`DELETE
  /api/comments?shareHash=&id=` (instructor session only).
- **Past submissions reopen read-only with their feedback in place.** On
  `/me`, each reviewed submission has **Open board**: the submission exactly
  as the instructor reviewed it, comments highlighted, balloons on click.
  In Claude Code, `/ait:check --history` lists reviewed submissions and
  `/ait:check --open <N>` saves one under `plans/.aict-history/` (gitignored)
  — a self-contained `board.html` and a `feedback.md` with each comment in
  its context for Claude to read — and opens it; saved copies reopen offline.
  New student-token route `GET /api/my-submission`; students may read back
  their own uploaded files from `/api/assets`.
- **Print / Save as PDF** on the Manuscript tab: a clean copy of the
  manuscript without the board around it, optionally with each highlight
  numbered and the comments listed after the text. Tables repeat their
  header row on every page.
- **Manuscript comments reach the student's board.** `/ait:check` now seeds
  them, so they paint on the student's own manuscript like plan comments.

### Changed
- **Word manuscripts are converted to HTML, not plain text.** Tables (merged
  cells, column widths, header rows and Word's own borders — an APA
  three-line table stays three lines), bold/italic/underline/strike,
  super/subscript, lists, footnotes and endnotes, hyperlinks, headings from
  any style (including localized style names), captions, text boxes and
  figures at their Word size now come through. Figures Word stores in a form
  a browser cannot show (EMF/WMF, native charts, SmartArt, OLE objects such
  as MathType) leave a visible placeholder instead of disappearing. Field
  codes (citation-manager data) and tracked deletions are left out. The
  board rebuilds the HTML from an allowlist before showing it. Comments left
  on a Word manuscript before this release show as written on an older
  version once.
- **Feedback reaches students only after "Send feedback to student".**
  `/ait:check` used to pull comments the instructor had not sent yet; now it,
  `/me` and the history board all show only sent feedback.
- **Edited comments come back through `/ait:check`**, prefixed "(edited by
  the instructor <date>)", and replace the older copy on the student's board.
- **The `/me` page and its push notification are in English**, like the
  board; `/me` labels manuscript comments "Manuscript".

### Fixed
- **Submissions are measured as sent.** The envelope was measured as UTF-8
  but sent with every non-ASCII character escaped (`\uXXXX`), so a Korean
  manuscript weighed up to twice what was checked. It is now sent as UTF-8.
- **Oversize submissions stop before uploading, with a reason.** The server's
  limit was 4.5 MiB while Vercel's is 4.5 MB, so a submission in between got
  Vercel's own HTML error. The server limit now matches Vercel, the client
  stops at 4.4 MB before uploading any file and names the largest parts, and
  a manuscript body over 1 MB is sent separately like figures.

## [0.12.0] - 2026-10-02

### Added
- **Equations render in the Manuscript tab.** TeX in `plans/manuscript.md`
  (`$…$` and `\(…\)` inline, `$$…$$` and `\[…\]` display, including
  `aligned`/`cases` environments) is typeset with KaTeX instead of showing
  as raw source with `_`/`*` mangled into italics. Output is MathML, laid out
  natively by the browser, so the single-file board carries no extra fonts.
  Dollar amounts in prose ("$5 to $10") stay text. Only the manuscript
  renders math — plans and reports are unchanged.
- **Word equations survive `.docx` manuscripts.** Equations built in Word's
  equation editor (OMML) were silently dropped by the text extractor; they
  are now converted to TeX and typeset like the Markdown ones. Paragraphs
  without equations extract exactly as before, so existing comment anchors
  on a Word manuscript still match.

## [0.11.0] - 2026-09-30

### Changed
- **The roster's "new" badge is per student.** It now means "submitted since
  you last opened this student's board" (was: since you last opened the
  dashboard, so merely loading the page cleared every badge, reviewed or
  not). Opening a student's board records a per-student `viewedAt` in the
  roster summary and clears the badge at once; a new submission brings it
  back. Loading the dashboard no longer writes anything. On upgrade, the old
  single dashboard-visit pointer seeds every student's `viewedAt`, so badges
  carry over rather than all lighting up.
- **The board UI is English throughout.** The drill-in feedback panel
  ("Send feedback to student", "Sending…", "Sent", "Already sent",
  "Send feedback again", "N notifications delivered") and the post-save
  banner in a roster drill-in were Korean in an otherwise English board.
  The student `/me` page is unchanged.

## [0.10.0] - 2026-09-30

Scales the classroom roster server: the dashboard and the drill-in no longer
download whole submissions, and figures no longer count toward Vercel's 4.5 MB
body cap. **Instructors: redeploy the server** (refresh the deploy directory
from the template, regenerate the dashboard page, `--deploy`). Students get the
new `submit.py` with the plugin update; an old `submit.py` still works against
the new server, and the new one falls back to the old inline upload against an
old server.

### Changed
- **Figures and results files upload separately.** `submit.py` moves every
  embedded file over 32 KB (and smaller ones, largest first, until the envelope
  is under 3.5 MB) out of the JSON and uploads it to a new `/api/assets` route
  first, in parts of at most 4 MB, content-addressed by sha256 and scoped per
  student. The payload keeps `aict-asset:<sha256>` references plus
  `payload.externalAssets` metadata. Files the server already holds are skipped,
  so a resubmission sends only what changed. The server hashes every part it
  receives, verifies a multi-part file's whole hash once (then keeps a marker),
  and rejects a submission referencing a missing file (`missing_assets`) — so
  reverify can use a reference's sha as the recomputed checksum. A 9.6 MB
  submission (two large figures) that previously got HTTP 413 now goes through.
- **The dashboard reads one blob.** `GET /api/roster` answers from
  `roster-meta/summary.json` (name, last submission, count per student), kept
  current by ETag-conditional writes on submit and registration, and rebuilt
  from the per-student records whenever it is missing — deleting it is always
  safe. Measured on 50 students × 4 submissions: 351 reads / 51 MB / 52
  writes+lists per page load before, 2 reads / 7.6 KB / 1 write after (the
  first load after upgrading pays the old cost once while it builds the
  summary and per-student indexes).
- **The drill-in loads one submission at a time.** `GET
  /api/submissions/:studentId` returns metadata from a new
  `submissions/<id>/_index.json`; `?key=` returns one submission. The single
  response carrying every submission could exceed the 4.5 MB response cap, making
  a student with several large submissions impossible to open. Switching
  submissions keeps the current tab.
- **Times on the roster screens show in the viewer's local time.** Submission
  times carried the student's offset and the release time the server's UTC, so
  the drill-in panel showed them on two different clocks.
- **The post-save banner in a roster drill-in** now says the comment is saved
  but not yet visible, and points to "학생에게 피드백 보내기"; the old wording
  ("visible to everyone with this link") was right only for `--publish-web`.
- Replaying an identical submission no longer compares the asset maps (inline
  vs referenced files is transport, not content), so a resend from a new client
  of an old client's submission is a replay, not a 409.
- `submissions/<id>/_latest.json` is no longer written or read; the roster row
  no longer carries `integrityStatus` (nothing rendered it).

## [0.9.0] - 2026-09-30

Renamed from AICT to **AITCW (AI Teaching Companion Workspace)**. The plugin
itself is renamed (`aict` -> `ait`), so this is a reinstall, not an update.

### Changed
- **Renamed AITCW (/ait: commands). Reinstall: /plugin marketplace remove aict**
- **then /plugin marketplace add snnlab/AI-Companion-Teaching**
- **then /plugin install ait@ait and /reload-plugins**
- Every slash command moves from `/aict:<cmd>` to `/ait:<cmd>`; the plugin
  and marketplace are both named `ait` (`ait@ait`). Visible names — board
  header and tab title, roster footer, update notice, gate messages, docs,
  command/agent descriptions, the `/me` page's instructions — say AITCW.
- **Internal identifiers deliberately unchanged**: the `<!-- aict:* -->`
  markers (so the sign-off gate and its fail-open LEGACY guard behave
  exactly as before on every existing project), `AICT_*` env vars,
  `~/.aict`, the `aict-*` review agents and `aict-model`/`aict-report`
  provenance markers, `.aict-approved-*` tickets, `./aict-board`, and all
  localStorage / CSS keys. Existing student projects need no migration.
- **Saved roster/board config carries over.** A renamed plugin gets a new
  `CLAUDE_PLUGIN_DATA` directory; `plugin_data_dir` moves the aict-era
  sibling (`aict-*/<ns>`) across once, so the roster URL, personal token,
  and pulled-comment state are not lost. The update check also recognises
  a marketplace added under the repo's new name (`snnlab/AI-Companion-Teaching`).

## [0.8.1] - 2026-09-30

### Added
- **Figures in the Manuscript tab.** Image references in `plans/manuscript.md`
  (`![caption](path.png)`) now render inline instead of as bare alt text. A
  path resolves against `plans/` first, then the project root; anything that
  escapes the project, isn't an image (png/jpg/gif/webp/svg), is missing, or
  is over 8 MB still falls back to alt text. The live board serves figures
  through the existing exact-key `/artifact/` route (mtime in the URL, so an
  edited figure refreshes); exported/shared boards and submissions embed them
  as data URIs. A `.docx` manuscript now carries its embedded images too, in
  reading order. Figures get a centred, white-matted block style so plots
  stay legible in dark mode. The starter `manuscript.md` template shows the
  syntax.

## [0.8.0] - 2026-09-24

The board had a tab for the analysis plan, the results, and machine-generated
per-component reports — but nowhere for the actual manuscript, the paper being
graded. Student and instructor had no shared surface to exchange feedback on
the paper itself.

### Added
- **Manuscript tab.** Placed second in the nav bar, right after Tracker.
  `board.py` discovers `plans/manuscript.{md,docx,hwp,hwpx}` (in that priority
  order) and adds it to the payload present-only, exactly like `history`/
  `archives`. Markdown is the encouraged path and renders as-is. A `.docx` is
  read through a small stdlib-only extractor (`zipfile` + `ElementTree` — a
  `.docx` is just a zip of XML, so no mammoth/pandoc dependency), producing
  plain text with best-effort Heading1-6 prefixing; formatting, images, and
  tables are lost, and the board says so. `.hwp`/`.hwpx` are surfaced as
  explicitly unsupported rather than guessed at — there's no reliable
  stdlib-only parse path for either.
- **Feedback on the manuscript reuses the existing hosted-comment pipeline
  unchanged.** The new `Manuscript.tsx` view is wired through the same
  doc-comment/`AnnotationLayer` machinery every other tab uses, so post,
  release, `/me`, and web push already work for it with **zero server-side
  changes** — the classroom server's `validate.ts` never inspects the `view`
  field, only `type`. Staleness detection mirrors the Reports doc-comment
  branch in both `hostedComments.ts` and `board.py`'s `_doc_stale`, hashing
  the same extracted text the payload carries, not raw docx bytes.
- **`/aict:init` scaffolds `plans/manuscript.md`** from a new starter template
  on first init — present-only, never touches an existing manuscript file of
  any supported extension.

## [0.7.0] - 2026-09-21

### Added
- **Legacy-project guard on the sign-off gate.** `find_project_root` fails OPEN by design: an unrecognized opt-in marker returns `None` and every gate riding on it stops firing, silently. After the rename, a repo still carrying `<!-- papertrail:start -->` would therefore have run with no sign-off gate and no results/archive immutability, with nothing said. It now returns a `LEGACY` sentinel and every call site denies the write with a `/aict:init` migration notice instead. Covered by `tests/test_gate_legacy.py`; a project with no markers at all still passes through untouched, exactly as before.
- **One-time data carry-over across the rename.** `plugin_data_dir` (board.py) moves a pre-rename `~/.papertrail/<namespace>` directory to `~/.aict/<namespace>` on first use, and reads it in place if the move fails — it holds the student's roster server URL and personal token, the set of instructor comments already pulled, and the instructor's published board URL and pull key. `me.html` does the same for its `pt-me-token` / `pt-me-seen:` localStorage keys, so a student is not logged out of the feedback page and does not see every released comment marked unread again.
- **Student search on the roster dashboard.** A search box filters the roster table by student name or id as you type — for a class where scrolling a long table to find one student is friction.

### Changed
- **Instruction text restructured for progressive disclosure.** Commands no longer load each other whole. `SKILL.md` is an index (4,471 → 1,869 tok) pointing at `references/`; `commands/board.md` keeps the gate, the serve loop and its exit codes (5,695 → 1,863 tok) and defers feedback routing, reviewer dispatch, and export/share/ingest to `board-routing.md`, `board-review.md`, `board-modes.md`, loaded only when those paths are actually taken. The capture procedure moved to `references/capture.md`, so `/aict:results` (3,763 → 356 tok) and the execution loop share one copy instead of the loop pulling the whole command file. The amendment and re-commitment recipe — previously duplicated across `sync.md`, `sign.md` and `execute.md` — is now `references/amendment.md`. The `SKILL.md` command table is gone: Claude Code already injects every command's description. Measured end to end: a plain board open 10,166 → 3,733 tok, an `/aict:execute` run 19,189 → 11,114 tok, before any project file is read. Nothing the workflow enforces changed — the untrusted-input guard, the sign-off gate rules, the validation contract and the rubric all moved intact, and the doc tests now assert them at their new homes.
- **The CLAUDE.md block is shorter** (1,213 → 1,034 tok). Rules 1–6, 8 and 10 are compressed to one line each; rule 7 (course/deadline and output conventions), rule 9 (evidence before claims) and rule 11 (the student authors the interpretation) are kept **verbatim** — they carry project-specific or academic-integrity content that cannot be inferred from the skill.
- **Renamed to AICT (AI Companion Teaching).** Every case-variant of "papertrail" is now "aict"/"AICT", including `AICT_*` env vars (`AICT_NO_GATE`, `AICT_NO_BOARD`, `AICT_NO_UPDATE_CHECK`, `AICT_GATE_TIMEOUT`) and the `<!-- aict:master-plan -->` / `<!-- aict:start -->` / `<!-- aict:end -->` markers. Provenance markers `<!-- pt-model -->` / `<!-- pt-report -->` are now `<!-- aict-model -->` / `<!-- aict-report -->`; the generated review agents are `aict-plan-reviewer` / `aict-results-validator` / `aict-board-reviewer`; the skill directory is `skills/managing-aict/`; the no-LLM board launcher is `./aict-board`; the sign-session ticket prefix is `.aict-approved-`. This is a clean break: no `papertrail`/`pt-*` dual-read code exists anywhere, and none should be added. The GitHub repo and the deployed roster server keep their existing names — the roster URL is configured per project, not derived from the plugin name, so existing student tokens keep working.
- **Instructor comments post as you leave them.** In the drilled-in student board (hosted mode) a new comment now goes to the server the moment it is added — no second per-card **Save** click. Pressing Return in the comment box commits it (Shift+Return for a newline); the per-card Save stays only as a retry affordance if the POST fails or the reviewer name is still blank.
- **`/aict:check` opens the board itself.** When there are anchored instructor comments, `check.py` now launches the local board (detached) on the seed file directly — releasing any board already holding `plans/.board.lock` first — instead of relying on a separate command step. Prints `[aict:check] opening the board…`; set `AICT_NO_BOARD=1` to suppress (headless runs).

## [0.6.0] - 2026-08-31

Instructor feedback lands where a student can actually use it: anchored comments now reopen on the student's own board, painted on the exact passage they target, and the instructor's name pre-fills so the first comment can't silently fail to save.

### Added
- **`/papertrail:check` reopens the board with the instructor's comments in place.** Anchored comments (a quote on a plan version, the tracker, or a results report) are written as a `--seed-annotations` file; `check.py` prints a `[papertrail:check] board-seeds: <path>` line and the command opens the local board so the student reads the instructor's exact wording on the passage it targets — not a relayed summary. The comments still arrive as an untrusted-DATA ` ```json board-feedback ` document for routing (`commands/check.md` step 5), and general (unanchorable) notes still come through as text only. `check.py` gains `annotation_to_seed` / `write_seed_file`; the seed path is gitignored and cleared when nothing is new.
- **`COURSE_INSTRUCTOR_NAME`** (`/papertrail:host --init`, optional but recommended) — pre-fills the comment-author field when the instructor drills into a student's board. There is one instructor login, so a blank author field was pure friction — and a blank field silently disables the **Save comment** button, so a first comment from a fresh browser looked saved when it wasn't. `GET /api/roster` now carries `course.instructorName`; the board uses it as the reviewer-name default (`BoardData.defaultReviewer`), and a name the reviewer already typed on that device still wins.

### Changed
- `docs/hosting-the-roster.md` describes both: the instructor-name default and the in-place comment reopen.
- version 0.5.0 -> 0.6.0 (plugin.json + board/package.json).

## [0.5.0] - 2026-08-30

Splits instructor-feedback checking out of `/papertrail:submit` into its own command, `/papertrail:check`, and backs it with a server endpoint that returns a student's comments across **all** their submissions in one call — so a check from a second machine (or after a fresh install) can't silently miss feedback left on an older submission.

### Added
- **`/papertrail:check`** (`commands/check.md`, `skills/managing-papertrail/scripts/check.py`) — pulls every instructor comment on any of the student's past submissions (`GET /api/my-comments`, authenticated with the student's own bearer token) and routes anything not already seen through the same hosted-feedback pipeline `/papertrail:board --pull` uses: one ` ```json board-feedback ` document per instructor/session, `"mode": "hosted"`, so the student's existing board-feedback routing treats it as instructor **data, not instructions**. Crash-safe (inbox-then-mark-pulled). Runnable any time, not only right after a submit. There is still no push notification anywhere in this tool — no email, no webhook.
- **`GET /api/my-comments`** (`skills/managing-papertrail/assets/classroom-template/api/my-comments.ts`) — bearer-token-only route: resolves the token to a student, walks their full submission history server-side, and returns every comment across all of it, sorted by time. Exempted from the instructor-cookie middleware gate (`lib/gate.ts`, `middleware.ts`) the same way `/api/submissions` and `/api/comments` already are.
- **Local classroom state module** (`skills/managing-papertrail/scripts/classroom.py`) — the server URL + personal token config and the "pulled comment ids" set, shared by `submit.py` and `check.py` (neither imports the other). Migrates the pre-0.5 `<hash>-seen-comments.json` (written by the old submit-time check) into the new flat `<hash>-comments-pulled.json` on first read, so an existing student doesn't re-see old comments.
- **UTF-8 output** in `check.py` — routed feedback documents can contain any character the instructor typed; the script forces UTF-8 on stdout/stderr so a non-UTF-8 console (e.g. cp949 on Korean Windows) can't crash routing.

### Changed
- **`/papertrail:submit` only submits now.** The submit-time comment check (`check_for_new_comments` / `fetch_comments` in `submit.py`, and its `<hash>-seen-comments.json` bookkeeping) is gone; on a created or replayed submission the command tells the student to run `/papertrail:check`. `commands/submit.md`, `docs/hosting-the-roster.md`, `commands/host.md`, `README.md`, and `SKILL.md`'s command table updated to match (the skill table also gains the `submit` and `host` rows it was missing).
- **`/papertrail:host --deploy`** documents that a plugin upgrade needs the deploy directory's server code refreshed from the template before redeploying — `--deploy` alone does not re-copy plugin code.

### Fixed
- The [0.3.0] entry described the comment check as living in `submit.py` and firing on every submit; that behavior moved to `/papertrail:check` in this release.

## [0.4.0] - 2026-08-25

Adds a second supported paper type: a literature review (systematic/PRISMA-style), alongside the original quantitative-analysis paper. This was already almost entirely supported — the execution-plan template, the results-bundle schema (`producedBy: null`, `kind: "other"`), and the five-channel rubric were already written in method-agnostic language — so this is a prose/template change, not a code or schema change.

### Added
- **`/papertrail:init` now asks the paper's type first** — quantitative or literature review — as its own single-question round before the usual interview, stored as `Paper type:` in `plans/master-plan.md`. The answer decides which `CLAUDE.md` conventions block gets installed and how the components table's second column is labeled ("Analysis step" vs. "Review step" — a display label only, parsed by no code).
- **`skills/managing-papertrail/templates/claude-md-section-review.md`** — a review-paper variant of the CLAUDE.md conventions block. Identical to the existing `claude-md-section.md` in every rule except 7 (output conventions: a PRISMA flow diagram, an extraction table that may belong in a supplementary/appendix file, and a narrative-synthesis paragraph are now named as legitimate deliverable shapes) and 9 (evidence-before-claims: phrased around a search/screening/extraction pass instead of code execution). Rules 1–6, 8, 10, 11 — the workflow governance itself — are byte-identical between the two files.
- **`docs/review-papers.md`** — a worked systematic-review walkthrough parallel to `QUICKSTART.md`'s quantitative example: example components (search-strategy, screening, extraction, quality-appraisal, synthesis), a decision-log entry example, and a results-bundle example using the schema's existing `producedBy: null`/`kind: "other"` conventions for hand-produced artifacts.
- `commands/init.md` step 4's component-derivation guidance now proposes review-methodology stages when `paperType: review`, instead of quantitative-analysis steps.

## [0.3.0] - 2026-08-25

Closes a gap in the roster server (v0.2.0): drilling into a student's board from the roster dashboard had no way to actually leave a comment, and nothing told a student one had been left. Both are now real, in keeping with the existing "no push notifications anywhere in this tool" design: the instructor's comment is stored, and a student finds out only by running `/papertrail:submit`, which now also checks their own submissions for anything new.

### Added
- **Instructor comments on a submitted board.** Drilling into a student's board from the roster reuses the exact same hosted-comment flow a `--publish-web` collaborator link already has (select text, leave a comment) — `board/src/views/Roster.tsx` marks the drilled-in payload `mode: "hosted"` so `App.tsx`'s existing comment machinery fires unmodified. The classroom server gained `GET/POST /api/comments` (`skills/managing-papertrail/assets/classroom-template/{lib,api}/comments.ts`), storing comments scoped by `shareHash` (a submission's content hash), resolved to a student via a new `submission-index/` reverse lookup written at submission-accept time. Reads are authorized either by the instructor's session (any student) or a student's own bearer token (their own submissions only, never another student's).
- **A student learns about a comment by running `/papertrail:submit`.** No email, no webhook — consistent with this tool never sending anything on its own. Every submit now also fetches the student's own comments (`skills/managing-papertrail/scripts/submit.py`'s `check_for_new_comments`), diffs against a locally remembered "seen" set keyed by shareHash, and prints anything new under an "Instructor feedback" heading.
- **A "new" badge on the roster table** for any row submitted since the instructor's last visit to the dashboard (`isNewSinceLastView`, computed server-side from a single last-viewed pointer in `lib/roster.ts` — there being only one instructor login, no per-person state is needed).

### Changed
- `board/src/App.tsx`'s hosted-comment fetch now includes `?shareHash=` in its `GET /api/comments` call — a no-op for the existing single-project `web-template` deploy (one project, one shareHash-space, the extra query param is ignored), required for the classroom server to know which student's comments to return.
- `docs/hosting-the-roster.md` and the README's roster section now describe this accurately — they previously undersold what the drill-down view could do (nothing) and oversold it (comment-capable) at different points; both are now correct.

## [0.2.0] - 2026-08-25

Adds an instructor-hosted classroom roster server: students submit their project state to one central, multi-tenant server (separate from the existing single-project `--publish-web` sharing) so the instructor reviews everyone from one dashboard instead of opening each student's board individually.

### Added
- **`/papertrail:submit`** (`commands/submit.md`, `skills/managing-papertrail/scripts/submit.py`) — packages a student's current project state (`collect_payload` + inlined artifacts + a bounded git-log excerpt of `plans/`, commit hash/date/author/subject only, no diffs or code) into a versioned envelope and submits it to the instructor's server. Always shows a full preview (components, versions, results bundles, commit range, size) and requires explicit confirmation before sending — never silent. Idempotent: resubmitting identical content is a no-op.
- **`/papertrail:host`** (`commands/host.md`) — instructor command to stand up and administer the classroom server: first-run Vercel setup (`--init`), student registration/token minting (`--add-student` / `--roster <file>`), redeploy (`--deploy`), opening the dashboard (`--roster-view`), and token rotation (`--rotate-token`). Never gains a sign/approve action — the "comment-only instructor role" invariant carries over unchanged.
- **`skills/managing-papertrail/assets/classroom-template/`** — a new, parallel Vercel deployment template (alongside the existing single-project `web-template/`) for the multi-tenant server: per-student bearer tokens (never a shared password), an instructor-only login session, and Blob-backed roster/submission storage.
- **Server-side mechanical re-verification** on every submission: independently recomputes each results bundle's checksum/artifact-reference integrity and F·A·I score from the submitted bytes (never trusts the client-sealed values), re-checks each signed plan's sign-off trailer grammar, and cross-checks sign-off dates against the submitted git-log excerpt for a timing-based flag. Content-level mismatches are always stored and flagged, never rejected — only a malformed or oversized envelope is refused.
- **Cross-student similarity signal** (`/papertrail:host` dashboard, instructor-triggered) — k-shingling + Jaccard similarity over normalized decision-log text, surfaced as a neutral "worth a look" flag with a concrete shared-phrase example. No automatic consequence.
- **Roster dashboard** (`board/src/views/Roster.tsx`, `board/src/RosterApp.tsx`) — a new view, additive to the existing single-project board (no changes to `Tracker`/`PlanReader`/`Results`/`Timeline`/etc.). Each row deep-links into that student's full board, rendered by the same unmodified single-project UI. Includes a **trust-tier legend** distinguishing mechanically re-verified checks from descriptive/timing-derived signals from self-attested claims, so a green check is never over-trusted.
- `docs/hosting-the-roster.md` — setup/troubleshooting/privacy guide for the classroom server, with an explicit callout that it now aggregates every registered student's decision log and git history in one place.

### Fixed
- `board/package.json`'s version had drifted to a stale `1.1.0` inherited from the Planboard fork instead of tracking `.claude-plugin/plugin.json`; both are now `0.2.0` per this project's own version-parity rule.

## [0.1.0] - 2026-08-24

Initial release of PaperTrail, forked from [Planboard](https://github.com/letitbk/planboard) v1.1.0 and retargeted from a solo-researcher tool into a plan-based bridge between a graduate student, their AI assistant, and their instructor for a quantitative-methods final paper. The plan/sign-off/decision-log/results-bundle mechanics carry over unchanged; the naming, prose, and a handful of academic-integrity controls are new.

### Changed
- **Renamed to papertrail.** Every case-variant of "planboard" is now "papertrail"/"PaperTrail"/"PAPERTRAIL", including `PAPERTRAIL_*` env vars and the `<!-- papertrail:master-plan/start/end -->` markers. Provenance markers `<!-- pb-model -->` / `<!-- pb-report -->` are now `<!-- pt-model -->` / `<!-- pt-report -->`; generated review agents `pb-plan-reviewer` / `pb-results-validator` / `pb-board-reviewer` are now `pt-plan-reviewer` / `pt-results-validator` / `pt-board-reviewer`; the no-LLM board launcher is now `./pt-board`; the sign-session ticket file is `.papertrail-approved-<slug>-v<N>`.
- **Retargeted from researcher+AI to student+AI+instructor.** Commands, the skill brain, and templates are rewritten for a graduate student writing a sociology quantitative-methods final paper, with the instructor as a comment-only board participant (unchanged mechanically from the prior "collaborator" role — still no sign/approve capability).
- **`master-plan.md` template** — header "Master Plan" → "Paper Plan"; the Components table's `Component` column is now `Analysis step`.
- **`execution-plan.md` template** — header "Execution Plan" → "Analysis Plan"; the 8-section structure is unchanged.
- **`CLAUDE.md` conventions (rule 7)** — rewritten from target-journal vector-PDF/typeset-table output conventions to coursework deliverable conventions (APA/ASA citations, paper-ready figures/tables, deadline awareness).
- **Plan rubric** — moved from `docs/plan-rubric-v0.4.md` to `docs/plan-rubric.md`; the five channels and their 0–3 anchors are unchanged. The empirical methods note (Planboard's own 14-project provenance) was replaced with a one-line attribution back to the Planboard project.
- **`.claude-plugin/plugin.json` / `marketplace.json`** — new description, `"author": {"name": "PaperTrail contributors"}`, version reset to `0.1.0`, `homepage`/`repository` left as placeholders pending a hosting decision.

### Added
- **Low-Decisions sign-off guard** (`/papertrail:plan`, `/papertrail:sign`). Before a plan whose "Decisions and reasons" rubric channel scores below 2/3 is signed, the AI must recommend revising it first; signing anyway is logged to `decision-log.md` as an explicit override entry.
- **Retrospective-adoption warning** (`/papertrail:adopt`). A callout against using retrospective adoption to backfill legitimacy for a graded component without instructor approval, pointing to the rubric's `unsupported-sources` integrity flag as the existing mechanical safeguard.
- **AI Assistance Disclosure** (`/papertrail:report`). Every generated report now renders a disclosure table from the `modelUsage` data already captured per plan/results bundle, listing which stages used which model, with a pointer to the decision log and results bundle as the verifiable record.
- **No-AI-authored-interpretation rule** (`CLAUDE.md` rule 11). The AI may draft directions, play devil's advocate, and critique, but must never write the paper's sociological interpretation on the student's behalf; a drafted starting point must be flagged in the decision log until the student has revised it in their own words.

### Removed
- **All `research-plans`/`RESEARCH_PLANS_*`/`rp-*` migration-compatibility code.** Planboard carried dual-read support for its own prior name (`research-plans`) across markers, environment variables, generated agent filenames, the board launcher, and a hosted-config directory fallback. PaperTrail has no prior installs to migrate from, so all of that compatibility layer was deleted outright rather than renamed — this is a clean break, not a rename-in-place.
- **`docs/plans/`, `docs/specs/`, `docs/evaluation/`, `docs/images/`, `docs/ROADMAP.md`, `docs/RELEASING.md`** — Planboard's own dev-history, CI, and screenshot artifacts, not applicable to this fork.
- **`.github/`, `scripts/check_pr_policy.py`, `scripts/new-walkthrough.py`** — Planboard's own CI and dev-tooling scripts.
- **`commands/handoff.md`, `skills/managing-papertrail/scripts/handoff.py`** — the Codex-handoff command, out of scope for this fork.
- **`tests/test_rename_compat.py`, `tests/test_check_pr_policy.py`, `tests/test_handoff.py`** — tests for the removed compatibility layer, CI policy, and handoff command.
