# Model profile

<!-- aict:model-profile -->

How each aict stage picks a Claude model. Two mechanisms — **nudge**: Claude tells you the profile's model for this stage and suggests `/model`; you decide. **agent**: this delegated stage runs on the profile's model automatically (best-effort — an org model allowlist, `CLAUDE_CODE_SUBAGENT_MODEL`, or a per-invocation override can supersede the request). `inherit` in a model cell means "whatever your session is using."

| stage | model | effort | mechanism |
|---|---|---|---|
| plan (co-authoring) | opus | max | nudge |
| execute (analysis) | sonnet | — | nudge |
| sync | inherit | — | nudge |
| plan review (verdict + grade) | opus | medium | agent |
| results validation | sonnet | low | agent |
| board reviewer panel | sonnet | low | agent |

Why these defaults: planning is where quality compounds, so it gets the strongest model at max effort. Execution is interactive and iterative, so a fast cheap model stretches subscription quota. Plan review keeps opus because its five-channel score is a graded output the student is held to. Results validation and the board panel do not: both compare a document against a fixed contract and return structured JSON, and the panel spawns THREE agents per run — the single most expensive action in the tool — for advisory comments the student then curates. Sonnet is enough for that, and the saving is real. `effort` on nudge rows is advisory; on agent rows it is written into the generated agent file.

After hand-editing this table, run `/aict:models` to validate it and regenerate the agents in `.claude/agents/` — a silent typo in a row otherwise just stops that stage's nudge or pin.
