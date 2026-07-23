# Statement import

Specification derived from three consecutive real Maybank Islamic savings account e-statements
(April, May, June 2026 — 9, 13, and 10 pages respectively). Everything in the "Actual format"
section below is observed across all three, not assumed. Where a behaviour appears in only one
month it is marked as such.

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

The footnote block is **not fixed**: the April statement carries two numbered notes, May and June
carry three. Anchor on the start of the block, never on a line count or on the final note.

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

**Caveat — extraction can run lines together.** Observed in May: a description line was emitted
concatenated with the following row's date, producing `DUITNOW QR11/05/26 FUND TRANSFER TO A/`.
The date delimiter must therefore be detected anywhere in the line, not only at its start, and the
line split at that point. Positional extraction avoids this; a flattened text dump does not.

### Which line is the merchant

**Not reliably line 2.** Observed counter-example on an FPX payment, where line 2 is a reference and
the merchant is on line 3:

```
25/05/26   FPX PAYMENT FR A/        40.00-     163.45
           my3260024837
           MAJLIS BANDARAYA SHA
           2605251939230384
```

Correct rule: the merchant is the first description line that is neither a reference token (see
normalisation step 4) nor a known payment rail. If no such line exists, the block has no merchant —
common on DuitNow QR rows, which sometimes carry only a `QR…` reference and the rail.

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

Across all three months this pattern accounts for roughly 30% of all rows — consistently, not as a
one-month anomaly. Petrol stations, toll
plazas, and parking operators produce it almost every time. Presenting ~100 rows for review when there were
~70 economic events is the difference between a queue the owner clears and one they abandon.

### Statement order is not causal order

**The single most important correction from the multi-month sample.** The three rows do not appear
in auth → reversal → settlement order. Observed in April, where the reversal is listed first:

```
14/04/26  REV PREAUTH MYDEBIT    5.00+   SHELL - SUNWAY MENT*
14/04/26  PRE-AUTH MYDEBIT       5.00-   SHELL - SUNWAY MENT*
14/04/26  PAYMENT VIA MYDEBIT    5.00-   SHELL - SUNWAY MENT*
```

The balances are internally consistent in the order printed — the statement is ordered by posting
sequence, which does not match the logical lifecycle. **Matching must be order-independent.** Any
algorithm that looks for a settlement *after* a reversal will silently fail on rows like these.

### Variants that must be handled

**Amount changes between auth and settlement** (foreign currency):

```
PRE-AUTH DEBIT     52.68-     DIGITALOCEAN.COM
PRE-AUTH REFUND    52.68+     DIGITALOCEAN.COM
SALE DEBIT         52.17-     DIGITALOCEAN.COM
```

The auth and its reversal match exactly. The settlement differs. Matching must not require all
three to be equal.

**No settlement at all** (fully cancelled). Net zero — one cancelled event, or nothing. Never two
review items.

**Settlement reversal — a two-row shape, not a triplet.** A different vocabulary and a different
lifecycle: an already-settled payment is refunded. Observed in both April and May:

```
PAYMENT VIA MYDEBIT     1.00-     APSB.MX.COVA_SQUARE*
PYMT VIA MYDEBIT RE     1.00+     APSB.MX.COVA_SQUARE*
```

There is no authorisation row. Treating `PYMT VIA MYDEBIT RE` as a pre-auth reversal and hunting
for an auth will leave both rows unmatched.

**Cross-month orphans.** A reversal can appear in one statement with its authorisation in the
previous one. Observed on 01/05, where a refund has no corresponding authorisation anywhere in the
May statement. The converse also occurs at month end. Unmatched rows at statement boundaries are
**expected, not an error** — leave them unmatched and re-run matching when the adjacent month is
imported.

### Type vocabularies

Configurable table, not hardcoded strings. Observed across three months:

| Role | Observed types |
| --- | --- |
| Authorisation | `PRE-AUTH MYDEBIT`, `PRE-AUTH DEBIT` |
| Auth reversal | `REV PREAUTH MYDEBIT`, `PRE-AUTH REFUND` |
| Settlement | `PAYMENT VIA MYDEBIT`, `SALE DEBIT` |
| Settlement reversal | `PYMT VIA MYDEBIT RE` |

Note that `PRE-AUTH REFUND` rows frequently carry `SALE DEBIT` as their block's trailing type line.
Classify on the **first line's** type, never the trailing one.

### Collapse algorithm

Runs after parsing, before creating drafts. It groups; it never deletes. It is order-independent
and tolerates unmatched rows.

1. Group rows by normalised merchant within a rolling window of ~10 days. The window must be
   allowed to cross a statement boundary.
2. Classify every row by its first-line type using the table above.
3. Pair each auth-reversal with an unpaired authorisation of the **same amount**, nearest by date,
   **regardless of the order they appear in the statement**.
4. Pair each settlement-reversal with an unpaired settlement of the same amount.
5. Remaining unpaired settlements are economic events, at their own amount.
6. An authorisation paired with a reversal and no settlement is a cancelled event, netting zero.
7. An authorisation with no reversal is still pending — emit a provisional event and re-resolve on
   the next import.
8. A reversal with nothing to pair against is a cross-month orphan. Leave it, and retry when the
   adjacent statement is imported.
9. Emit one reviewable event per group, constituent rows attached and visible on expand.

All rows are still written to `transactions`, preserving balance continuity and correspondence with
the bank. They share an `event_group_id`. Review queue and spending charts operate on **events**;
balance reconstruction operates on **rows**.

This is the one piece of logic worth testing exhaustively before any UI exists.

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

**Statement chaining** — a third assertion, only visible with consecutive statements:

```
beginning_balance[month N+1] === ending_balance[month N]
```

Verified across April → May → June: each month's beginning balance equals the previous month's
ending balance exactly. This catches an entire missing month, which neither of the other two checks
can see. Run it whenever an adjacent statement is already imported, and surface a gap as a warning
rather than a hard failure — the owner may legitimately import out of order.

A batch failing either row-level check writes `status = 'failed'` and inserts zero transactions. Record every
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
   - long numeric strings — `11113411886488`, `2605251939230384`
   - `MBBQR` followed by digits, and `MB` followed by digits and a letter
   - `T` followed by digits — `T110296493826`
   - `my` followed by digits — `my3260024837`
   - a `MMYY` suffix on payroll descriptors — the salary line ends `SALARY 0426` / `0526` / `0626`,
     so the month must be stripped or the rule matches once and never again
5. Move the payment rail into a structured field rather than the description. Observed values:
   `DUITNOW QR`, `MAE QR`, `MBB CT`, `QR PAY SALES`, `PAYMENT VIA MYDEBIT`, `SALE DEBIT`,
   `PRE-AUTH MYDEBIT`, `REV PREAUTH MYDEBIT`, `PRE-AUTH DEBIT`, `PRE-AUTH REFUND`,
   `PYMT VIA MYDEBIT RE`, `IBK FUND TFR FR A/C`, `IBK FUND TFR TO A/C`, `TRANSFER FROM A/C`,
   `FUND TRANSFER TO A/`, `PYMT FROM A/C`, `FPX PAYMENT FR A/`, `SVG GIRO CR`, `PROFIT PAID`

   Note `DUITNOW QR-` was observed once with a trailing hyphen; normalise it to `DUITNOW QR`.
6. Keep the merchant portion otherwise intact

Record a `normalizer_version` constant. If it changes, recompute hashes from `raw_rows` in a
migration.

## Observed transaction character

From three consecutive months. Useful for the review queue design and the rules seed.

- **~80–125 rows per month, ~70–90 economic events after collapse.** Statement length varies
  considerably month to month.
- **Dominated by small, high-frequency, repetitive transactions.** Tolls, LRT fares, and parking in
  the RM 1.00–4.30 range are the bulk of the row count. A handful of merchant strings recur many
  times each, every month.
- **Person-to-person transfers in both directions are common and high-volume**, via MAE QR, with
  the counterparty's name in the merchant field. These are bill splitting, not spending. Treatment
  is an open question in `product-spec.md`.
- **Own-account sweeps** appear with the account holder's own name as counterparty and a descriptor
  identifying the pot — at least two families observed across the sample. Unambiguous transfers.
- **Salary is monthly but the amount varies**, and its descriptor carries the month as a suffix.
  Recurring detection that requires a stable amount will miss it; cadence plus a stable normalised
  descriptor will find it. It did not appear at all in one of the three months.
- **Some recurring subscriptions have no merchant name** — only a US phone number in the merchant
  field. Two distinct ones observed, both monthly at a stable amount. Rules must be able to match
  on a phone-number string.
- `PROFIT PAID` (the Islamic-banking interest equivalent) appeared in only one of three months.
  Do not assume it is monthly.

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
| `preauth-reordered.txt` | Reversal printed before its authorisation still matches |
| `settlement-reversal.txt` | Two-row `PYMT VIA MYDEBIT RE` pair collapses without an auth |
| `orphan-reversal.txt` | Reversal with no auth in scope is left unmatched, not errored |
| `merchant-on-line-3.txt` | FPX block where line 2 is a reference and line 3 the merchant |
| `concatenated-date.txt` | A date run together with the previous description line splits correctly |
| `two-note-footer.txt` | Footer with two notes instead of three is still stripped |
| `chained-months.txt` | Month N ending balance equals month N+1 beginning balance |
| `inverted-type-names.txt` | `TRANSFER FROM A/C` with `-` is read as a debit |
| `same-day-duplicates.txt` | Two identical amounts, same merchant, same day, both survive |
| `dropped-row.txt` | Row continuity check fires |
| `dropped-page.txt` | Totals check fires even though row continuity looks locally clean |
| `truncated-merchants.txt` | Trailing `*` stripped; embedded `*` preserved |
| `reference-tokens.txt` | QR and numeric reference forms removed from the normalised string |

Golden-file tests: parse the fixture, compare the full `ParsedStatement` to a checked-in JSON
snapshot.
