# Sen

A personal budgeting app that gets transactions in without manual typing, and never lets a
transaction into the ledger without a human confirming it.

Named for the Malaysian sen — and for making sense of where the money went.

## The problem

Every budgeting app fails one of two ways. Either it demands manual entry for every purchase, so
you quit after nine days. Or it auto-categorises everything silently, so you stop trusting the
numbers and quit after three months.

Sen splits the difference. Machines do the typing. A human does the confirming.

## How it works

1. **Ingest.** Transactions arrive from the M2U transaction history, printed to PDF from the
   browser. The view reaches back 90 days, so the same tool does routine capture and repairs any
   gap. Statement and API adapters are specced and deferred.
2. **Dedupe.** Overlapping imports are collapsed using a content hash that includes the
   statement's running balance. The same balance column is used to prove no rows were dropped.
3. **Collapse.** Card purchases arrive as several ledger rows — an authorisation, its reversal,
   and a settlement. Around 30% of all rows are this. They are grouped into one economic *event*
   while every row is retained, so the ledger still matches the bank exactly.
4. **Draft.** A rules engine assigns a category, merchant, and tags to each event. Nothing is final.
5. **Review.** Drafts land in a queue. You confirm, edit, or ignore. Every edit can become a rule.
6. **Verify.** Every print carries the account balance, so each import checks itself. If it's off,
   widen the window and re-import.
7. **Ledger.** Confirmed events drive budgets, charts, and recurring-spend detection.

## Stack

| Concern     | Choice                                    |
| ----------- | ----------------------------------------- |
| Framework   | Next.js (App Router), TypeScript          |
| Database    | Supabase (Postgres) with RLS              |
| Auth        | Supabase Auth, magic link                 |
| Styling     | Tailwind CSS                              |
| Charts      | Recharts                                  |
| Hosting     | Vercel                                    |
| Testing     | Vitest (unit), Playwright (e2e, from S4)  |

Rationale and reversibility for each of these is in [`docs/decisions.md`](docs/decisions.md).

## Start here

If you are a coding agent picking up this repo, read in this order:

1. [`AGENTS.md`](AGENTS.md) — how to work in this repo. Non-negotiable.
2. [`docs/product-spec.md`](docs/product-spec.md) — what Sen is and, more importantly, what it is not.
3. [`docs/roadmap.md`](docs/roadmap.md) — the sprint you are on and its acceptance criteria.
4. Then the spec for the area you are touching:
   - [`docs/architecture.md`](docs/architecture.md) — system shape, module boundaries
   - [`docs/data-model.md`](docs/data-model.md) — schema, RLS, money handling
   - [`docs/history-import.md`](docs/history-import.md) — capture from M2U, the live path
   - [`docs/event-collapse.md`](docs/event-collapse.md) — auth/reversal/settlement, all sources
   - [`docs/normalisation.md`](docs/normalisation.md) — shared merchant normalisation
   - [`docs/statement-import.md`](docs/statement-import.md) — deferred, retained
   - [`docs/categorization.md`](docs/categorization.md) — rules engine and the learning loop
   - [`docs/decisions.md`](docs/decisions.md) — decision log, including reversible assumptions

## Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase keys
pnpm supabase start          # local Postgres + Auth
pnpm db:migrate
pnpm db:seed                 # categories + a synthetic statement fixture
pnpm dev
```

## Status

Pre-Sprint 0. Nothing is built yet. The specs in `docs/` are the source of truth; if the code and
the docs disagree, that is a bug in one of them and should be raised, not silently resolved.
