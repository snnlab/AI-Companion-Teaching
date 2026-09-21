# aict — reference

Complete technical reference. For what the plugin is and why you'd use it, start with the [README](../README.md).

- [Commands](#commands)
- [The board](#the-board)
- [Share the board privately (Vercel)](#share-the-board-privately-vercel)
- [Output & Validation](#output--validation)
- [Model profiles](#model-profiles)
- [The sign-off gate](#the-sign-off-gate)
- [What it creates in your project](#what-it-creates-in-your-project)
- [Install, updating, and pinning](#install-updating-and-pinning)
- [Developing the board](#developing-the-board)

## Commands

| Command | What it does |
|---------|--------------|
| `/aict:init` | Opt a project in. Interview, seed the components list, create the artifacts. |
| `/aict:adopt` | Retrospectively decompose already-done work into components, each with a full retrospective plan; review and sign the drafts in one sign session; reconstruct pre-adoption history. |
| `/aict:renew` | Change the project's direction: archive the master plan, write a fresh one over the existing work. Numbering continues, carried components keep their plans and results, the rest stay browsable in the archive. Preferred over adopt when starting the workflow in an exploratory repo you want to take somewhere new. |
| `/aict:plan` | Scope the next component, co-author its execution plan, score the pending draft, and mark the tracker row `planned`. |
| `/aict:sign` | Sign one or many pending plans without starting execution. Recovers durable tickets and saved sign feedback after an interruption. |
| `/aict:execute` | Sign pending plans at the execution gate, then execute them. One prompt sets timing, model, and report preference; then capture, validation, reporting, bookkeeping, and next steps run as one loop. |
| `/aict:sync` | Manual recovery checkpoint for out-of-loop work, crashed sessions, hosted comments, and missed logging. Update the tracker, catch unlogged decisions, and version the plan if execution deviated. |
| `/aict:review` | Score the plan against the five-channel rubric (goal & success, decisions & reasons, steps, validation, boundaries; 0–3 each). Reports a profile, the biggest leak, and the forks to fix — a diagnosis, not a pass/fail. Includes a split assessment. |
| `/aict:models` | View or edit the per-stage model profile; regenerates the project's `aict-*` review agents. |
| `/aict:results` | Capture a versioned results bundle for a component — brief report, figure/table snapshots, key numbers, script snapshots, and an automatic plan-vs-execution validation. `--adopt` brings pre-existing artifacts under verification. |
| `/aict:report` | Generate a shareable report for a bundle (markdown always; PDF/DOCX via pandoc) into `plans/reports/` — also available as the board's Generate report button; offered automatically at capture end. |
| `/aict:board` | Open the board: a browser dashboard over everything, with drift flags, live annotation, a shareable snapshot, or `--publish-web` to a private, password-protected link for collaborators. `./aict-board` opens the same board from a terminal with no model in the loop. |

Everything is opt-in. The plugin does nothing in projects you have not initialized.

The primary path has four stops: plan → draft review → execute gate → tail. `/aict:plan` ends with a scored pending draft. The board is optional for reading and annotations. `/aict:execute` opens one slim sign session before the work. After signing and the execute prompt, the tail captures and validates each component, reports when requested, updates the tracker and log, suggests one commit, opens one view-only board, and proposes what comes next. `/aict:sign` signs pending plans without execution. `/aict:sync` remains available for work that happened outside this loop or needs recovery, and it records confirmed amendments directly.

## The board

The board renders the whole project in your browser, in six views — seven after a renewal:

- **Tracker** — components as a status board, with drift flags, per-row results badges, and a separate report column.
- **Plan reader** — any version of any plan, with each version's five-channel score in the header (hover a chip for the evidence, click for the full diagnosis), v1→v2 diffs (wrapped to the pane), and the reason each revision was made. The plan reads as one narrative; a project-set detail level controls how much shows by default, and low-level agent detail collapses inline.
- **Output & Validation** — the reviewing surface (see [Output & Validation](#output--validation) below): validation first, then a mechanical integrity check, compact claim tiles, a figure/table gallery, and a per-artifact "produced by" script drawer with line-anchored comments. A provenance flow diagram maps each producing script to its artifacts — click a script to read the snapshot line by line (and comment on lines), click an artifact to zoom or jump to its card.
- **Reports** — renders each bundle's generated report, figures in context, with `rN · plan vN` version chips, stale-report flags, and PDF/DOCX downloads on the local board.
- **Timeline** — decisions, plan versions, results captures, legacy verdicts from pre-v0.20 bundles, and review scores in one stream.
- **Models** — the per-stage [model profile](#model-profiles): read-only in every mode, and editable inline when the board is served live from your project (see below).
- **Archive** — after a renewal, renders each archived master plan as it was, its component rows still linking to their plans and results. Pre-renewal components carry a quiet badge everywhere instead of drift flags.

Each plan version, results bundle, report, and review also carries a small model-provenance chip — which model it used, as that session reported it — shown honestly as self-attested, never as confirmed runtime truth.

The board follows your OS light/dark preference, with a header toggle to override it (exports and shares carry the toggle too).

### Two modes

**Live** — `/aict:board` starts a small local server (`python3` only, nothing to install) on a stable per-project port. Bookmark the URL; it stays valid for the whole session. The live board is a dashboard and feedback surface. Select text to attach a comment, press **Send to Claude**, request an agent review, generate a report, reopen a results bundle, or edit model settings. A pending plan is labeled `pending — signs at /execute or /sign`; plan approval is not on the persistent board. The board has no idle timeout. It closes when you submit an action so your session can route it; `/aict:board` reopens it at the same URL whenever you want to continue. The live board follows the plans directory: plan or results changes written while it is open appear on their own within a few seconds (a reload is held while any editor has unsaved input).

Or let an agent do the reviewing: the **Review with** button on any plan version, the master plan, or a results bundle runs Codex, Gemini, a Claude subagent, or a three-lens subagent panel and seeds its section-anchored comments onto the board — attributed to the reviewer — for you to curate before they route the same way.

### Opening the board without Claude

Every plain live open also writes or refreshes `./aict-board` in the project root — a small launcher that opens the board with no model in the loop. Run `./aict-board` in a terminal, or `!./aict-board` from inside a session; it reconnects to a board already running on the project's port, or serves a fresh one. Use it when your Claude session is rate-limited, or when you only want to read.

The launcher is created at `/aict:init` and can be written on demand with `python3 <plugin>/skills/managing-aict/scripts/board.py --install-launcher`. It bakes in this machine's python interpreter and plugin path, so it is machine-specific and kept out of git through `.git/info/exclude` rather than `.gitignore` — no tracked-file churn, and it never enters a commit. board.py only ever replaces a launcher it wrote itself; a symlink, a directory, or a file of your own at that path is refused, not overwritten.

Feedback you send from a launcher-served board has no session to route it, so it is saved to `plans/.board-feedback.md` and picked up the next time you run `/aict:board` in Claude.

**Snapshot** — `/aict:board --export` writes a single self-contained `plans/board.html` that anyone can open without Claude Code or an internet connection (figures are inlined). Snapshots are read-only. Treat the file like publishing your plans: it contains everything under `plans/`, including result figures, tables, and script snapshots.

### Share with collaborators (offline file)

`/aict:board --share` exports an annotatable board file you can email. Collaborators comment in their browser and send back a feedback file that `/aict:board --collect <file>` routes into your session with attribution and a stale-hash warning if the board moved on.

## Share the board privately (Vercel)

For collaborators who only have a browser, `/aict:board --publish-web` publishes the full board to a private, password-protected URL on Vercel: they read it and comment from their own browser, and their comments flow back into your session on request. One-time setup takes about 20 minutes and needs Node.js in addition to `python3`; every publish after that is one click. The full walkthrough, including a copy-paste collaborator invitation you can send as-is, lives in [`docs/hosting-the-board.md`](hosting-the-board.md).

**If you used the old GitHub Pages publish:** earlier versions used `/aict:board --publish` to push the board to a public GitHub Pages URL with no password and no access control — anyone who found the link could read it, indefinitely. If that applies to you, take it down: delete the `gh-pages` branch (`git push origin --delete gh-pages`), or disable it in the repo's Settings → Pages (set Source to None). Deleting the branch is the more complete cleanup; a disabled-but-present `gh-pages` branch can be quietly re-enabled by anyone with repo-settings access.

## Output & Validation

Plans say what the work will do; results bundles show what it did. The execution loop captures them automatically as agent-curated, `curatedBy`-labeled bundles; direct `/aict:results` and `/sync` captures retain the student interview. Each path creates a **versioned, immutable bundle** per component at `plans/execution/<component>/results/rN/`: a brief agent-drafted report, snapshot copies of the figures and tables (sha256-matched against their sources; files over 5 MB are recorded by path + checksum instead of copied), the exact scripts that produced them, and the key numbers as metric tiles. Capture goes through a staging directory and an atomic rename, so a bundle either exists complete or not at all. Re-running an analysis can never silently change the captured record — a redo is the next `rN`.

Bundles are journal-first: the project's CLAUDE.md carries output conventions with a target journal, so analysis deliverables are journal-ready figures (vector PDF + PNG) and typeset tables (a `.png` render with its `.tex` source and estimates CSV attached) — a CSV is click-to-open data, never dumped inline on the board. Every planned capture also runs an automatic **validation**: an independent subagent compares the governing plan version against the staged scripts, artifacts, and decision log, and its per-step result (conforms / conforms-with-amendments / deviations-found) is sealed into the bundle and rendered on the board. The governing version is the latest canonical signed plan or recorded amendment named by `manifest.planVersion`. Capture also seals a mechanical **integrity check** into the manifest — artifact checksums match, references resolve, and every substantive finding is sourced to an artifact. Both are advisory, never a gate — an unrecorded deviation is flagged, and the remedy is a plan revision.

On the board's Output & Validation view you review a bundle — its validation audit, integrity check, stat tiles, figure/table gallery, and a per-artifact "produced by" script drawer with line-anchored comments. Validation is the bundle's standing state and sets the tracker to `done (validated)`, `done (unvalidated)`, or `done (retrofit)` as appropriate. A finalized bundle is immutable. Use **Reopen** with comments to request a script fix and a re-run, which is captured as the next bundle. The board shows any legacy pre-v0.20 verdict read-only. The narrative report lives on the separate **Reports** view; a **Generate report** button (also offered by `/aict:results` at capture end) assembles the bundle into a standalone shareable report (markdown plus PDF/DOCX via pandoc) under `plans/reports/`, with each figure embedded under the finding it supports and a first-line marker the board uses to flag stale reports. A bundle with no substantive findings gets no report — `/aict:report` refuses, and the board shows a null-result state instead of an empty document.

**Adopting the workflow mid-project?** `/aict:results --adopt` scans your output folders, lets you pick which existing figures/tables matter, and files them as bundles marked `retrofit` — honest that no plan governed their production, reviewable and verifiable all the same.

**Plans ran ahead of your results record?** `/aict:results` with **no argument** is reconcile mode: it walks the tracker for components that are done but bundle-less or whose captured sources have drifted, and backfills them one interview at a time. Work that a signed plan or recorded amendment governed but was captured after the fact is marked `late` — the same honesty rule as the decision log's late-captured entries: backfilling is fine, unlabeled backfilling is not.

## Model profiles

Different stages deserve different models: planning is where quality compounds (strongest model, max effort), execution is interactive and iterative (a fast cheap model stretches subscription quota), and review or validation are short judgment tasks where a smarter prior beats longer thinking. `/aict:init` asks whether to use the recommended per-stage defaults or choose your own, then writes a per-project profile at `plans/model-profile.md` (committed). You can edit it later with `/aict:models`, or inline on the board's **Models** tab when it's served live — the board rewrites `plans/model-profile.md` and regenerates the `aict-*` review agents itself (nudge-stage edits apply immediately; agent-stage edits are flagged for a session restart).

Two mechanisms, named in the profile's mechanism column:

- **nudge** — interactive stages (`/plan`, `/sync`, execution) print one line when your session model differs from the profile's, suggesting `/model <model>` (switching mid-conversation is safe — nothing is lost). Plan and sync nudges are advisory; the model selected in the `/execute` prompt is an explicit choice, so the loop waits for that switch.
- **agent** — delegated stages (plan review, results validation, the board's subagent reviews) run in generated project agents at `.claude/agents/aict-*.md` (committed, ownership-marked: `/models` never overwrites a same-named agent you wrote yourself), whose frontmatter pins the profile's model and effort. The pin is a request, not a guarantee — an organization model allowlist, `CLAUDE_CODE_SUBAGENT_MODEL`, or a per-invocation override supersedes it silently.

Projects without a profile behave exactly as before. Model profiles need a current Claude Code (tested on Claude Code 2.1.206) for agent `effort:` frontmatter — older builds run the agents on their default model resolution and ignore the effort request.

## The sign-off gate

For how versions, revisions, and amendments relate in plain terms, see [How versioning works](../QUICKSTART.md#how-versioning-works) in the Quickstart. This section covers how sign-off is enforced.

Signing a plan is enforced, not offered. `/aict:execute` opens a slim sign session for pending drafts before work begins; `/aict:sign` opens the same session without starting execution. You approve each exact draft or request changes with annotations and a note. An approval writes a content-hash-bound ticket, and the finalization transaction copies the approved draft into its canonical `vN.md` with the `Signed off:` trailer. Tickets and `.sign-feedback-vN.md` files survive interruption, so rerunning `/sign` recovers the session from disk.

The plugin also ships a PreToolUse hook. It denies edits and overwrites of every existing canonical `vN.md`. A direct write to a new canonical version opens the same sign UI through the hook transport. `/sync` may write a next consecutive version with an `Amendment recorded, YYYY-MM-DD` trailer without claiming a human sign decision. Re-execution materializes and signs a fresh commitment to that amendment.

**Scope and honesty:** the gate covers Claude's Write and Edit tools. Bash-mediated file writes, including shell redirection and scripts, are outside the matcher; the plugin workflow uses Write for canonical plans. The immutability convention and the review's revisability check cover after-the-fact edits. The gate activates only in projects that opted in with both markers. For headless or CI work, set `AICT_NO_GATE=1`; the bypass leaves a visible trace in the transcript. The hook-transport wait ceiling is 25 minutes (`AICT_GATE_TIMEOUT`, clamped), and an unanswered gate denies safely. These boundaries are why the invariant is scoped to the gated Write and Edit workflow.

Board and sign servers use these exit codes:

| Code | Meaning |
|------|---------|
| `0` | A live-board order arrived, a ticket sign session ended with its decisions saved, or the hook transport approved the plan. |
| `2` | The hook sign transport timed out without a decision. The draft is preserved. |
| `3` | The hook sign transport returned a change request. |
| `4` | The live board detected stale content and must regenerate. |
| `5` | A persistent board closed for a sign-session handoff. Do not relaunch it; the sign session owns the browser. |
| `130` | The student or process cancelled the session. |

The same hook also enforces **results-bundle immutability**: writes inside an existing `results/rN/` are denied. Pre-v0.20 compatibility still permits one-time creation of `verdict.json` — a legacy path; v0.20 workflows no longer write verdicts. This branch is pure file policy — it never opens a browser, so results capture can't deadlock on it. There is deliberately no results gate.

## What it creates in your project

```
plans/
├── master-plan.md              roadmap + components tracker
├── decision-log.md             append-only, timestamped
├── model-profile.md            per-stage model and effort preferences
├── board.html                  optional shareable snapshot (regenerate, never edit)
├── archive/
│   └── master-plan-<date>.md   archived by /renew; immutable renewal record
├── reports/
│   └── 02-analysis-r1-report.md (+ .pdf/.docx)   shareable, regeneratable
├── reviews/
│   └── 02-analysis-v1.md       saved rubric scorecards
└── execution/
    └── 01-data-cleaning/
        ├── v1.md               a signed plan
        ├── v2.md               a recorded amendment; v1 is never edited
        ├── .draft-v3.md        pending re-commitment; signs at /execute or /sign
        └── results/
            ├── r1/             an immutable results bundle
            │   ├── manifest.json   what's here, plan version, provenance, metrics, validation
            │   ├── report.md       brief agent-drafted report
            │   ├── validation.md   plan-vs-execution audit (independent subagent)
            │   ├── verdict.json    legacy verdict (pre-v0.20), written once
            │   ├── artifacts/      figure/table snapshots (sha256-matched)
            │   └── scripts/        the code that produced them
            └── r2/             a redo; r1 is never edited
```

Plus a short marked section in your project's `CLAUDE.md` so every future session follows the conventions, and `./aict-board` in the project root — the machine-specific board launcher, excluded from git through `.git/info/exclude`. Unsigned working drafts (`.draft-vN.md`), sign feedback (`.sign-feedback-vN.md`), results staging directories (`.staging-*`), and board bookkeeping files are gitignored automatically.

## Install, updating, and pinning

### Install

In Claude Code:

```
/plugin marketplace add snnlab/papertrail_v0
/plugin install aict@aict
```

Then restart Claude Code. See [QUICKSTART.md](../QUICKSTART.md) for a walkthrough.

### Updating

When a new version ships, a one-time notice appears at session start naming the exact command. To update:

```
/plugin update aict@aict
/reload-plugins
```

(then restart Claude Code if a component doesn't pick up).

To update automatically instead, enable auto-update once: open `/plugin`, go to **Marketplaces**, select **aict**, and turn on auto-update. Claude Code then updates the plugin at startup and prompts you to run `/reload-plugins`.

To silence the update notice (e.g. on an intentionally pinned install), set `AICT_NO_UPDATE_CHECK=1` in the `env` block of `~/.claude/settings.json` (not `.zshrc` — a hook launched by Claude Code may not source your shell profile):

```
{ "env": { "AICT_NO_UPDATE_CHECK": "1" } }
```

### Installing a specific version

AICT is a fresh fork (starting at `v0.1.0`) with no version history of its own yet — there is no old plugin name or renamed repo to account for when pinning a release. Once later tags exist, pin one the same way any Claude Code plugin pins a tag: add a local marketplace file whose entry names the tag, then install from it.

Create `aict-pinned/.claude-plugin/marketplace.json` — this example pins `v0.1.0`:

```
{
  "name": "aict-pinned",
  "plugins": [
    {
      "name": "aict",
      "source": { "source": "github", "repo": "snnlab/papertrail_v0", "ref": "v0.1.0" }
    }
  ]
}
```

Then:

```
/plugin marketplace add ./aict-pinned
/plugin install aict@aict-pinned
```

The equivalent fallback, if your Claude Code build prefers it, is to check out the tag locally (`git checkout v0.1.0`) and `/plugin marketplace add` the repo's local path. On a pinned install, set `AICT_NO_UPDATE_CHECK=1` — see [Updating](#updating) — so you aren't reminded about newer releases you deliberately skipped.

## Developing the board

The board UI is a React app in `board/`, built once into a single committed HTML template at `skills/managing-aict/assets/board-template.html`. The core plan-review-execute-tail workflow needs only `python3` — `board.py` just injects data into the prebuilt template; web sharing (`--publish-web` and friends) additionally needs Node.js, for the Vercel CLI. Changing the UI itself also needs Node, to rebuild that template:

```
cd board
npm install
npm run dev      # develop against sample data
npm test         # contract-parser tests (drift alarm for the artifact formats)
npm run build    # regenerates the committed template
```

If you change any artifact format (templates or the commands that write them), the parser tests in `board/src/lib/parse.test.ts` are the alarm that the board needs updating.

## Works well with

**Works well with.** The workflow is self-contained, but pairs well with general process plugins — e.g. superpowers (TDD and worktree discipline for code-heavy components) or plannotator (in-browser plan annotation). Optional: nothing here depends on them, and plan documents always follow this plugin's own template and review flow.
