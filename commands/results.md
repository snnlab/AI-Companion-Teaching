---
description: Capture or reconcile versioned results bundles; use --adopt for pre-existing artifacts
argument-hint: [component name/number | --adopt | (none = reconcile all)]
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Task, Bash(python3:*), Bash(python:*), Bash(Rscript:*), Bash(bash:*), Bash(tee:*), Bash(mkdir:*), Bash(git:*), Bash(ls:*), Bash(date:*)
---

Capture results for review on the board. Skill context: `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/SKILL.md`. Mechanics script: `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/scripts/results.py` (python3 only). Requires an initialized project (`plans/master-plan.md` with its marker); if absent, say so and stop.

1. **Resolve the mode.** `$ARGUMENTS` names a component (name or number, via the master plan tracker) → single capture, step 2. For `--adopt`, load `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/references/results-adopt.md` and follow **Adopt existing results**. With no argument, load the same reference and follow **Reconcile missing results**.

2. **Capture.** Load `${CLAUDE_PLUGIN_ROOT}/skills/managing-aict/references/capture.md` and follow
   its steps 2–7 in **interactive** mode: reproduce and gather candidates, interview the student,
   stage, write `report.md` and `manifest.json`, validate, finalize. That file is the single copy of
   this procedure — the execution loop follows the same steps in autopilot mode.
