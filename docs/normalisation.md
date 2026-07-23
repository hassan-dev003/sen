# Normalisation and transaction shapes

**Core pipeline logic. Shared by every source.** `description_normalized` is what rules, dedupe, and
cross-source matching all key on.

The load-bearing requirement: the same transaction seen through different sources must produce the
**same** normalised merchant. The M2U history puts the payment rail as a prefix; the statement puts
the transaction type first and the rail last. Verified convergence on five of six sampled merchants.
Where it fails — a subscription the statement records only as a phone number but the history names —
matching falls back to date, amount, and direction (D25).

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
