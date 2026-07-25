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
   an occurrence index within the day. Each capture carries the account balance, which is used to
   prove nothing is missing.
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
pnpm db:seed                 # categories + a synthetic capture fixture
pnpm dev
```

## Status

Sprint 4 (Review queue and capture) is built. The draft queue presents collapsed **events**, not
rows — date, merchant, amount, proposed category, with the constituent authorisation/reversal/
settlement rows on expand, and pending/orphan/cancelled shown as calm chips rather than errors. It
is keyboard-first (confirm, categorise, ignore, select, undo, `?` help) with an inline type-ahead
category picker and bulk confirm; the queue's decision logic is a pure, exhaustively tested reducer
(`lib/review/queue-reducer.ts`). Cash is typed in through a manual-entry form that lands confirmed,
and a running balance banner shows "verified" or "off by RM X" with the widen-and-re-import prompt
and an owner-confirmed adjustment into `Unaccounted` (D21). Confirmed transactions are editable with
an audit trail (D22); that edit surface arrives with the ledger in Sprint 6. The browser-level
Playwright e2e is the one open Sprint 4 item — the keyboard clear is covered at the logic level
meanwhile. This sprint also establishes the app's design foundation: calm and minimal, teal-biased
neutrals with one accent, both light and dark as first-class tokens.

Sprint 3 (Import pipeline) is complete. The parser is wired to the database: a capture PDF uploads to a
private per-user Storage bucket, is parsed and planned in memory, then written in one atomic
transaction (an RLS-respecting plpgsql function) — `raw_rows` verbatim, transactions deduped by a
`(user_id, dedupe_hash)` unique index with `on conflict do nothing`, and cross-batch event
regrouping applied and recorded so rollback can unwind it. Re-importing the same capture inserts
zero rows; overlapping windows insert only what's new. The first import derives an opening balance
for confirmation (D21), and each import shows a running balance-verification figure. Adjustments and
the `Unaccounted` category exist in the schema; posting them is Sprint 4.

Earlier sprints stand: the pure history parser + event collapse (Sprint 2), the data model with a
second-user RLS isolation test and `lib/money/` (Sprint 1), and the deployed authenticated shell
(Sprint 0). The review queue, ledger, budgets, and settings arrive in later sprints.

The specs in `docs/` are the source of truth; if the code and the docs disagree, that is a bug in
one of them and should be raised, not silently resolved.
