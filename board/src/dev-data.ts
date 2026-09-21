// Sample payload for `npm run dev` only. The string PB_BOARD_DEV_DATA below is
// a tree-shake sentinel: the build check greps the built template to confirm
// this module was eliminated from production output.
import type { BoardData } from "./lib/types";

const MARKER = "PB_BOARD_DEV_DATA";

const masterPlan = `<!-- aict:master-plan -->
# Immigration Attitudes (ISSP) — Master Plan

Last updated: 2026-07-02
Initialized: 2026-06-28 09:15
Renewed: 2026-07-02 — pivot from panel attrition to cross-national variation

## Project context

This project is a cross-national analysis of immigration attitudes using ISSP data (${MARKER}). It asks how support for immigration varies across countries and what individual- and country-level factors account for that variation.

The hard constraint is the deadline: end of July 2026.

### Research questions

1. RQ1: How does public support for immigration vary across countries and over time?
2. RQ2: Which individual- and country-level factors are associated with that variation?

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|-----------|--------|----------------|-----------------|--------|
| 1 | Data acquisition | done | — | ISSP sample in repo | — |
| 2 | Data cleaning | done | [v2](execution/02-data-cleaning/v2.md) | 66,864 rows after exclusions | RQ1, RQ2 |
| 3 | Descriptive analysis | in progress | [v1](execution/03-descriptives/v1.md) | — | RQ1 |
| 4 | Regression modeling | planned | [v2](execution/04-regression/v2.md) | amendment awaits re-commitment | RQ2 |

Statuses: \`not started\` / \`planned\` / \`in progress\` / \`done\` / \`dropped\`.

## Foundations

Renewed 2026-07-02 from archive/master-plan-2026-07-02.md. Carried: data acquisition, data cleaning. Not carried: 09-attrition-pilot (superseded by the new direction) — its plans and results remain browsable.
`;

const archivedMasterPlan = `<!-- aict:master-plan -->
# Immigration Attitudes (panel attrition) — Master Plan

Last updated: 2026-07-01
Initialized: 2026-06-28 09:15

## Project context

The original direction: panel attrition in immigration-attitude items (${MARKER}).

### Research questions

1. RQ1: Does item nonresponse on immigration attitudes predict panel attrition?

## Components

| # | Component | Status | Execution plan | Outcome / notes | Serves |
|---|-----------|--------|----------------|-----------------|--------|
| 1 | Data acquisition | done | — | ISSP sample in repo | — |
| 9 | Attrition pilot | done | [v1](execution/09-attrition-pilot/v1.md) | dead end — pivoted | RQ1 |
`;

const attritionPilotV1 = `# Attrition Pilot — Execution Plan v1

Component: \`09-attrition-pilot\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-06-29

## Goal and success criteria

Serves: RQ1

Pilot whether item nonresponse predicts attrition.

## Context

Pre-renewal exploratory component; superseded by the cross-national pivot.

## Approach

Logit of wave-2 dropout on wave-1 item nonresponse.

## Build steps

1. Build the dropout indicator.
2. Fit the logit.

## Verification

Researcher reviews the coefficient table.

## Out of scope

Any cross-national comparison.

---
Signed off: Jane Doe, 2026-06-29
`;

const decisionLog = `# Decision Log

Append-only. Entries are timestamped and written as decisions happen.

## 2026-07-01 10:12

**Context:** Starting data cleaning under plan v1.
**Question (Claude):** The codebook lists 97/98 as refusal codes for the support item. Treat as missing?
**Response (researcher):** Yes — recode to NA; add a count to the cleaning log.
**Effect on execution:** Added recode step; 431 rows affected.

## 2026-07-01 15:40

**Context:** Cleaning revealed duplicated household IDs in two countries.
**Decision (Claude):** Flagged rather than dropped — awaiting researcher call.
**Response (researcher):** Drop exact duplicates only; keep the rest.
**Effect on execution:** Plan revision proposed (v2) to record the exclusion rule.

## 2026-07-02 09:05 (late-captured at sync)

**Context:** Yesterday's session ended without logging the weighting decision.
**Question (Claude):** Use ISSP design weights in descriptives?
**Response (researcher):** Yes, weighted and unweighted side by side.
**Effect on execution:** Descriptives plan updated before execution.
`;

const cleaningV1 = `# Data Cleaning — Execution Plan v1

Component: \`02-data-cleaning\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-06-30

## Context

Prepare the ISSP extract for analysis: recode missing values, harmonize country codes, and produce a documented analysis sample.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Missing codes | Recode 97/98 to NA | Codebook lists them as refusals |
| Countries | Keep all 31 | Attrition handled at modeling stage |

## Approach

Load raw extract, apply recode table, write cleaned parquet + cleaning log.

## Build steps

1. Load raw CSV
2. Apply missing-value recodes
3. Write cleaned data + row-count log

## Verification

Row counts before/after each step logged; spot-check 20 random rows against raw.

## Out of scope

No imputation; no derived scales (descriptives component owns those).

---
Signed off: Jane Doe, 2026-06-30
`;

const cleaningV2 = `# Data Cleaning — Execution Plan v2

Component: \`02-data-cleaning\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-01
Supersedes: v1 — duplicated household IDs discovered in two countries; added an explicit exclusion rule.

## Context

Prepare the ISSP extract for analysis: recode missing values, harmonize country codes, and produce a documented analysis sample.

## Goal and success criteria

Serves: RQ1, RQ2

Produce a documented analysis sample from the raw ISSP extract. Success: every recode and exclusion is logged with row counts; the cleaned file reproduces exactly from the committed script; the duplicate report is reviewed and signed off by the researcher.

## Decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Missing codes | Recode 97/98 to NA | Codebook lists them as refusals |
| Countries | Keep all 31 | Attrition handled at modeling stage |
| Duplicates | Drop exact duplicates only | Household IDs collide in two countries; partial matches kept |

## Approach

Load raw extract, apply recode table, drop exact duplicates, write cleaned parquet + cleaning log.

## Build steps

1. Load raw CSV
2. Apply missing-value recodes
3. Drop exact duplicate rows (log counts per country)
4. Write cleaned data + row-count log

<details class="agent-detail"><summary>Agent detail — exact commands</summary>

\`\`\`bash
python3 clean/build_sample.py --in raw/issp.csv --out data/clean.parquet --log logs/clean.log
\`\`\`

</details>

## Verification

Row counts before/after each step logged; spot-check 20 random rows against raw; duplicate report reviewed by researcher.

## Out of scope

No imputation; no derived scales (descriptives component owns those). Do not modify the raw extract.

---
Signed off: Jane Doe, 2026-07-01
`;

const cleaningV3 = `# Data Cleaning — Execution Plan v3

Component: \`02-data-cleaning\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-03
Supersedes: v2 — execution found two country files with a second missing-value code.

## Context

Record the additional missing-value recode used during execution.

## Goal and success criteria

Serves: RQ1, RQ2

The cleaning log must include code 99 alongside 97 and 98 for the two affected countries.

## Decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Missing codes | Recode 99 in the two documented country files | Their codebooks define it as item nonresponse |

## Build steps

1. Recode 99 only where the country codebook defines it as missing.

## Verification

Check the cleaning log against both country codebooks.

## Out of scope

Do not change missing-value rules for other countries.

Amendment recorded, 2026-07-03
`;

const regressionV1 = `# Regression Modeling — Execution Plan v1

Component: \`04-regression\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-04

## Context

Estimate individual and country predictors of immigration support.

## Goal and success criteria

Serves: RQ2

Produce the prespecified multilevel model and a journal-ready coefficient figure.

## Build steps

1. Fit the multilevel model.

## Verification

Check convergence and reproduce the coefficient figure from the saved script.

## Out of scope

Do not add country-level interactions.

Signed off: Jane Doe, 2026-07-04
`;

const regressionV2 = `# Regression Modeling — Execution Plan v2

Component: \`04-regression\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-05
Supersedes: v1 — record the agreed random-slope specification.

## Context

Record the random slope added after the first model review.

## Goal and success criteria

Serves: RQ2

Estimate the support-item slope by country and report its variance.

## Build steps

1. Add the country-level random slope.

## Verification

Compare convergence and fit against v1.

## Out of scope

Do not add cross-level interactions.

Amendment recorded, 2026-07-05
`;

const descriptivesV1 = `# Descriptive Analysis — Execution Plan v1

Component: \`03-descriptives\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-02
Provenance: retrospective — written 2026-07-02; covers work executed 2026-06

## Context

Describe the analysis sample: distribution of the support item by country and year, weighted and unweighted.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Weights | ISSP design weights, shown alongside unweighted | Comparability with published CRI descriptives |

## Approach

Compute per-country summaries, export table + one figure.

## Build steps

1. Weighted and unweighted means by country
2. Figure: country means with CIs

## Verification

Totals cross-checked against cleaning log row counts.

## Out of scope

No models; no country-level covariates yet.

---
Signed off: Jane Doe, 2026-07-02
`;

const descriptivesDraft = `# Descriptive Analysis — Execution Plan v2

Component: \`03-descriptives\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-02
Supersedes: v1 — reviewer asked for item-level missingness table before means.

## Goal and success criteria

Serves: RQ1

Describe cross-country variation in immigration support with honest missingness reporting. Success: a per-country table (weighted and unweighted) plus a missingness table, each cross-checked against the cleaning log row counts.

## Context

Describe the analysis sample: distribution of the support item by country and year, weighted and unweighted, plus item-level missingness.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Weights | ISSP design weights, shown alongside unweighted | Comparability with published CRI descriptives |
| Missingness | Item-level table by country | Reviewer request; informs listwise-deletion defense |

## Approach

Compute missingness table, then per-country summaries, export tables + one figure.

## Build steps

1. Item-level missingness by country
2. Weighted and unweighted means by country
3. Figure: country means with CIs

## Verification

Totals cross-checked against cleaning log row counts.

## Out of scope

No models; no country-level covariates yet.
`;

// Committed within-version draft iterations (feature #1) — the path from the
// first reaction to the reviewer through to the (still unsigned) working draft.
const descriptivesSnap1 = `# Descriptive Analysis — Execution Plan v2

Component: \`03-descriptives\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-02
Supersedes: v1 — reviewer asked for item-level missingness table before means.

## Goal and success criteria

Serves: RQ1

Describe cross-country variation in immigration support. Success: a per-country table (weighted and unweighted), cross-checked against the cleaning log row counts.

## Context

Describe the analysis sample: distribution of the support item by country and year, weighted and unweighted.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Weights | ISSP design weights, shown alongside unweighted | Comparability with published CRI descriptives |

## Approach

Compute per-country summaries, export table + one figure.

## Build steps

1. Weighted and unweighted means by country
2. Figure: country means with CIs

## Verification

Totals cross-checked against cleaning log row counts.

## Out of scope

No models; no country-level covariates yet.
`;

const descriptivesSnap2 = `# Descriptive Analysis — Execution Plan v2

Component: \`03-descriptives\` · Master plan: [master-plan.md](../../master-plan.md) · Date: 2026-07-02
Supersedes: v1 — reviewer asked for item-level missingness table before means.

## Goal and success criteria

Serves: RQ1

Describe cross-country variation in immigration support with missingness reporting. Success: a per-country table plus a missingness table.

## Context

Describe the analysis sample: distribution of the support item by country and year, weighted and unweighted, plus item-level missingness.

## Scope decisions

| Dimension | Decision | Why |
|-----------|----------|-----|
| Weights | ISSP design weights, shown alongside unweighted | Comparability with published CRI descriptives |
| Missingness | Item-level table by country | Reviewer request |

## Approach

Compute missingness table, then per-country summaries, export tables + one figure.

## Build steps

1. Item-level missingness by country
2. Weighted and unweighted means by country
3. Figure: country means with CIs

## Verification

Totals cross-checked against cleaning log row counts.

## Out of scope

No models; no country-level covariates yet.
`;

const review = `# Review — Data Cleaning v2

Plan: [v2.md](../execution/02-data-cleaning/v2.md) · Rubric: plan-rubric.md (v0.4) · Date: 2026-07-02
Profile: **G3 · D3 · S2 · V2 · B2 = 12/15**
Flags: **none**

## Channels

| Channel | Score | Evidence | Justification |
|---------|-------|----------|---------------|
| Goal & success | 3 | "a clean ISSP extract with < 2% missing on key vars" | Checkable criteria |
| Decisions & reasons | 3 | "drop duplicate household IDs — a known ISSP export bug" | Grounded, goal-linked |
| Steps | 2 | "Build steps 1–4" | Concrete; one step vague |
| Validation | 2 | "cross-check row counts against the codebook N" | Tests the goal |
| Boundaries | 2 | "No imputation; do not touch the raw extract" | Both stated |

## Diagnosis

- **Biggest leak:** Steps — step 3's recode is under-specified.
- **Unresolved forks:** the exact refusal-code handling.
- **Suggested moves:** name the recode rule for refusal codes.

## Split assessment

Right-sized: one coherent cleaning component with a single verification routine.

## Data

\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"02-data-cleaning","planVersion":2,
 "planPath":"plans/execution/02-data-cleaning/v2.md","rubricVersion":"0.4","date":"2026-07-02",
 "channels":[
  {"id":"goal","name":"Goal & success","score":3,"evidence":"a clean ISSP extract with < 2% missing on key vars","justification":"Checkable criteria"},
  {"id":"decisions","name":"Decisions & reasons","score":3,"evidence":"drop duplicate household IDs — a known ISSP export bug","justification":"Grounded, goal-linked"},
  {"id":"steps","name":"Steps","score":2,"evidence":"Build steps 1-4","justification":"Concrete; step 3 recode vague"},
  {"id":"validation","name":"Validation","score":2,"evidence":"cross-check row counts against the codebook N","justification":"Tests the goal"},
  {"id":"boundaries","name":"Boundaries","score":2,"evidence":"No imputation; do not touch the raw extract","justification":"Both stated"}],
 "total":12,"max":15,"profile":"G3·D3·S2·V2·B2",
 "biggestLeak":{"channel":"steps","note":"step 3's recode is under-specified"},
 "suggestedMoves":["Name the recode rule for refusal codes."],
 "unresolvedForks":["Exact refusal-code handling"],
 "integrityFlags":[],
 "split":{"verdict":"right-sized","detail":"One coherent cleaning component with a single verification routine."}}
\`\`\`
`;

const reviewV2Pass = `# Review — Descriptive Analysis v1

Plan: [v1.md](../execution/03-descriptives/v1.md) · Rubric: plan-rubric.md (v0.4) · Date: 2026-07-02
Profile: **G3 · D2 · S2 · V2 · B1 = 10/15**
Flags: **uncommitted**

## Channels

| Channel | Score | Evidence | Justification |
|---------|-------|----------|---------------|
| Goal & success | 3 | "a per-country table comparable to published CRI descriptives" | Checkable |
| Decisions & reasons | 2 | "use ISSP design weights" | Real but link to goal implicit |
| Steps | 2 | "weighted and unweighted side by side" | Concrete |
| Validation | 2 | "cross-check against the cleaning log N" | Tests the goal |
| Boundaries | 1 | "No models" | Out-of-scope only; no don't-touch |

## Diagnosis

- **Biggest leak:** Boundaries — nothing says what not to touch.
- **Unresolved forks:** the exact weight variable from the codebook.
- **Suggested moves:** name the weight variable; state what the analysis must not modify.

## Split assessment

Right-sized: one descriptive component with a single verification routine.

## Data

\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"03-descriptives","planVersion":1,
 "planPath":"plans/execution/03-descriptives/v1.md","rubricVersion":"0.4","date":"2026-07-02",
 "channels":[
  {"id":"goal","name":"Goal & success","score":3,"evidence":"a per-country table comparable to published CRI descriptives","justification":"Checkable"},
  {"id":"decisions","name":"Decisions & reasons","score":2,"evidence":"use ISSP design weights","justification":"Real but goal-link implicit"},
  {"id":"steps","name":"Steps","score":2,"evidence":"weighted and unweighted side by side","justification":"Concrete"},
  {"id":"validation","name":"Validation","score":2,"evidence":"cross-check against the cleaning log N","justification":"Tests the goal"},
  {"id":"boundaries","name":"Boundaries","score":1,"evidence":"No models","justification":"Out-of-scope only; no don't-touch"}],
 "total":10,"max":15,"profile":"G3·D2·S2·V2·B1",
 "biggestLeak":{"channel":"boundaries","note":"nothing says what not to touch"},
 "suggestedMoves":["Name the weight variable; state what the analysis must not modify."],
 "unresolvedForks":["The exact weight variable from the codebook"],
 "integrityFlags":[{"id":"uncommitted","note":"plan not committed before its outputs"}],
 "split":{"verdict":"right-sized","detail":"One descriptive component with a single verification routine."}}
\`\`\`
`;

const reviewV2Fail = `# Review — Regression Modeling v1

Plan: [v1.md](../execution/04-regression/v1.md) · Rubric: plan-rubric.md (v0.4) · Date: 2026-07-02
Profile: **G1 · D0 · S2 · V0 · B0 = 3/15**
Flags: **none**

## Channels

| Channel | Score | Evidence | Justification |
|---------|-------|----------|---------------|
| Goal & success | 1 | "fit the models" | Objective only; criteria implicit |
| Decisions & reasons | 0 | "use random forest, logit, OLS" | Choices with no reasons |
| Steps | 2 | "run each model, save output" | Concrete enough |
| Validation | 0 | "check the results" | Names no test of the goal |
| Boundaries | 0 | — | Nothing about limits |

## Diagnosis

- **Biggest leak:** three channels at 0 — most authorship is being handed to the agent.
- **Unresolved forks:** the estimand, the success threshold, the model rationale, the scope.
- **Suggested moves:** state the goal + success threshold; give each model a reason; name a validation test; bound the scope.

## Split assessment

Mixes main models and robustness; split into a main-models component and a robustness component.

## Data

\`\`\`json board-scorecard
{"schemaVersion":3,"status":"scored","component":"04-regression","planVersion":1,
 "planPath":"plans/execution/04-regression/v1.md","rubricVersion":"0.4","date":"2026-07-02",
 "channels":[
  {"id":"goal","name":"Goal & success","score":1,"evidence":"fit the models","justification":"Objective only; criteria implicit"},
  {"id":"decisions","name":"Decisions & reasons","score":0,"evidence":"use random forest, logit, OLS","justification":"Choices with no reasons"},
  {"id":"steps","name":"Steps","score":2,"evidence":"run each model, save output","justification":"Concrete enough"},
  {"id":"validation","name":"Validation","score":0,"evidence":"check the results","justification":"Names no test of the goal"},
  {"id":"boundaries","name":"Boundaries","score":0,"evidence":"","justification":"Nothing about limits"}],
 "total":3,"max":15,"profile":"G1·D0·S2·V0·B0",
 "biggestLeak":{"channel":"decisions","note":"three channels at 0 — most authorship handed to the agent"},
 "suggestedMoves":["State the goal + success threshold.","Give each model a reason.","Name a validation test.","Bound the scope."],
 "unresolvedForks":["The estimand","The success threshold","The model rationale","The scope"],
 "integrityFlags":[],
 "split":{"verdict":"split required","detail":"Mixes main models and robustness; split into a main-models component and a robustness component."}}
\`\`\`
`;

const FIG_SVG =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280"><rect width="480" height="280" fill="#fafaf9"/><g stroke="#a8a29e"><line x1="50" y1="240" x2="440" y2="240"/><line x1="50" y1="30" x2="50" y2="240"/></g><rect x="80" y="120" width="50" height="120" fill="#15803d"/><rect x="170" y="80" width="50" height="160" fill="#15803d"/><rect x="260" y="150" width="50" height="90" fill="#15803d"/><rect x="350" y="60" width="50" height="180" fill="#15803d"/><text x="240" y="20" font-size="13" text-anchor="middle" fill="#44403c">Support by wave (dev sample)</text></svg>',
  );

const cleaningReport = `# Results — Data cleaning (r1)

The cleaning pipeline ran end to end under plan v2. The analytic sample is
**66,864 rows** after the exclusion rules recorded in the plan; the duplicate
rule (drop exact household duplicates only) removed 214 rows.

Meets the plan's success criteria: row count within the expected range, all
recode counts logged. One anomaly worth eyes: wave 3 has a higher refusal
share (fig-support), consistent with the codebook note.
`;

const descriptivesReport = `# Results — Descriptives (r1, retrofit)

These figures existed before the workflow was adopted; captured for
verification. Weighted and unweighted means diverge most in waves 2-3.
`;

const reproFailReport = `# Results — Descriptives (r2, retrospective)

Backfilled from an earlier run. The country-means figure was produced inline in
the analysis notebook and never written to a file, and the notebook no longer
runs against the current data snapshot, so no figure could be reproduced for
this bundle. The headline number below is transcribed from the run log.
`;

const cleaningResults = [
  {
    resultsVersion: 1,
    dir: "plans/execution/02-data-cleaning/results/r1",
    manifest: {
      schemaVersion: 1,
      component: "02-data-cleaning",
      resultsVersion: 1,
      planVersion: 2,
      provenance: "planned" as const,
      trigger: "initial" as const,
      capturedAt: "2026-07-02 10:30",
      late: true,
      summary: "Cleaning pipeline output under plan v2 (backfilled)",
      validation: {
        status: "conforms-with-amendments" as const,
        validatedAt: "2026-07-02 10:31",
        planVersion: 2,
        validator: "subagent",
        steps: [
          {
            planStep: "recode missing values",
            verdict: "followed" as const,
            evidence: "02_clean.R lines 4-5; 431 rows in the cleaning log",
          },
          {
            planStep: "drop duplicate household IDs",
            verdict: "amended" as const,
            evidence: "exact-duplicates-only rule recorded in plan v2 (Supersedes v1)",
          },
          {
            planStep: "write cleaning log",
            verdict: "not-executed" as const,
            evidence: "no cleaning-log file among the outputs",
          },
        ],
        criteria: [
          {
            criterion: "documented analysis sample with exclusion counts",
            verdict: "met" as const,
            evidence: "exclusions.csv rows match the report",
          },
        ],
        notes: "The missing cleaning log is cosmetic; counts live in exclusions.csv.",
      },
      integrity: {
        status: "passed" as const,
        checkedAt: "2026-07-02 10:31",
        checks: [
          { name: "checksums", verdict: "pass" as const, detail: "all artifact copies match their source hashes" },
          { name: "artifacts-present", verdict: "pass" as const, detail: "all artifact files present in the bundle" },
          { name: "artifact-refs", verdict: "pass" as const, detail: "every metric references a real artifact" },
          { name: "findings-sourced", verdict: "pass" as const, detail: "every substantive finding cites an artifact" },
        ],
      },
      metrics: [
        { label: "Rows", value: "66,864", note: "analytic sample" },
        { label: "Dupes dropped", value: "214" },
        { label: "Refusals → NA", value: "431" },
      ],
      artifacts: [
        {
          id: "fig-support",
          kind: "figure" as const,
          title: "Support by wave",
          caption: "Weighted means; error bars omitted in dev sample.",
          file: "artifacts/fig-support.svg",
          source: {
            path: "output/figures/fig-support.svg",
            sha256: "d".repeat(64),
            bytes: 4210,
            oversized: false,
          },
          producedBy: {
            script: "scripts/02_clean.R",
            sourcePath: "code/02_clean.R",
            lang: "r",
          },
        },
        {
          id: "tab-model",
          kind: "table" as const,
          title: "Table 1. Support for immigration",
          caption: "Typeset render; .tex source and estimates CSV attached.",
          file: "artifacts/table1.png",
          tex: "artifacts/table1.tex",
          data: "artifacts/table1.csv",
          source: {
            path: "output/tables/table1.png",
            sha256: "a".repeat(64),
            bytes: 20480,
            oversized: false,
          },
          producedBy: {
            script: "scripts/02_clean.R",
            sourcePath: "code/02_clean.R",
            lang: "r",
          },
        },
        {
          id: "tab-exclusions",
          kind: "table" as const,
          title: "Exclusion cascade",
          caption: "Rows removed at each cleaning step.",
          file: "artifacts/exclusions.csv",
          inlineText:
            "step,rows removed,rows remaining\nraw,0,67295\nmissing outcome,217,67078\nduplicates,214,66864\n",
          source: {
            path: "output/tables/exclusions.csv",
            sha256: "e".repeat(64),
            bytes: 96,
            oversized: false,
          },
          producedBy: {
            script: "scripts/02_clean.R",
            sourcePath: "code/02_clean.R",
            lang: "r",
          },
        },
      ],
    },
    manifestRaw: {
      path: "plans/execution/02-data-cleaning/results/r1/manifest.json",
      content: "{}",
    },
    report: {
      path: "plans/execution/02-data-cleaning/results/r1/report.md",
      content: cleaningReport,
    },
    verdict: {
      status: "accepted" as const,
      date: "2026-07-02 11:05",
      planVersion: 2,
      reviewer: "BK",
      comment: "Counts match the plan; ship it.",
    },
    verdictRaw: {
      path: "plans/execution/02-data-cleaning/results/r1/verdict.json",
      content: "{}",
    },
    scripts: [
      {
        path: "plans/execution/02-data-cleaning/results/r1/scripts/02_clean.R",
        content:
          "library(dplyr)\n\nraw <- read_issp('data/raw')\nclean <- raw |>\n  filter(!is.na(support)) |>\n  mutate(support = na_if(support, 97), support = na_if(support, 98)) |>\n  distinct(hh_id, .keep_all = TRUE)\n\nwrite_csv(count_exclusions(raw, clean), 'output/tables/exclusions.csv')\nggsave('output/figures/fig-support.svg', plot_support(clean))\n",
      },
    ],
    assets: {
      "fig-support.svg": FIG_SVG,
      "table1.png": FIG_SVG,
      "table1.tex": "data:text/plain;base64,JXRhYmxlMQ==",
      "table1.csv": "data:text/csv;base64,YSxiCjEsMg==",
    },
    publishedReport: null,
    reportFormats: { pdf: false, docx: false },
  },
];

const descriptivesResults = [
  {
    resultsVersion: 1,
    dir: "plans/execution/03-descriptives/results/r1",
    manifest: {
      schemaVersion: 1,
      component: "03-descriptives",
      resultsVersion: 1,
      planVersion: null,
      provenance: "retrofit" as const,
      trigger: "initial" as const,
      capturedAt: "2026-07-02 14:00",
      summary: "Pre-existing descriptive figures, adopted for verification",
      integrity: {
        status: "passed" as const,
        checkedAt: "2026-07-02 14:01",
        checks: [
          { name: "checksums", verdict: "pass" as const, detail: "all artifact copies match their source hashes" },
          { name: "artifacts-present", verdict: "pass" as const, detail: "all artifact files present in the bundle" },
          { name: "artifact-refs", verdict: "pass" as const, detail: "every metric references a real artifact" },
          { name: "findings-sourced", verdict: "pass" as const, detail: "every substantive finding cites an artifact" },
        ],
      },
      metrics: [{ label: "Countries", value: "31" }],
      artifacts: [
        {
          id: "fig-means",
          kind: "figure" as const,
          title: "Country means",
          file: "artifacts/fig-means.svg",
          source: {
            path: "figures/fig-means.svg",
            sha256: "f".repeat(64),
            bytes: 3900,
            oversized: false,
          },
          producedBy: null,
        },
      ],
    },
    manifestRaw: {
      path: "plans/execution/03-descriptives/results/r1/manifest.json",
      content: "{}",
    },
    report: {
      path: "plans/execution/03-descriptives/results/r1/report.md",
      content: descriptivesReport,
    },
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: { "fig-means.svg": FIG_SVG },
    publishedReport: null,
    reportFormats: { pdf: false, docx: false },
  },
  {
    resultsVersion: 2,
    dir: "plans/execution/03-descriptives/results/r2",
    manifest: {
      schemaVersion: 1,
      component: "03-descriptives",
      resultsVersion: 2,
      planVersion: null,
      provenance: "retrofit" as const,
      trigger: "initial" as const,
      capturedAt: "2026-07-06 17:50",
      late: true,
      summary: "Retrospective capture; figures could not be reproduced",
      metrics: [{ label: "Countries", value: "31" }],
      artifacts: [],
    },
    manifestRaw: {
      path: "plans/execution/03-descriptives/results/r2/manifest.json",
      content: "{}",
    },
    report: {
      path: "plans/execution/03-descriptives/results/r2/report.md",
      content: reproFailReport,
    },
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {} as Record<string, string>,
    publishedReport: null,
    reportFormats: { pdf: false, docx: false },
  },
];

const history = `<!-- aict:history -->
# Reconstructed History (pre-adoption)

Reconstructed at adoption on 2026-07-02; covers 2026-05 – 2026-07-02 12:00.

## 2026-05 — early dictionary + measurement pilots

**Evidence:** commits a1b2c3d..e4f5a6b; \`~/.claude/plans/measurement-pilot.md\`
**Decision / turn:** keyword-first measurement, LLM validation deferred to a later wave.
**Uncertain:** the exact date the v0.1 dictionary was abandoned.

## 2026-06 — cross-source frame assembled

**Evidence:** commit 7c8d9e0; \`docs/plans/cross-source.md\`
**Decision / turn:** LinkUp adopted as the primary levels source; CoreSignal kept for the causal panel.
`;

export const devData: BoardData = {
  schemaVersion: 1,
  generatedAt: "2026-07-02T12:00:00-04:00",
  mode: "live",
  focus: null,
  detailLevel: "standard",
  modelProfile: {
    path: "plans/model-profile.md",
    exists: true,
    baselineHash: "dev0000000000000000000000000000000000000000000000000000000000dev",
    raw: "",
    proseBefore:
      "How each aict stage picks a Claude model. **nudge**: Claude tells you the profile's model and suggests `/model`; you decide. **agent**: the delegated stage runs on the profile's model automatically.",
    proseAfter:
      "Planning gets the strongest model at max effort; execution a fast cheap one; review and validation a smarter prior at low effort.",
    rows: [
      { stage: "plan", label: "plan (co-authoring)", model: "opus", effort: "max", mechanism: "nudge" },
      { stage: "execute", label: "execute (analysis)", model: "sonnet", effort: null, mechanism: "nudge" },
      { stage: "sync", label: "sync", model: "inherit", effort: null, mechanism: "nudge" },
      { stage: "plan-review", label: "plan review (verdict + grade)", model: "opus", effort: "medium", mechanism: "agent" },
      { stage: "results-validation", label: "results validation", model: "opus", effort: "low", mechanism: "agent" },
      { stage: "board-reviewer", label: "board reviewer panel", model: "opus", effort: "low", mechanism: "agent" },
    ],
    editable: true,
    warnings: [],
    agentsGitignored: false,
  },
  drift: {
    staleBoardHtml: true,
    leftoverStaging: ["02-data-cleaning"],
    sourceDrift: ["03-descriptives"],
  },
  // Agent plan review (v0.9): reviewer-produced comments, seeded as pending
  // annotations. They paint on 02-data-cleaning v2 and carry a "via Subagent" badge.
  seededAnnotations: [
    {
      planPath: "plans/execution/02-data-cleaning/v2.md",
      component: "02-data-cleaning",
      version: 2,
      isDraft: false,
      sectionHeading: "Goal and success criteria",
      quote: "documented analysis sample",
      comment:
        "Define 'documented' concretely — which recodes and exclusions must be logged for this to count as done?",
      author: "Subagent",
    },
    {
      planPath: "plans/execution/02-data-cleaning/v2.md",
      component: "02-data-cleaning",
      version: 2,
      isDraft: false,
      sectionHeading: "Scope decisions",
      quote: "Drop exact duplicates only",
      comment:
        "Partial-duplicate households are kept — is that defensible, or should near-duplicates at least be flagged?",
      author: "Subagent",
    },
  ],
  project: { name: "issp-immigration-dev", root: "/dev/sample" },
  git: {
    available: true,
    branch: "main",
    head: "abc1234",
    fileDates: {
      "plans/execution/02-data-cleaning/v1.md": {
        firstCommit: "2026-06-30T09:00:00-04:00",
        lastCommit: "2026-06-30T09:00:00-04:00",
      },
      "plans/execution/02-data-cleaning/v2.md": {
        firstCommit: "2026-07-01T16:00:00-04:00",
        lastCommit: "2026-07-01T16:00:00-04:00",
      },
      "plans/execution/02-data-cleaning/v3.md": {
        firstCommit: "2026-07-03T10:00:00-04:00",
        lastCommit: "2026-07-03T10:00:00-04:00",
      },
      "plans/execution/03-descriptives/v1.md": {
        firstCommit: "2026-06-01T09:00:00-04:00",
        lastCommit: "2026-06-01T09:00:00-04:00",
      },
    },
  },
  files: {
    masterPlan: { path: "plans/master-plan.md", content: masterPlan },
    decisionLog: { path: "plans/decision-log.md", content: decisionLog },
    executionPlans: [
      {
        component: "02-data-cleaning",
        versions: [
          { version: 1, path: "plans/execution/02-data-cleaning/v1.md", content: cleaningV1 },
          { version: 2, path: "plans/execution/02-data-cleaning/v2.md", content: cleaningV2 },
          { version: 3, path: "plans/execution/02-data-cleaning/v3.md", content: cleaningV3 },
        ],
        results: cleaningResults,
      },
      {
        component: "03-descriptives",
        versions: [
          { version: 1, path: "plans/execution/03-descriptives/v1.md", content: descriptivesV1 },
        ],
        draftSnapshots: [
          { version: 2, iteration: 1, path: "plans/execution/03-descriptives/v2-draft-1.md", content: descriptivesSnap1 },
          { version: 2, iteration: 2, path: "plans/execution/03-descriptives/v2-draft-2.md", content: descriptivesSnap2 },
        ],
        draft: {
          proposedVersion: 2,
          path: "plans/execution/03-descriptives/.draft-v2.md",
          content: descriptivesDraft,
        },
        results: descriptivesResults,
      },
      {
        component: "04-regression",
        versions: [
          { version: 1, path: "plans/execution/04-regression/v1.md", content: regressionV1 },
          { version: 2, path: "plans/execution/04-regression/v2.md", content: regressionV2 },
        ],
        results: [],
      },
      {
        component: "09-attrition-pilot",
        versions: [
          { version: 1, path: "plans/execution/09-attrition-pilot/v1.md", content: attritionPilotV1 },
        ],
        results: [],
      },
    ],
    reviews: [
      { path: "plans/reviews/02-data-cleaning-v2.md", content: review },
      { path: "plans/reviews/03-descriptives-v1.md", content: reviewV2Pass },
      { path: "plans/reviews/04-regression-v1.md", content: reviewV2Fail },
    ],
    history: { path: "plans/history.md", content: history },
    archives: [
      {
        path: "plans/archive/master-plan-2026-07-02.md",
        content: archivedMasterPlan,
        archivedOn: "2026-07-02",
      },
    ],
  },
};

const devSignItem = {
  component: "03-descriptives",
  proposedVersion: 2,
  path: "plans/execution/03-descriptives/.draft-v2.md",
  content: descriptivesDraft,
  contentHash: "d".repeat(64),
  ticketed: false,
};

/** Manual dev fixtures for both one-shot signing transports. */
export const devTicketSignData: BoardData = {
  ...devData,
  focus: devSignItem.component,
  sign: { batchId: "dev-ticket-sign", transport: "ticket", items: [devSignItem] },
};

export const devHookSignData: BoardData = {
  ...devData,
  focus: devSignItem.component,
  sign: {
    batchId: "dev-hook-sign",
    transport: "hook",
    items: [{ ...devSignItem, path: "plans/execution/03-descriptives/.gate-v2.md" }],
  },
};
