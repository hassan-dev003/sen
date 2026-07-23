# Roadmap

Sprints are units of shippable behaviour, not time. Finish one before starting the next. Each has
acceptance criteria; a sprint is done when every box is checked and `AGENTS.md#definition-of-done`
holds for each task in it.

The ordering is deliberate. It is designed so that the riskiest, least reversible work — parsing
and dedupe correctness — happens before any UI exists to make it look finished.

---

## Sprint 0 — Scaffold

Next.js App Router + TypeScript strict + Tailwind. Supabase project, local dev via
`supabase start`. Magic-link auth with a single allowed email. CI running typecheck, lint, and
tests on every push.

- [ ] `pnpm dev` serves an authenticated shell; unauthenticated users are redirected to login
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass and run in CI
- [ ] Migrations run locally and against the hosted project from one command
- [ ] `.env.example` documents every variable

**Note:** Supabase's magic-link rate limits are easy to hit during development and the lockout is
opaque. Configure a longer link expiry and, in local dev, use the Inbucket mail catcher rather than
real email.

---

## Sprint 1 — Data model

Every table in `docs/data-model.md`, with RLS.

- [ ] All tables, enums, indexes, and constraints created via migrations
- [ ] RLS enabled on every table with policies keyed on `auth.uid()`
- [ ] A test authenticates as a second user and confirms zero rows visible from the first, table by
      table. This test is the sprint.
- [ ] Seed script creates a bank account, a cash account, and a minimal category set
- [ ] `lib/money/` with cents arithmetic and MYR formatting, fully unit tested

**Do not build any UI this sprint.**

---

## Sprint 2 — Statement parser

A pure library. No database, no Next.js, no upload UI.

- [ ] `parseStatement(pages) -> ParsedStatement` implemented per `docs/statement-import.md`
- [ ] `pdfjs-dist` extraction with positional data, separated from parsing
- [ ] Password-protected PDF support, if the open question resolves that way
- [ ] All seven fixtures in `docs/statement-import.md#testing` exist and pass
- [ ] Golden-file snapshots checked in
- [ ] Balance continuity check implemented, with the `dropped-row` fixture proving it fires
- [ ] Normaliser implemented with a `normalizer_version` constant

**Blocked on:** the two parser open questions in `docs/product-spec.md`. Ask before starting.

---

## Sprint 3 — Import pipeline

Wire the parser to the database. Still almost no UI — an upload form and a report page.

- [ ] Upload to a private Supabase Storage bucket, per-user path prefix
- [ ] Full parse and validate in memory, then a single atomic database transaction
- [ ] `raw_rows` populated with verbatim source text for every row
- [ ] Dedupe hash computed and enforced by unique constraint; `on conflict do nothing`
- [ ] A batch failing the balance check inserts zero transactions and reports the breaking lines
- [ ] Import report shows parsed / inserted / duplicate counts and the balance result
- [ ] Rollback deletes a batch's drafts, and refuses if any row is confirmed
- [ ] **Re-importing the same file twice inserts zero rows.** This is the sprint's key test.
- [ ] Overlapping periods insert only the genuinely new rows

---

## Sprint 4 — Review queue

The screen the owner will use more than any other.

- [ ] Draft list: date, raw description, amount, proposed category, source batch
- [ ] Keyboard-first: confirm, change category, skip, undo — all single keys, with a help overlay
- [ ] Inline category picker with type-ahead
- [ ] Bulk confirm for a filtered selection
- [ ] Manual entry form (covers cash) — date, amount, category, note, in under ten seconds
- [ ] Ignore action for rows that should never appear in the ledger
- [ ] Usable on a phone
- [ ] Playwright test: clear a 40-row queue using only the keyboard

---

## Sprint 5 — Rules engine

- [ ] Rule matching per `docs/categorization.md`, priority ordered, first match wins
- [ ] `applied_rule_id` recorded on every auto-categorised draft
- [ ] Merchant memory from previously confirmed transactions
- [ ] "Create rule from this edit" in the review queue, with an editable suggested pattern
- [ ] Creating a rule re-runs categorisation over remaining drafts and reports how many it caught
- [ ] Confirmed transactions are never retroactively changed
- [ ] Rules management in settings, sorted by override ratio
- [ ] Transfer pairing proposal for ATM withdrawals
- [ ] LLM fallback behind `ENABLE_LLM_CATEGORIZATION`, default off, unique-strings-only batching

---

## Sprint 6 — Budgets and dashboard

- [ ] Monthly budget per category; copy-forward writes new rows rather than templating
- [ ] Dashboard answers, in this order: what's left, where it went, is that unusual
- [ ] Category breakdown for the current month
- [ ] Spend over time, month on month
- [ ] Budget progress with over-budget clearly visible
- [ ] Every chart excludes `transfer` categories via the shared query helper
- [ ] Ledger view: filter by date range, category, account, text search

---

## Sprint 7 — Recurring and polish

- [ ] Recurring detection: stable cadence and amount, written as `confirmed = false`
- [ ] Owner promotes a series; nothing acts on an unconfirmed one
- [ ] Committed monthly spend total on the dashboard
- [ ] Empty states, loading states, error states across the app
- [ ] Statement file deletion from settings, retaining `raw_rows`

---

## Sprint 8 — Finverse adapter

**Gated on live API access, which requires a commercial conversation with Finverse. Do not start
this sprint speculatively.**

Finverse's Bank Data API covers Maybank Malaysia for individual accounts. Developer Portal
credentials start as a test app only — able to link their testbank and access test data, but not
real banks. Live access requires creating a separate team, emailing support with the Customer App
ID, and typically signing commercial documents. They can enable free live usage for testing under a
limited quota on request.

- [ ] `FinverseAdapter` implements `SourceAdapter` and emits the same `RawTransaction` shape
- [ ] Link flow, token storage encrypted at rest, server-side refresh
- [ ] `external_id` dedupe path exercised
- [ ] `pending -> posted` transitions update the existing row rather than inserting a second
- [ ] **No changes required below `SourceAdapter`.** If this sprint touches the deduper, the rules
      engine, or the review queue, the Sprint 3 abstraction was wrong and that is the finding.

---

## After v1

Revisit `docs/product-spec.md#non-goals` only after three consecutive months of real monthly use.
Not before.
