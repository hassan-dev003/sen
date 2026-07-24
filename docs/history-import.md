# Transaction history import

The intra-month capture path. Maybank publishes a statement for month M only after M ends, so this
is how the ledger stays current in between.

Verified end to end against three real captures.

## Producing the file

In Chrome or Edge, on the M2U transaction history view: **Ctrl+P, and set Destination to the
browser's own "Save as PDF"**.

**Not "Microsoft Print to PDF".** That is a Windows virtual printer driver that rasterises the page.
The output looks identical and is completely unparseable — verified: zero extractable characters,
no fonts, every page a JPEG. Chrome's exporter identifies itself as `Skia/PDF` in the producer
metadata and writes a real text layer.

The history view paginates at roughly ten rows per page, so a week of activity is two or three
prints and a full month is around nine. Each print is one paginator page; use the ‹ › controls
between prints.

## Layers

Three, kept apart — see `AGENTS.md` rule 6. Binary input does not make a function impure; only
*acquiring* the bytes is I/O.

| Layer | Signature | Purity | Sprint |
| --- | --- | --- | --- |
| Extract | `extract(bytes: Uint8Array) -> string[]` | Pure. The only module with a PDF dependency. | 2 |
| Parse | `parse(lines: string[]) -> ParsedCapture` | Pure. No dependencies. | 2 |
| Ingest | upload, storage, batch record, error wording | I/O. Lives in `app/`. | 3 |

## Text layer check

`extract` asserts, before returning:

```
extracted_character_count > 0
```

Zero characters means a rasterised print. `extract` throws a typed `RasterisedCaptureError`; the
ingest layer catches it and shows a message naming the cause and the fix — the wrong print
destination. Splitting it this way is what lets the check be fixture-tested with no upload path in
existence. This will happen in practice, because the two print destinations sit next to each other
in the same dropdown.

## Format

Every transaction is exactly **three lines**:

```
MAE QR SARAH RISHAD HAMID * 255626498Q
23 Jul 2026
RM 15.87
```

Description, then date, then amount. Considerably simpler than the statement PDF: no column
alignment, no variable-length blocks, no wrapped descriptions, no multi-line continuation.

**Segmentation rule:** a transaction is any line followed by a line matching `D MMM YYYY` and then a
line matching the amount pattern. Anything that does not fit that triple is furniture. This is
robust to furniture appearing anywhere and needs no positional logic.

- Dates: `23 Jul 2026`
- Amounts: `RM 15.87` for credits, `- RM 23.00` for debits. Leading minus, not trailing.
- Descriptions are flattened onto one line: `<rail> <merchant><*> <location or reference>`

### Page furniture

Discard by pattern, not position. Observed:

```
ACCOUNTS · VIEW STATEMENTS · Savings Account-i (Savings) · <account number>
Available Balance RM … · Current balance RM … · One-day float RM … · Two-day float RM …
Late clearing/Outstation cheque float RM … · DETAILS AMOUNT
All Transaction History · Last 30 days
<timestamp>, <time> · Maybank2u | Maybank Malaysia · https://… · <page>/<total>
© 2026 Malayan Banking Berhad … · Terms & Conditions • Security and Privacy • …
```

A sticky header visually clips the first row on page 2 of each print. **The text layer is
complete** — the clipped row extracts fine. Never infer row boundaries from visual position.

## Description parsing

The rail is a prefix here, where the statement puts the transaction type on the first block line and
the rail on the last. Both must normalise to the same merchant string, or any cross-source
matching fails on every row. Verified convergence on five of six sampled merchants using one shared
normaliser; see `normalisation.md`.

Observed rail prefixes, some with a trailing `*` or `-` attached:

```
MAE QR · DUITNOW QR · DUITNOW QR- · PAYMENT VIA MYDEBIT · SALE DEBIT
PRE-AUTH MYDEBIT · PRE-AUTH DEBIT · REV PREAUTH MYDEBIT* · PYMT VIA MYDEBIT RE
```

After the rail, `*` separates merchant from location or reference, as in the statement. Merchant
names are still truncated to 20 characters. Note merchants containing a hyphen
(`LCSB - Genting Semp*`) and merchants that are a bare phone number or a reference.

**The web view is richer than the statement.** A subscription that the statement records only as a
phone number appears here with an actual merchant name. Any matching across sources therefore keys
on date, amount, and direction first, with merchant as a tiebreaker only — see D18.

## No running balance

The single real cost of this source. Neither of the statement's row-level integrity checks is
available, and the dedupe hash cannot use `balance_after_cents`.

**Dedupe key:** `(account, date, normalized_merchant, direction, amount, rail, occurrence)` where
occurrence is the index within that date, **counted oldest-first**. M2U lists newest first, so
indexing from the top would reshuffle every index when a new transaction lands on the current day
and re-importing would create duplicates. Counting from the oldest end keeps existing indices stable
as a day grows.

**Balance anchor.** Every print carries the account's current balance, and all float lines were zero
in the sample. Checking captures against it needs a starting point, since a running total has to
count from somewhere:

```
opening_balance + sum(signed amounts on or after opening_balance_at) === balance_on_newest_print
```

`opening_balance` and `opening_balance_at` live on the account. **Derive them, then have the owner
confirm.** On the first import, everything needed is already present:

```
opening_balance = balance_on_print − sum(signed amounts across the whole first capture set)
opening_balance_at = the oldest booked_at in that capture set
```

Show the derived figure and let the owner accept or overwrite it. Do not silently compute and move
on: if the first capture session missed a page, the error is baked into the baseline permanently and
every subsequent check reports a clean zero while the ledger is quietly wrong. One human glance at
one number closes that hole for good.

Surface the result as a running figure — "your captures account for the balance exactly" or "off by
RM X" — never as a gate. A non-zero float line invalidates the comparison; check `anchor_reliable`
before asserting.

**When it drifts,** two remedies in order:

1. **Widen the window and re-import.** The actual fix, and the reason the 30/60/90 day selector
   matters. Dedupe absorbs the overlap and the missing rows fill in.
2. **Post an adjustment.** When a difference cannot be resolved — a transaction that fell outside
   90 days, or one the history view never showed — the owner posts an explicit adjustment entry for
   the difference. See D21. Sen proposes the amount; it never posts one by itself.

Store the anchor per import batch. Three prints taken minutes apart carried the same value, which is
a useful cross-check that they belong to one session. If prints in one session disagree, a
transaction landed mid-capture: use the newest balance and re-check.

## Event collapse spans captures

Verified: a pre-authorisation triplet split across two separate prints — the authorisation in one
file, the settlement and reversal in another — collapsed correctly. Grouping runs across capture
batches, exactly as it does across statement months. See
`event-collapse.md`.

## Status of imported rows

Rows land as drafts like any other source and are confirmed in the review queue. There is no later
authority that supersedes them — this **is** the authoritative path. Completeness is established by
the balance anchor, and a shortfall is repaired by widening the capture window and re-importing.

## Testing

Synthetic fixtures only, in `tests/fixtures/history/`.

**Extract layer** — two tiny PDFs, the only binary fixtures in the repo. Both must be synthetic:
generate them by printing a fake page, never from a real capture.

| Fixture | Asserts |
| --- | --- |
| `text-layer.pdf` | A browser-exported PDF yields lines in reading order |
| `rasterised.pdf` | Zero-character text layer throws `RasterisedCaptureError` |

**Parse layer** — `.txt` files, each generated from real `extract` output with the content replaced.

| Fixture | Asserts |
| --- | --- |
| `clean-print.txt` | Ten three-line blocks parse; furniture discarded |
| `clipped-first-row.txt` | Row visually clipped by the sticky header still parses |
| `same-day-repeats.txt` | Two identical amounts on one day both survive; indices oldest-first |
| `growing-day.txt` | Re-import after a new same-day transaction creates no duplicates |
| `triplet-across-prints.txt` | Auth in one capture, settlement in another, collapses to one event |
| `rail-variants.txt` | Each rail prefix, including trailing `*` and `-` forms, strips correctly |
| `hyphenated-merchant.txt` | `LCSB - Genting Semp*` keeps its hyphen |
| `balance-anchor.txt` | Anchor extracted; mismatch reported as a figure, not a failure |
| `nonzero-float.txt` | A non-zero float line suppresses the anchor assertion |
