# Working in this repo

This file governs how any coding agent works on Sen. Read it fully before your first change.
It outranks your defaults. Where it conflicts with a habit you have, this file wins.

## The one-paragraph brief

Sen is a single-user personal budgeting app for one person in Malaysia, working in MYR. It ingests
bank transactions from statement PDFs (and later an API), drafts them with a category, and holds
them in a review queue until a human confirms. It is deliberately small. The failure mode to fear
is not "missing feature" — it is "so complicated the owner stops using it."

## Hard rules

These are not preferences. Violating one is a defect regardless of whether tests pass.

1. **Money is integer cents.** `bigint` in Postgres, `number` of cents in TypeScript, formatted only
   at the render boundary. Never `float`. Never `numeric` arithmetic in application code. If you
   see a `.toFixed(2)` anywhere outside a formatter, that is a bug.
2. **Nothing enters the ledger unconfirmed.** Import writes rows with `review_state = 'draft'`.
   Only an explicit user action moves a row to `confirmed`. There is no auto-confirm path, no
   confidence threshold that skips review, no "trusted merchant" bypass. Do not add one.
3. **Never lose the raw.** Every imported row keeps its original parsed text in `raw_rows`. The
   normalised `transactions` row references it. Reprocessing history must never require the user to
   re-upload a file.
4. **Import is idempotent.** Importing the same statement twice produces zero new rows. Importing
   an overlapping period produces only the genuinely new rows. This is enforced by a database
   unique constraint, not by application logic alone.
5. **RLS is on for every table.** No exceptions, no "we'll add it later" tables. Every policy is
   tested. The service-role key is never used in code that runs in response to a user request.
6. **Parsers are pure functions.** `parse(text) -> ParsedStatement`. No database access, no network,
   no file system. This is what makes them testable against fixtures.
7. **Secrets never reach the client.** No Supabase service key, no Finverse credentials, no
   Anthropic key in any `NEXT_PUBLIC_` variable or client component.
8. **Events for money questions, rows for balance questions.** A card purchase is several rows and
   one event. Every spending figure — charts, budgets, category totals, the review queue — groups by
   `event_group_id`. Every balance figure reconstructs from rows. Summing rows to answer "how much
   did I spend" double-counts authorisations and is the easiest way to make Sen quietly wrong.
9. **Never log transaction contents.** Amounts, descriptions, balances, and account identifiers do
   not go to `console.log`, error trackers, or analytics. Log row counts and IDs. This applies to
   caught exceptions too — sanitise before rethrowing.

## Conventions

- TypeScript strict mode. No `any`. No `@ts-expect-error` without a comment naming the reason.
- Server-side data access lives in `lib/db/`. Components do not build queries.
- Domain logic lives in `lib/` as framework-free modules. If a function imports from `next/`, it
  belongs in `app/`, not `lib/`.
- Dates: store `date` for booking dates (no time zone — a statement line has a date, not an
  instant). Use `timestamptz` only for system events like `created_at`.
- Migrations are additive and checked in under `supabase/migrations/`. Never edit an applied
  migration; write a new one.
- No new dependency without a line in `docs/decisions.md` saying why. Prefer the standard library.

## Definition of done

A sprint task is not done until all of these hold:

- [ ] Tests pass, and the new behaviour has a test that would fail without the change.
- [ ] `pnpm typecheck` and `pnpm lint` are clean.
- [ ] Any new table has an RLS policy and a test proving another user cannot read the row.
- [ ] The relevant doc in `docs/` reflects reality, or an issue is raised explaining the gap.
- [ ] No `TODO` left in the diff without an issue number.

## How to handle uncertainty

If a spec is ambiguous, **stop and ask** rather than choosing. The specs were written by someone
who will use this app daily and has opinions. A wrong guess that compiles is more expensive than a
question.

Specifically, do not unilaterally decide:

- What a category taxonomy should contain
- How a chart should be framed or what period it defaults to
- Whether a transaction type is income, expense, or transfer
- Anything involving the owner's real bank data format that you have not seen a fixture for

Raise these as questions. Build the parts you are sure about in the meantime.

## Scope discipline

Before adding anything not in `docs/product-spec.md`, check `docs/product-spec.md#non-goals`.
If it is on the non-goals list, do not build it, even if it is easy, even if you are already in the
file, even if it seems obviously useful. The non-goals list is the most important section in the
repo — it is what keeps this app finishable.

If you believe something on the non-goals list should be reconsidered, say so in your summary.
Do not build it and then ask.

## Working with real bank data

The owner's real statements are not in this repo and never will be. Do not ask for one to be
committed. All fixtures under `tests/fixtures/` are synthetic and must stay synthetic — realistic
in shape, fictional in content. Generate new ones with `pnpm fixtures:generate`.

When you need to know how a real statement behaves in some edge case, ask a specific question
("does the description column ever wrap to a second line?") rather than requesting the file.
