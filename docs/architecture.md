# Architecture

## The shape

```
  PDF statement          Finverse API
  (Sprint 3)             (Sprint 8, gated)
        |                      |
        +----------+-----------+
                   |
             SourceAdapter
       normalises to RawTransaction
                   |
              Normaliser
      description cleanup, direction,
           amount in cents
                   |
               Deduper
    content hash + running-balance check
                   |
            Rules engine  ---->  draft category, merchant, tags
                   |
             Draft queue  <----  manual entry (cash)
              human confirms
                   |
                Ledger
        budgets, charts, recurring
```

The load-bearing idea: **everything below `SourceAdapter` is source-agnostic.** When Finverse
access arrives, you write one adapter and change nothing else. Any code below that line that
branches on `source` is a design error — with one deliberate exception, documented in the
deduper below.

## Module layout

```
app/                      Next.js routes and server actions. Thin.
  (auth)/                 login, callback
  import/                 upload, batch report
  review/                 the draft queue
  ledger/                 transaction list, filters
  budgets/
  settings/               categories, rules
lib/
  sources/
    types.ts              SourceAdapter interface, RawTransaction
    statement-pdf/        parser + Maybank layout profile (pure)
    finverse/             stub until Sprint 8
  normalize/              description cleanup, direction inference
  dedupe/                 hashing, balance continuity assertion
  rules/                  matching, learning, application
  money/                  cents arithmetic and formatting. The only place.
  db/                     queries. Nothing else touches Supabase.
supabase/
  migrations/
tests/
  fixtures/               synthetic statements only
```

## The adapter contract

```ts
export interface RawTransaction {
  externalId: string | null;      // stable bank/provider ID, if the source gives one
  bookedAt: string;               // YYYY-MM-DD
  valueDate: string | null;
  descriptionRaw: string;
  reference: string | null;
  amountCents: number;            // always positive
  direction: 'debit' | 'credit';
  balanceAfterCents: number | null; // present for statements, may be null for APIs
  postingState: 'pending' | 'posted';
  sourceLineNo: number | null;    // for statements: position in the file
}

export interface SourceAdapter {
  readonly source: 'statement_pdf' | 'finverse' | 'manual';
  ingest(input: unknown): Promise<{
    accountHint: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    rows: RawTransaction[];
  }>;
}
```

Two fields exist purely so the Finverse swap is a non-event later:

- `postingState` is always `'posted'` for statement imports. Bank APIs deliver pending
  transactions that later change amount and description. Having the column from day one means no
  migration and no rethink when that happens.
- `externalId` is always `null` for statements. When it exists it is the *better* dedupe key.

## Why the deduper knows about sources

The one place the source-agnostic rule bends. Statements carry a running balance and no stable ID.
APIs carry a stable ID and often no balance. The deduper picks its strategy accordingly:

- `externalId` present → dedupe on `(user_id, source, external_id)`
- otherwise → dedupe on the content hash, which includes `balance_after_cents`

Both are database unique constraints. See `docs/statement-import.md` for the hash definition and
why the balance is in it.

## Data access

All Supabase access goes through `lib/db/`. Server components and server actions call those
functions; they do not build queries inline. This exists so that when a query needs changing, there
is one place to change it, and so that RLS behaviour can be tested in isolation.

The Supabase client is created per request with the user's session. The service-role key is used in
exactly one place: the migration and seed scripts. It never appears in a request path.

## Import as a transaction

An import batch is atomic. Parse and validate fully in memory, then write `import_batches`,
`raw_rows`, and `transactions` in a single database transaction. A batch that fails its
balance-continuity check is written with `status = 'failed'` and no transaction rows.

Every draft row carries `batch_id`, so an import can be rolled back wholesale — deleting drafts
from that batch. Rollback refuses if any row in the batch has been confirmed, because at that point
the owner has made a judgement and losing it silently would be worse than a messy ledger.

## Security posture

- RLS on every table, policies keyed on `auth.uid()`, tested per table.
- Uploaded statement PDFs go to a private Supabase Storage bucket with a per-user path prefix and
  no public URLs. They can be deleted from settings; `raw_rows` retains what was parsed.
- Transaction contents never appear in logs. See `AGENTS.md` rule 8.
- Finverse credentials, when they exist, are stored encrypted at rest and only ever decrypted
  server-side. Access tokens are refreshed server-side and never returned to the client.
- Rate-limit the magic-link endpoint. Supabase's default limits are easy to hit during development
  and the resulting lockout is confusing.

## Performance notes

This is a single-user app with a few thousand rows a year. Do not optimise for scale. Do index:

- `transactions (user_id, review_state)` — the draft queue reads this constantly
- `transactions (user_id, booked_at desc)` — the ledger and every chart
- `transactions (user_id, dedupe_hash)` unique — correctness, not speed

Anything beyond that is premature.
