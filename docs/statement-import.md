# Statement import

Specification derived from a real Maybank Islamic savings account e-statement (June 2026, 10 pages,
~100 transaction rows). Everything in the "Actual format" section below is observed, not assumed.

## Why PDF

Maybank2u does not offer a CSV or Excel export of transaction history. Statements are delivered as
PDFs only.

**Maybank does not publish the current month's statement.** A statement for month M becomes
available at the start of month M+1. Statement import can therefore never be a live feed — it is a
monthly, retrospective, authoritative record. See `docs/decisions.md` for what that implies about
its role in the product.

The observed file was not password protected and extracted cleanly as text.

## Actual format

### Page furniture

Each page repeats: the Maybank Islamic header block, the branch line, the account holder's name and
address, page number, statement date, account number, a PIDM notice, the column header band, and a
three-clause footnote block in Malay, Chinese, and English.

All of it must be discarded. Detect the column header band to find where rows begin, and the
footnote block to find where they end. Do not filter by line content — filter by position between
those two anchors.

### Columns

```
ENTRY DATE | TRANSACTION DESCRIPTION | TRANSACTION AMOUNT | STATEMENT BALANCE
```

**There is no value date column.** An earlier draft of this spec assumed one. There isn't.

### Row blocks

A transaction is a multi-line block, not a line. The first line carries the date, the transaction
type, the amount, and the resulting balance. Following lines carry detail and have no date.

```
01/06/26   PAYMENT VIA MYDEBIT        16.70-      1,004.33
           ECO MART KINRARA MA*
           Subang Jaya
           PAYMENT VIA MYDEBIT
```

**Block length is variable — 1 to 4 lines.** Do not assume four.

- 4 lines is typical: type, merchant, location, type repeated
- 3 lines occurs when the merchant name is absent and only a location is given
- 1 line occurs for `PROFIT PAID` and similar bank-generated entries

**Rule: a new block starts at a line with a date in the first column. Everything until the next
dated line belongs to the current block.** This is the only reliable delimiter.

### Blocks split across pages

Confirmed in the sample: a block's continuation lines appear at the top of the following page,
after the page furniture, with no date. Page 4 opens with a reference number and `MAE QR` — the
tail of a block that began on page 3.

The parser must therefore concatenate all pages into one row stream *after* stripping furniture,
and only then segment into blocks. Segmenting per page will corrupt every page boundary.

### Direction

The sign is a **trailing suffix on the amount**: `16.70-` is a debit, `12.50+` is a credit.

**Never infer direction from the transaction type string.** Maybank's naming is counterintuitive:
`TRANSFER FROM A/C` appears with a `-` suffix (money leaving the account) and `FUND TRANSFER TO A/`
appears with `+` (money arriving). The words mean the opposite of what they suggest. The suffix and
the balance movement are the only trustworthy signals, and they must agree.

### Merchant truncation

Merchant names are truncated to 20 characters with a trailing `*` marking the truncation:

```
PETRON SIMPANG AMPA*      MCDONALD'S-MID VALL*      ECO MART KINRARA MA*
APSB.DASH.LRT_GLENM*      GOLDEN SCREEN CINEM*      MPY*GCE-BKT JELUTON*
```

Consequences:

- The `*` is a truncation marker, not part of the name. Strip it, but record that truncation
  occurred.
- Two different merchants can collide on the same truncated prefix. Accept this; do not attempt to
  expand names.
- Note that `*` also appears legitimately *inside* some descriptors (`MPY*GCE-BKT JELUTON*`,
  `OPENAI *CHATGPT SUB*`). Only a trailing `*` at position 21 is a truncation marker.

### Amounts and dates

- Thousands separators present on amounts above 999.99
- Dates are `DD/MM/YY`
- No parenthesised negatives observed; sign is always the trailing suffix

### Summary lines

`BEGINNING BALANCE` appears once at the very top with a balance and no amount. The final page
carries:

```
ENDING BALANCE :   <amount>
TOTAL CREDIT  :   <amount>
TOTAL DEBIT   :   <amount>
```

None of these are transactions. All four are used by the balance checks below.

## The pre-authorisation triplet

The single most important behaviour in the file, and the one that determines whether the review
queue is usable.

A card purchase frequently appears as **three separate rows**:

```
01/06/26  PRE-AUTH MYDEBIT       12.50-   939.15    PETRON SIMPANG AMPA*
01/06/26  REV PREAUTH MYDEBIT    12.50+   951.65    PETRON SIMPANG AMPA*
01/06/26  PAYMENT VIA MYDEBIT    12.50-   939.15    PETRON SIMPANG AMPA*
```

Authorisation, reversal of the authorisation, then settlement. Net effect: one purchase of RM 12.50.
All three rows are legitimate ledger entries with correct balances — they are not duplicates and
must not be deduped away.

In the reference statement this pattern accounts for roughly a quarter of all rows. Petrol stations, toll
plazas, and parking operators produce it almost every time. Presenting ~100 rows for review when
there were ~75 economic events is the difference between a queue the owner clears and one they
abandon.

### Variants that must be handled

**Amount changes between auth and settlement** (foreign currency):

```
PRE-AUTH DEBIT     52.68-     DIGITALOCEAN.COM
PRE-AUTH REFUND    52.68+     DIGITALOCEAN.COM
SALE DEBIT         52.17-     DIGITALOCEAN.COM
```

The auth and its reversal match exactly. The settlement differs. Matching logic must not require
all three to be equal.

**No settlement at all** (fully cancelled):

```
PRE-AUTH DEBIT     99.90-     OPENAI *CHATGPT SUB*
PRE-AUTH REFUND    99.90+     OPENAI *CHATGPT SUB*
```

Net zero. This should surface as a single cancelled event, or not at all — never as two separate
review items.

**Settlement lands on a later date** than the auth. Do not restrict matching to a single day.

**Different type vocabularies for the same shape.** Observed pairs:

| Authorisation | Reversal | Settlement |
| --- | --- | --- |
| `PRE-AUTH MYDEBIT` | `REV PREAUTH MYDEBIT` | `PAYMENT VIA MYDEBIT` |
| `PRE-AUTH DEBIT` | `PRE-AUTH REFUND` | `SALE DEBIT` |

Treat these as a configurable table, not as hardcoded strings.

### Collapse algorithm

Run **after** parsing and **before** creating drafts. It groups; it never deletes.

1. Group rows by normalised merchant within a rolling window of ~7 days.
2. Within a group, match each authorisation-type row to a reversal-type row of the **same amount
   and opposite direction**. Pair them.
3. If a settlement-type row for the same merchant exists after the pair, attach it. The economic
   event is the settlement, at the settlement amount.
4. If no settlement exists, the event is cancelled and nets to zero.
5. Emit **one** reviewable event per group, with the constituent rows attached and visible on
   expand.

All three underlying rows are still written to `transactions`, preserving balance continuity and
the ledger's correspondence to the bank. They carry a shared `event_group_id`. The review queue and
all spending charts operate on **events**, not rows. Balance reconstruction operates on rows.

This is the one piece of logic worth writing tests for before writing any UI.

## Balance checks

Two independent assertions. Run both; they catch different failures.

**Row continuity** — for consecutive rows, exactly, in integer cents:

```
balance_after[n-1] + signed_amount[n] === balance_after[n]
```

Verified by hand against the June sample across all ten pages, including every page boundary. It
holds exactly. Zero tolerance is correct.

**Statement totals** — independent of row-by-row parsing, so it catches a whole dropped page:

```
beginning_balance + total_credit - total_debit === ending_balance
sum(credits) === total_credit
sum(debits)  === total_debit
balance_after[last] === ending_balance
```

Verified against the reference statement: the three summary figures reconcile against the beginning
balance to the stated ending balance exactly.

A batch failing either check writes `status = 'failed'` and inserts zero transactions. Record every
break in `import_batches.balance_check` with the line number, expected value, and actual value.

## Normalisation

`description_normalized` is what rules and dedupe match against. Deterministic, stable, versioned —
changing it invalidates every existing hash.

Apply in order:

1. Take the merchant line (block line 2) when present; fall back to the type line
2. Strip a trailing truncation `*` at position 21
3. Uppercase, collapse whitespace, trim
4. Remove per-transaction reference tokens. Observed forms, all of which vary per transaction and
   would otherwise break every rule match:
   - `QR` followed by digits — `QR71429243`, `QR75812013`
   - digits followed by `Q` — `126641398Q`, `370647823Q`
   - long numeric strings — `11113411886488`
5. Move the payment rail into a structured field rather than the description. Observed values:
   `DUITNOW QR`, `MAE QR`, `PAYMENT VIA MYDEBIT`, `SALE DEBIT`, `PRE-AUTH MYDEBIT`,
   `REV PREAUTH MYDEBIT`, `PRE-AUTH DEBIT`, `PRE-AUTH REFUND`, `IBK FUND TFR FR A/C`,
   `TRANSFER FROM A/C`, `FUND TRANSFER TO A/`, `SVG GIRO CR`, `PROFIT PAID`
6. Keep the merchant portion otherwise intact

Record a `normalizer_version` constant. If it changes, recompute hashes from `raw_rows` in a
migration.

## Observed transaction character

Useful for designing the review queue and the rules seed. From the reference statement:

- **Dominated by small, high-frequency, highly repetitive transactions.** Tolls, LRT fares, and
  parking in the RM 1.75–4.30 range make up a large share of the row count. One LRT merchant string
  alone appears eleven times in the month.
- **Person-to-person transfers in both directions are common**, via MAE QR, with the counterparty's
  name as the merchant. These are bill splitting, not spending, and the correct treatment is an
  open question in `product-spec.md`.
- **Own-account transfers** appear with the account holder's own name as the counterparty and a
  descriptor such as a savings-pot label. Detectable by name match; must be categorised as
  transfers or they double-count.
- **Large pass-through amounts occur** — money arriving and immediately leaving for a single
  purpose. Left uncategorised as transfers, one of these distorts an entire month's charts.
- **Salary arrives as a single credit** with a stable payroll descriptor. A trivial, high-value
  first rule.
- `PROFIT PAID` is the Islamic-banking equivalent of interest — a tiny credit, single-line block.

## Dedupe

Unchanged in principle; see `docs/decisions.md` D4. Hash inputs:

```
sha256([account_id, booked_at, direction, amount_cents,
        description_normalized, balance_after_cents, normalizer_version].join('|'))
```

The running balance in the hash is what keeps the two `PAYMENT VIA MYDEBIT / PETRON SIMPANG AMPA /
12.50-` rows on 01/06 distinct from one another, since their closing balances differ. Without it,
one of a genuine pair would be silently swallowed.

## Testing

Fixtures live in `tests/fixtures/statements/` and are **synthetic** — realistic in structure,
fictional in content. Never commit a real statement (`AGENTS.md`). The reference statement informed this spec; neither it
nor any figure from it enters the repo.

| Fixture | Asserts |
| --- | --- |
| `clean-month.txt` | Happy path; both balance checks pass |
| `page-split-block.txt` | A block spanning a page boundary parses as one row |
| `variable-block-length.txt` | 1-, 3-, and 4-line blocks all parse |
| `preauth-triplet.txt` | Auth + reversal + settlement collapse to one event, three rows retained |
| `preauth-fx.txt` | Settlement amount differs from auth; still collapses |
| `preauth-cancelled.txt` | Auth + reversal with no settlement nets to zero |
| `inverted-type-names.txt` | `TRANSFER FROM A/C` with `-` is read as a debit |
| `same-day-duplicates.txt` | Two identical amounts, same merchant, same day, both survive |
| `dropped-row.txt` | Row continuity check fires |
| `dropped-page.txt` | Totals check fires even though row continuity looks locally clean |
| `truncated-merchants.txt` | Trailing `*` stripped; embedded `*` preserved |
| `reference-tokens.txt` | QR and numeric reference forms removed from the normalised string |

Golden-file tests: parse the fixture, compare the full `ParsedStatement` to a checked-in JSON
snapshot.
