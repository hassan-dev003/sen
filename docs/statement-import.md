# Statement import

The v1 ingestion path. Everything here is Sprint 2 and 3.

## Why PDF

Maybank2u does not offer a CSV or Excel export of transaction history. Statements are delivered as
PDFs through Maybank2u and the MAE app. There is no supported structured export, so the PDF is the
source of truth.

The columns available in a Maybank statement row are: booking date, value date, transaction type,
description, reference, amount, and running balance.

Prior art worth reading before writing the parser: `fakhrullah/maybankStatementParser` on GitHub.
It works from text extracted out of the monthly statement PDF and emits JSON or CSV. Read it for
the layout quirks it handles; do not vendor it — the parser needs to be a first-class, tested
module in this repo.

## Pipeline

```
PDF file
  -> decrypt (if password protected)
  -> text extraction         pdfjs-dist, server-side only
  -> layout parse            text -> ParsedRow[]     PURE
  -> normalise               ParsedRow -> RawTransaction
  -> balance continuity check
  -> dedupe
  -> insert drafts
```

The two middle steps are pure functions with no I/O. That is what makes them testable against
fixtures, and it is a hard requirement (`AGENTS.md` rule 6).

### Decryption

Malaysian bank e-statements are frequently password protected. **This is an open question in
`product-spec.md` and must be answered before S2 is planned.** If they are, support supplying a
password at upload time, hold it in memory only, and never persist it. Do not store it in the
database, in storage metadata, or in a session.

### Text extraction

Use `pdfjs-dist` server-side. Extract text with positional data — Maybank statements are
column-aligned, and x-coordinates are far more reliable for column boundaries than whitespace
heuristics in a flattened text dump.

Keep extraction and parsing separate. Extraction returns positioned text items; parsing turns those
into rows. When the layout changes, only the parser changes.

## Parser contract

```ts
export interface ParsedRow {
  lineNo: number;
  bookedAt: string;          // YYYY-MM-DD
  valueDate: string | null;
  type: string | null;       // Maybank's transaction type code
  description: string;
  reference: string | null;
  amountCents: number;       // positive
  direction: 'debit' | 'credit';
  balanceAfterCents: number;
  rawText: string;           // the source line, verbatim
}

export interface ParsedStatement {
  accountHint: string | null;   // masked account number if present
  periodStart: string | null;
  periodEnd: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  rows: ParsedRow[];
}

export function parseStatement(pages: ExtractedPage[]): ParsedStatement;
```

`rawText` is mandatory on every row. It is what gets stored in `raw_rows.raw_text`, and it is what
makes a parser bug recoverable.

### Known hazards

Handle each of these explicitly, with a fixture:

- **Multi-line descriptions.** A long description may wrap. Rows are delimited by the presence of a
  date and an amount, not by line breaks. Whether Maybank actually wraps is an open question — write
  the parser to tolerate it regardless.
- **Page boundaries.** Headers, footers, page numbers, and repeated column headings appear
  mid-document and must be discarded without consuming a row.
- **Opening and closing balance lines.** These are not transactions. They are used for the
  continuity check and excluded from `rows`.
- **Direction.** Maybank marks debits and credits by column position or a trailing indicator
  depending on the statement variant. Infer direction from the balance delta as a cross-check —
  if the stated direction and the balance movement disagree, fail the row loudly rather than guess.
- **Thousands separators and negative formats.** `1,234.56` and any parenthesised negatives.
- **Date formats.** Do not assume; derive from the statement period header and assert.

## Balance continuity check

The most valuable thing in the file, and the thing most parsers ignore.

For consecutive rows, this must hold exactly, in integer cents:

```
balance_after[n-1] + signed_amount[n] === balance_after[n]

where signed_amount = direction === 'credit' ? +amount : -amount
```

And at the boundaries:

```
opening_balance + signed_amount[0] === balance_after[0]
balance_after[last]                === closing_balance
```

Zero tolerance. These are integers; there is no floating point error to absorb.

A failure means one of three things, all of which you want to know about:

1. The parser dropped a row
2. The parser misread an amount or a direction
3. The statement itself is not a contiguous sequence

Record every break in `import_batches.balance_check` with the line number, expected value, and
actual value. A batch with any break is written as `status = 'failed'` and inserts no transactions.
Show the owner exactly which line broke.

This single assertion catches the failure mode that otherwise goes unnoticed for months: a parser
that silently skips one row per statement, producing a ledger that is quietly, consistently wrong.

## Normalisation

`description_normalized` is what rules and dedupe match against. It must be deterministic and
stable — changing the algorithm invalidates every existing hash, so treat it as versioned.

Apply in order:

1. Uppercase
2. Collapse runs of whitespace to a single space, trim
3. Strip trailing reference numbers, transaction IDs, and date fragments that vary per transaction
4. Strip common Malaysian banking prefixes into a structured field rather than the description:
   `DUITNOW QR`, `DUITNOW TRF`, `IBFT`, `IBG`, `FPX`, `ATM WDL`, `SVCCHG`
5. Keep the merchant portion intact — do not aggressively truncate

Step 3 is the delicate one. Removing too much collapses genuinely distinct transactions into
identical hashes; removing too little means the rules engine never matches twice. Err toward
removing too little — a rule that fires less often is a smaller problem than a deduper that
swallows a real transaction.

Record a `normalizer_version` constant. If it changes, dedupe hashes must be recomputed from
`raw_rows` in a migration, not left inconsistent.

## Dedupe

Two mechanisms, both enforced by database unique constraints so that concurrent or retried imports
cannot slip through.

**When the source provides a stable ID** (Finverse, later): unique on
`(user_id, source, external_id)`.

**When it does not** (statements): a content hash.

```
dedupe_hash = sha256([
  account_id,
  booked_at,
  direction,
  amount_cents,
  description_normalized,
  balance_after_cents,
  normalizer_version,
].join('|'))
```

`balance_after_cents` is in the hash for a specific reason. Two RM 12.00 coffee purchases at the
same shop on the same day are indistinguishable by date, amount, and description — a hash without
the balance would treat the second as a duplicate and silently drop a real transaction. Their
closing balances differ, so including it keeps them distinct.

When `balance_after_cents` is null (an API source with no balance), fall back to including a
sequence ordinal within the batch. Note this in the hash input so the two schemes never collide.

Insert with `on conflict do nothing` and count the difference between rows attempted and rows
inserted. That count is `rows_duplicate` on the batch, and it is shown in the import report.

## Import report

Every import ends here. It should be readable in five seconds:

- Period covered, rows parsed
- Rows inserted as drafts
- Rows skipped as already present
- Balance check: clean, or a list of breaks with line numbers
- A link into the review queue filtered to this batch
- A rollback button, disabled once any row in the batch is confirmed

## Testing

Fixtures live in `tests/fixtures/statements/` and are **synthetic** — realistic in structure,
fictional in content. Never commit a real statement (`AGENTS.md`).

Required fixtures before S2 is done:

| Fixture | Asserts |
| --- | --- |
| `clean-month.txt` | Happy path, balance continuity passes |
| `page-break.txt` | Headers and footers mid-document are discarded |
| `wrapped-description.txt` | A description spanning two lines parses as one row |
| `same-day-duplicates.txt` | Two identical amounts, same day, same merchant, both survive |
| `dropped-row.txt` | A deliberately removed row is caught by the continuity check |
| `credit-and-debit.txt` | Direction inference matches balance movement |
| `duitnow-variants.txt` | Each DuitNow/IBFT/FPX prefix normalises as specified |

Golden-file tests: parse the fixture, compare the full `ParsedStatement` to a checked-in JSON
snapshot. When the parser legitimately changes, the diff in the snapshot is the review.
