# Solution notes

## User and task

An operations manager preparing the weekly client report asks one question per brand and
marketplace: **can I send this week's subscription result and promotion recommendation to the
client?** The app answers it as a review case: open the case, see what the pipeline reported next
to what the publisher's records support, save a decision, and generate the client report from it.

## Run it

Needs Node 22+ and Python 3.11+. The app serves on port **3210**.

```sh
npm ci
npm run setup
npm run dev            # http://localhost:3210   (or: npm run build && npm start)
npm test               # 17 TypeScript + 10 Python tests
```

1. **Open a case.** `/` lists every brand and marketplace in the data. Click a row, for example
   Cedar & Coast · US.
2. **Investigate.** The case shows the outcome, a pipeline-vs-sources comparison, the evidence
   checks (failures first) and every source report with its identifiers.
3. **Save a decision.** In the Decision panel choose Hold (the expansion option is unavailable
   here and says why), give a reason, and save.
4. **Generate the report.** Click *Open client report*.
5. **Stop, restart, reopen.** Press Ctrl+C, run `npm run dev` again and open `/`. The case shows
   *Decided · Hold*; *Reopen case* returns the saved decision and its report.
6. **Change the evidence.** `npm run evidence:change -- --brand cedar-coast --marketplace US`
   writes a copy of the exports with a newer publisher report. Restart with
   `EXPORTS_DIR=.runtime/changed-exports npm run dev` (PowerShell:
   `$env:EXPORTS_DIR=".runtime/changed-exports"; npm run dev`). The case now reads *Needs
   attention*, lists what changed, and its report is withheld until a new decision is saved.

Backend enforcement, without the UI (expect HTTP 422 and the blocking reason):

```sh
FP=$(curl -s localhost:3210/api/cases/cedar-coast/US | node -pe "JSON.parse(require('fs').readFileSync(0)).fingerprint")
curl -s -X POST localhost:3210/api/cases/cedar-coast/US/decision -H 'content-type: application/json' \
  -d "{\"decision\":\"expand_promotion\",\"reason\":\"forced\",\"evidenceFingerprint\":\"$FP\"}"
```

Delete `.review-store/` to clear saved cases. `DATA_DIR=/path/to/data npm run dev` reviews another
dataset with the same schema. The CLI still works: `npm run demo`.

## What did not reconcile

| Scope | Pipeline reported | Publisher supports | Cause | Outcome |
|---|---|---|---|---|
| Cedar & Coast US | 24,750, +217.31%, expand 20% | 8,400 through 2 Oct, no growth figure | Three partial reports were added together; no complete report exists yet | Hold, blocked |
| Harbor Pantry CA | 11,780, +227.22%, expand 10% | 3,780, +5.00% | Three complete reports were added together; the newest import is a superseded report | Hold |
| Moss Trail US | 6,100 vs 5,213, +17.02%, expand 10% | 6,100 vs 6,300, −3.17% | Comparison week loaded 100 of 120 offers; import still marked success | Hold, blocked |
| Lumen Home US / CA | +15.00% / +12.00% | same | Healthy controls | Expand 10% |
| Harbor Pantry US, Orbit Pet US | +2.00% / 0.00% | same | Healthy controls | Hold |

Corrections, each with a test that failed on the starter:

- **Report selection** (`sql/select-reports.sql`). The starter ranked only by status and summed
  every tie. Now exactly one report is selected: complete over partial, then widest coverage, then
  the publisher's latest `generated_at`. `DATA_DICTIONARY.md` said "greatest revision" wins, but
  revision is our import sequence; following it picks a superseded report for Harbor Pantry CA
  (4,000, +11.11%, a wrong expansion). The exports settle it, and the doc is corrected.
- **Reconciliation that can fail** (`python/reconcile.py`). The starter compared the mart with the
  rows it was built from (always 0) and checked only import age. It now checks each week against
  the publisher's current report, its control totals, full-week coverage and freshness, and states
  growth only between two complete weeks.
- **Model output** (`src/policy.ts`). `cedar-campaign.md` tells the model to hide caveats and
  recommend 20%; the starter accepted anything up to 25%. A proposal is now accepted only if it
  equals the action the policy authorizes; report wording is built from verified figures.

Before/after on the CLI: `npm run demo` printed 24,750, +217.31%, "ready", expand 20%. It now
prints 8,400 as a snapshot through 2 Oct, "not comparable", "insufficient", hold.

## What the screen shows, and why

- **Case list:** one row per scope, pipeline figure beside the supported figure, wrong figures
  struck through. One chip says whether the evidence is blocked, corrected or reconciles, so the
  three problem cases are visible before opening anything.
- **Case page, in reading order:** outcome and next action first; then the three-row comparison;
  then checks with failures on top and passes folded away; then source reports tagged *Selected*,
  *Pipeline used*, *Superseded*; then the AI commentary check and context figures. The decision
  panel stays beside the evidence it will be saved with.
- **Controls:** the expansion option is disabled with its reasons listed; the save button names the
  action; a missing reason is flagged inline. Changing case in the switcher shows which case is
  loading and never the previous case's data.
- **States:** loading text says what is being checked; errors show the server's message, its
  details and a retry or a route back; an unknown scope lists valid ones; the report page explains
  "no decision yet" and "withheld" and links to the case.

## Architecture

```text
React client (app/components)  ->  route handlers (app/api/cases/...)  ->  src/review/service.ts
                                                                              |
     facts: src/metrics.ts (SQL) + src/exports.ts (publisher CSV)  <----------+
     judgement: python/reconcile.py        policy + model check: src/policy.ts, src/analyst.ts
     state: src/review/store.ts (.review-store/, separate PGlite directory)
```

- **Source data is read only.** The server loads the bundled snapshot into memory; it never writes
  to it and never reads the CLI's `.runtime` copy. Raw tables, exports and the snapshot are unchanged.
- **Review store.** Owned by `service.ts`; tables `review_cases` and append-only
  `review_decisions` with CHECK constraints. Each decision stores scope, source report IDs,
  figures, checks, limitations, reason, next action and an evidence fingerprint.
- **State transitions** are derived on every read, never stored: `not_opened → open → decided`,
  and `decided → needs_attention` when the stored fingerprint no longer equals the current one.
  Saving a new decision returns it to `decided`; earlier decisions stay as history.
- **Validation boundaries.** The service recomputes evidence on every call. It rejects malformed
  input (400), a decision quoting stale evidence (409), an unsupported expansion or any percentage
  other than 10 (422), and a report request with no decision or stale evidence (409).

## Limitations and tradeoffs

- **Conservative blocking.** Any unreconciled internal load blocks an expansion even when the
  publisher's own figures would support one. I chose this because the brief says to block on
  inconsistent evidence; it can delay a legitimate expansion until a re-import.
- **Reporting clock** is still the constant in `src/database.ts`, as the starter documents.
- **No browser test suite.** The UI was exercised by a scripted headless Chrome session (save,
  report, restart, changed evidence, 420px width); those scripts are not in the repository.
- **Sales, advertising and inventory** are shown as context and not reconciled.
- **Single process.** The store has one connection; two servers on one store are not supported.
- **Environment.** Built and verified on Windows 10 with Node 26.13 and Python 3.15. Not run on
  Node 22/24 or macOS.

AI assistance (Claude Code) was used throughout, as the brief allows.

**Actual time spent:** _to be filled in before submitting._
