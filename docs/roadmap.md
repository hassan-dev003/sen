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

- [x] All tables, enums, indexes, and constraints created via migrations
- [x] RLS enabled on every table with policies keyed on `auth.uid()`
- [x] A test authenticates as a second user and confirms zero rows visible from the first, table by
      table. This test is the sprint.
- [x] Seed script creates a bank account, a cash account, and a minimal category set
- [x] `lib/money/` with cents arithmetic and MYR formatting, fully unit tested

**Do not build any UI this sprint.**

---

## Sprint 2 — History parser

A pure library: bytes in, structured events out. No database, no Next.js, no upload UI, no file
system — `extract` receives a `Uint8Array` and the caller is responsible for having read it.

- [x] `extract(bytes) -> string[]` — the only module carrying a PDF dependency. Must accept a
      buffer and run on Vercel's serverless runtime, so no native binaries.
- [x] Text-layer assertion inside `extract`: zero characters throws a typed
      `RasterisedCaptureError`. Throwing it is Sprint 2; wording a message about the print
      destination for a human is Sprint 3.
- [x] Three-line block parser per `docs/history-import.md`, taking lines and depending on nothing
- [x] Shared normaliser per `docs/normalisation.md`, with a `normalizer_version` constant
- [x] **Event collapse per `docs/event-collapse.md`** — order independent, orphan tolerant, both the
      three-row and two-row shapes. The hardest logic in the project; test it exhaustively.
- [x] Balance anchor extraction, suppressed when any float line is non-zero
- [x] All fixtures in `docs/history-import.md#testing`, both layers

**Generate the `.txt` fixtures from real `extract` output**, never by hand. Hand-written fixtures
encode guesses about line ordering and blank lines; if a guess is wrong, every parser test passes
against a reality that does not exist. Synthesise the *content*, keep the *shape* the extractor
actually produces.

The statement parser is deferred (D19) and its spec is retained at `docs/statement-import.md`.

---

## Sprint 3 — Import pipeline

Wire the parser to the database. Still almost no UI — an upload form and a report page.

- [ ] Upload to a private Supabase Storage bucket, per-user path prefix
- [ ] Full parse and validate in memory, then a single atomic database transaction
- [ ] `raw_rows` populated with verbatim source text for every row
- [ ] Dedupe hash computed and enforced by unique constraint; `on conflict do nothing`
- [ ] A batch failing the balance check inserts zero transactions and reports the breaking lines
- [ ] Balance verification: last verified balance plus everything captured since equals the balance
      on the newest print. Surfaced as a running figure, never a hard gate.
- [ ] Event grouping persisted, including regrouping rows from earlier batches when a later
      import supplies the missing half of a pair
- [ ] Import report shows rows parsed, events after collapse, inserted / duplicate counts, and
      whether the balance verifies
- [ ] Rollback deletes a batch's drafts and unwinds any cross-batch regrouping it caused, and
      refuses if any row is confirmed
- [ ] **Re-importing the same file twice inserts zero rows.** This is the sprint's key test.
- [ ] Overlapping periods insert only the genuinely new rows

---

## Sprint 4 — Review queue and capture

The screens the owner will use more than any other.

M2U history import carries bank transactions (D17); manual entry covers cash and anything else the
bank cannot see. The entry form is still a first-class screen, but it no longer has to absorb ninety
events a month.

- [ ] Draft list of **events**, not rows: date, description, amount, proposed category, source
      batch, with constituent rows visible on expand
- [ ] Pending and orphan events are visibly distinct from resolved ones, and are not errors
- [ ] Keyboard-first: confirm, change category, skip, undo — all single keys, with a help overlay
- [ ] Inline category picker with type-ahead
- [ ] Bulk confirm for a filtered selection
- [ ] Manual entry form (covers cash) — date, amount, category, note, in under ten seconds
- [ ] Ignore action for rows that should never appear in the ledger
- [ ] Usable on a phone
- [ ] Playwright test: clear an 80-event queue using only the keyboard
- [ ] Balance status is visible without hunting for it: verified, or off by RM X with a prompt to
      widen the window and re-import

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

- [ ] Recurring detection: stable cadence and normalised descriptor, **not** stable amount; written
      as `confirmed = false`. Must find a monthly item that varies in amount and skips a month.
- [ ] Rules match merchants that are absent entirely, or are a bare phone number
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
- [ ] **No changes required below `SourceAdapter`.** If this sprint touches the deduper, the event
      collapser, the rules engine, or the review queue, the Sprint 3 abstraction was wrong and that
      is the finding.

---

## After v1

Revisit `docs/product-spec.md#non-goals` only after three consecutive months of real monthly use.
Not before.
