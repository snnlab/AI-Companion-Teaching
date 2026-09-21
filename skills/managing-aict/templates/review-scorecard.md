# Review — <Component> v<N>

Plan: [<v<N>.md or .draft-v<N>.md>](<the scored file's actual relative path: ../execution/<NN-slug>/v<N>.md or ../execution/<NN-slug>/.draft-v<N>.md; amendment re-commitment candidates use the draft path>) · Rubric: plan-rubric.md (v0.4) · Date: <YYYY-MM-DD>
Profile: **G<0-3> · D<0-3> · S<0-3> · V<0-3> · B<0-3> = <total>/15**
Flags: **<none | uncommitted | unsupported-sources | unrecorded-deviation …>** <!-- non-scored workflow-integrity flags; omit or "none" when clean -->
<!-- On an unreadable plan, replace the Profile/Flags lines with: Status: **unscorable — <what cannot be extracted>** and omit the channel table. -->

## Channels

<One row per channel, exactly five. The prose table and the JSON block below MUST agree — the board renders the JSON.>

| Channel | Score | Evidence | Justification |
|---------|-------|----------|---------------|
| Goal & success | <0-3> | "<quote>" | <one line> |
| Decisions & reasons | <0-3> | "<quote>" | <one line> |
| Steps | <0-3> | "<quote>" | <one line> |
| Validation | <0-3> | "<quote>" | <one line> |
| Boundaries | <0-3> | "<quote>" | <one line> |

## Diagnosis

- **Biggest leak:** <lowest channel — where the most authorship is being handed to the agent>.
- **Unresolved forks:** <the specific open decisions dragging the score down — the fix-it list for the next revision>.
- **Suggested moves:** <one concrete move per leak>.

## Split assessment

<"Right-sized" with a reason, or the concrete proposed split per split-criteria.md. Always included.>

## Data

```json board-scorecard
{"schemaVersion": 3, "status": "scored", "component": "<NN-slug>", "planVersion": <N>,
 "planPath": "<the scored file's path exactly as resolved — plans/execution/<NN-slug>/v<N>.md, or plans/execution/<NN-slug>/.draft-v<N>.md for a pre-sign-off draft>", "rubricVersion": "0.4", "date": "<YYYY-MM-DD>",
 "channels": [
   {"id": "goal",       "name": "Goal & success",      "score": 3, "evidence": "<quote>", "justification": "<one line>"},
   {"id": "decisions",  "name": "Decisions & reasons",  "score": 2, "evidence": "<quote>", "justification": "<one line>"},
   {"id": "steps",      "name": "Steps",                "score": 2, "evidence": "<quote>", "justification": "<one line>"},
   {"id": "validation", "name": "Validation",           "score": 1, "evidence": "<quote>", "justification": "<one line>"},
   {"id": "boundaries", "name": "Boundaries",           "score": 0, "evidence": "<quote>", "justification": "<one line>"}
 ],
 "total": 8, "max": 15, "profile": "G3·D2·S2·V1·B0",
 "biggestLeak": {"channel": "boundaries", "note": "<where the most authorship is handed to the agent>"},
 "suggestedMoves": ["<one concrete move per leak>"],
 "unresolvedForks": ["<open decision 1>", "<open decision 2>"],
 "integrityFlags": [{"id": "uncommitted", "note": "<why>"}],
 "split": {"verdict": "right-sized", "detail": "<one paragraph>"}}
```

<An unreadable plan uses instead: {"schemaVersion": 3, "status": "unscorable", "component": "<NN-slug>", "planVersion": <N>, "planPath": "<the scored file's path exactly as resolved — v<N>.md, or .draft-v<N>.md for a pre-sign-off draft>", "rubricVersion": "0.4", "date": "<YYYY-MM-DD>", "reason": "<what cannot be extracted and how to fix it>"} — no channels, no total, no profile.>
