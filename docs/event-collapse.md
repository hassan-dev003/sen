# Event collapse

**Core pipeline logic. Applies to every source**, not just one — verified on both the monthly
statement and the M2U history print, where a single triplet split across two separate captures
collapsed correctly.

A card purchase reaches the ledger as several rows. Collapsing them into one economic *event* while
retaining every row is what makes the review queue usable and keeps the ledger matching the bank.
Roughly 30% of statement rows are this pattern.

## The pattern

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
