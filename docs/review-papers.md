# Review papers (systematic / PRISMA-style)

AICT was built around a quantitative-methods worked example (see [QUICKSTART.md](../QUICKSTART.md)), but the workflow itself — plan a component, get it scored, sign it, execute it, capture a verified results bundle, report — governs *any* structured research process, not just statistical modeling. A systematic literature review has its own real methodology (a search strategy, screening with inclusion/exclusion criteria, extraction, appraisal, synthesis), and every mechanical part of AICT already supports it without any code change: the execution-plan template, the results-bundle schema, and the five-channel rubric are all written in method-agnostic language. This page shows exactly how the pieces map, so you don't have to guess.

## Getting started

Run `/aict:init` as usual. The very first question it asks is the paper type:

> **Is this paper a quantitative analysis, or a literature review?**

Answer **literature review**. This decides which `CLAUDE.md` conventions block gets installed — a review-specific rewrite of two rules (output conventions, and what counts as evidence), described below — and it shapes the example components the interview proposes. Everything else about the interview (the paper itself, the research questions, the data question, the course/deadline context) works exactly as in QUICKSTART.md; for "the data," answer with your search sources instead of a dataset — e.g. *"source = Web of Science, Scopus, and PsycINFO database exports; rough size = ~450 records pre-dedup, ~200 after screening; sensitivity = none (published literature, no human-subjects data)."*

## Components

For a review, components are the review's own methodological stages. Propose only the ones this review actually needs — a scoping review might skip quality appraisal; a small review might fold extraction and appraisal into one pass:

| # | Review step | Serves |
|---|---|---|
| 1 | search-strategy | RQ1 |
| 2 | screening | RQ1 |
| 3 | extraction | RQ1 |
| 4 | quality-appraisal | RQ1 |
| 5 | synthesis | RQ1 |

## A worked example: the screening component

`/aict:plan` walks through the same dimension-by-dimension dialogue as any other component. For screening, the consequential decisions look like this:

| Dimension | Decision | Why |
|---|---|---|
| **Inclusion criteria** | Peer-reviewed empirical studies, 2010–2025, English or Korean, adult samples | Sets the search's substantive scope directly to RQ1; 2010 cutoff matches when the field's dominant measurement instrument was validated, so earlier studies aren't comparable on the key construct. |
| **Screening levels** | Title/abstract pass, then full-text pass, both by the same reviewer (solo review — no second coder) | A single-reviewer design is a real limitation to disclose in the paper's methods section, not something to paper over; recording it here means it's never silently forgotten later. |
| **Disagreement resolution** | Not applicable (single reviewer) — borderline cases get a documented note in the extraction table instead of a second-rater discussion | Makes the absence of inter-rater reconciliation an explicit, defensible choice rather than an unstated gap. |

This is exactly the same rubric channel ("Decisions and reasons") that scores a statistical model's covariate choices — a shallow reason ("because that's the inclusion criteria") scores as low here as it would for a regression specification chosen with no justification.

**Build steps**, at the same "did the agent do this?" grain QUICKSTART.md describes for a model fit:

1. Run the search strings from `01-search-strategy` against each database; export raw results with timestamps.
2. Deduplicate; record the pre/post-dedup counts.
3. Title/abstract screen against the inclusion criteria above; log each exclusion with its reason (for the PRISMA diagram's exclusion-reason breakdown).
4. Full-text screen the survivors the same way.
5. Produce the PRISMA flow diagram from the counts at each stage.

**Verification** (what confirms the goal was actually met, not just that steps ran): the PRISMA diagram's counts reconcile exactly against the logged search-export and exclusion-reason records; every excluded study at the full-text stage has a logged reason.

## Decision log

Real judgment calls get logged the moment they happen, exactly like the CLPM-vs-RI-CLPM example in QUICKSTART.md:

```
## 2026-08-25 14:20

**Context:** Deciding which databases to search.
**Question (Claude):** Web of Science and Scopus cover the core journals, but PsycINFO
    would catch clinical-psychology venues this RQ also touches. Add it, or keep the
    search to two databases for time?
**Response (student):** Add PsycINFO — RQ1 is specifically about a construct that shows
    up more in clinical journals than sociology ones, so skipping it would bias the
    corpus toward one disciplinary framing.
**Effect on execution:** `01-search-strategy` names three databases instead of two.
```

## Results bundle

`/aict:results` captures a review component's outputs the same way it captures a regression table — the only difference is `producedBy`. When an artifact came from a script (e.g. a Python script that queried an API and logged results), `producedBy` names it as usual. When an artifact was produced by hand — screening decisions made by the student reading abstracts, an extraction table filled in from reading full texts — `producedBy: null` is the *correct*, fully valid value, not a workaround: `commands/results.md` says explicitly, *"Never guess a producing script — record `producedBy: null` if unknown."*

A typical screening/extraction bundle:

- **`artifacts/prisma-flow-diagram.png`** — `kind: "table"` or `"figure"`, `producedBy: null` (drawn by hand from the logged counts, or produced by a diagramming tool with no script).
- **`artifacts/extraction-table.csv`** — `kind: "other"` (`commands/results.md`: *"A standalone CSV or spreadsheet captured without a render is `kind: 'other'`"*), `producedBy: null`.
- A **metric/finding** with no numbers at all beyond a count is still fully valid: `{"label": "Studies meeting inclusion criteria", "value": "14 of 212", "statement": "14 of 212 screened studies met inclusion criteria after full-text review.", "status": "robust"}` — `results.py`'s substantive-finding check has no numeric-type requirement anywhere in it.

`/aict:report`'s narrative synthesis section is just prose under a heading — it doesn't have to be a table or figure at all.

## The rubric scores a review plan on equal footing

`docs/plan-rubric.md`'s five channels (Goal & success, Decisions & reasons, Steps, Validation, Boundaries) never reference statistics or code in their actual scoring clauses — the quant phrasing that appears is always inside an illustrative parenthetical, never the rule itself. The Validation channel's top anchor even names **citation validation** by name as a first-class check: *"Concrete tests or checks — executable tests, data audits, **citation validation**, named outputs a human will review — that let the agent or student confirm each success criterion was actually met."* A screening plan with a stated inclusion-criteria checklist and a PRISMA-count reconciliation step scores identically well, on the same 0–3 anchors, as a regression plan with a pre-registered fit-index threshold.

## Everything else is unchanged

Signing (`/aict:sign`), the execution loop (`/aict:execute`), sync (`/aict:sync`), the board (`/aict:board`), and submitting to an instructor's roster (`/aict:submit`) work identically for both paper types — none of them branch on `paperType` at all. Read [QUICKSTART.md](../QUICKSTART.md) for those steps; only the examples in it are quant-flavored, not the mechanics.
