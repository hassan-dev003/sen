# Decision log

Short records of choices that would otherwise get re-litigated. Append; do not rewrite history.
When a decision is reversed, add a new entry that supersedes the old one and mark the old one.

Status values: **Decided**, **Assumed** (chosen to unblock, needs the owner's confirmation),
**Superseded**.

---

### D1 — Statement import ships before API integration
**Decided.** Finverse live access requires a commercial conversation with an uncertain timeline.
Building against statement PDFs first means the entire app — parser, dedupe, rules, review queue,
charts — can be built, used, and iterated on without waiting. The `SourceAdapter` boundary makes
the eventual swap a single new module.

---

### D2 — Money as integer cents
**Decided.** `bigint` cents in Postgres, `number` of cents in TypeScript. Floating point money bugs
in a budgeting app destroy trust in the numbers, which is the only thing the app sells.

---

### D3 — Amounts always positive, sign carried by `direction`
**Decided.** The alternative — signed amounts — produces three representations of a refund and
charts that disagree with the ledger. One representation, one enum.

---

### D4 — Running balance is part of the dedupe hash
**Decided.** Two identical purchases at the same merchant on the same day are indistinguishable by
date, amount, and description. Without the balance in the hash, the second is silently dropped as a
duplicate. Their closing balances differ, so including it keeps them distinct. This also gives the
continuity check for free. Deferred with D26; see `docs/statement-import.md`.

---

### D5 — Balance continuity is a hard gate, not a warning
**Decided.** A batch with any arithmetic break inserts zero transactions. The failure this prevents
— a parser that drops one row per statement — is invisible for months and corrupts every number
downstream. A loud failure on import day is far cheaper.

---

### D6 — Nothing auto-confirms
**Decided.** No confidence threshold, no trusted merchants. The review step is the product. If it
becomes tedious the answer is better rules, never a bypass.

---

### D7 — Rules before LLM
**Decided.** Deterministic pattern matching handles the overwhelming majority of transactions,
costs nothing, runs instantly, and improves with use. The LLM is a cold-start tool for unseen
merchant strings, gated behind a flag and off by default.

---

### D8 — Single-tenant app, multi-tenant schema
**Decided.** One user, but every table carries `user_id` with RLS from day one. The cost is one
column and one policy per table; the cost of retrofitting is a rewrite. No sharing, invitation, or
household features are implied by this — see `product-spec.md#non-goals`.

---

### D9 — Budgets stored per month, not as recurring templates
**Decided.** Copy-forward writes new rows. History stays truthful: a budget raised in March remains
raised in March, and past months do not silently change when a template is edited.

---

### D10 — Confirmed transactions are never retroactively recategorised
**Decided.** A rule created in June does not get to overwrite a judgement made in April.
Retroactive application exists only as an explicit action with a preview.

---

### D11 — Next.js + Supabase + Vercel
**Assumed.** Chosen because it matches the owner's existing stack and the sibling GID project,
so the shell, auth patterns, and deployment are already familiar. Reversible until Sprint 1 ships.
Confirm before starting Sprint 0.

---

### D12 — Recharts for charts
**Assumed.** Adequate for the four or five chart types in scope and light to integrate. Reversible
at any point; charts are the last sprint and touch nothing else.

---

### D13 — pdfjs-dist for text extraction
**Assumed.** Chosen for positional text extraction, which Maybank's column-aligned layout needs.
Alternatives worth benchmarking against a real fixture before committing: `pdf-parse` (simpler, no
positional data), or `pdftotext -layout` via a system binary (excellent layout preservation, adds a
non-JS dependency). Decide during Sprint 2 with a real statement in hand.

---

### D14 — Malaysian banking prefixes are structured, not stripped
**Assumed.** `DUITNOW QR`, `IBFT`, `FPX`, `ATM WDL` and friends are moved into a structured field
rather than deleted, so they remain available to rules and to transfer detection. Depends on what
the owner's real statements actually contain. Revisit after the first real import.

---

### D15 — Cash handled by manual entry only
**Decided.** The owner rarely uses cash, so an envelope-reconciliation flow would be
overengineering. Cash is an account of kind `cash`; entries are typed in directly and land
confirmed. ATM withdrawals pair as transfers. No unaccounted-cash screen.

---

### D16 — Cerebras for LLM inference
**Decided.** Any model calls in Sen go to Cerebras rather than a first-party model API. Integrate
through its OpenAI-compatible endpoint with base URL and model name in environment variables, so
the provider is swappable and no model identifier is hardcoded. Because this is a third-party
inference provider handling data derived from bank records, the payload discipline in
`docs/categorization.md` is a hard requirement, not a guideline: merchant strings only, never
amounts, dates, balances, or counterparty names.

---

### D17 — Statement PDFs are a reconciliation source, not a live feed
**Superseded by D26.** Maybank publishes a statement for month M only after month M ends, so import can never
keep the ledger current. Its role is authoritative month-end verification: prove that what was
captured during the month matches what the bank recorded, and catch anything missed. Day-to-day
capture is a separate, faster path. Supersedes the framing in D1, which treated statement import as
the primary ingestion route; the build order in D1 stands.

---

### D18 — Pre-authorisation triplets collapse into events, rows are retained
**Decided.** *(Algorithm revised by D20.)* Card purchases routinely produce three ledger rows — authorisation, reversal,
settlement — for one economic event, roughly a quarter of all rows in the observed sample. All
three rows are written, preserving balance continuity and correspondence with the bank statement.
They share an `event_group_id`, and the review queue and spending charts operate on events rather
than rows. Collapsing by deleting rows was rejected: it would break the balance checks that make
import trustworthy.

---

### D19 — Direction comes from the amount suffix, never the type name
**Decided.** Maybank's type strings are misleading — `TRANSFER FROM A/C` carries a debit suffix and
`FUND TRANSFER TO A/` carries a credit suffix. Direction is read from the trailing `+`/`-` and
cross-checked against the balance movement. Disagreement fails the row loudly rather than resolving
by preference.

---

### D20 — Event matching is order-independent and tolerates orphans
**Decided.** Supersedes the matching algorithm sketched in D18. A three-month sample showed that
statement order is posting order, not lifecycle order: reversals are printed before the
authorisations they reverse. It also surfaced a second, two-row shape — a settlement reversal with
no authorisation at all — and reversals whose authorisation sits in the previous month's statement.
Matching therefore pairs on merchant, amount, and proximity in date, never on sequence, and leaves
unmatched rows unmatched rather than failing. Cross-statement orphans are re-resolved when the
adjacent month is imported.

---

### D21 — Consecutive statements chain, and that is a third integrity check
**Deferred with D26.** Valid, unimplemented.
**Decided.** Each month's beginning balance equals the previous month's ending balance, verified
across three consecutive statements. This catches an entirely missing month, which neither the
row-continuity check nor the statement-totals check can detect. It runs only when an adjacent month
is already imported, and reports a gap as a warning rather than a hard failure, since importing out
of order is legitimate.

---

### D22 — Recurring detection keys on cadence and descriptor, not on amount
**Decided.** The clearest monthly recurring credit in the sample varies in amount month to month and
carries the period as a suffix in its descriptor, and was absent entirely in one of three months.
Requiring a stable amount would miss it. Detection keys on a stable normalised descriptor plus an
approximate cadence, with amount treated as a typical value rather than a matching condition.

---

### D23 — Manual entry is the intra-month capture path
**Superseded by D24 for bank transactions.** Still stands for cash and anything the bank cannot see.
**Decided.** Spending is entered by hand during the month. At the start of the following month the
statement is imported and reconciled against those entries, per D17. Finverse replaces manual entry
for bank transactions when live access is granted; anything the bank cannot see stays manual
permanently.

No better automated option exists today. Maybank debit card transaction alerts are SMS-only and
fire only at RM 500 and above, so they cannot see a spending profile whose median transaction is a
few ringgit. Malaysian bank coverage among the major international aggregators is close to
non-existent, which leaves Finverse as the realistic route and its commercial timeline as the
gating factor.

Consequence for the build: the manual entry form is a primary screen, not a secondary one. Speed of
entry at ~70–90 events a month is a hard requirement on it.

---

### D24 — M2U transaction history, printed to PDF, is the intra-month capture path
**Decided.** Supersedes D23 for bank transactions. Verified end to end: three real captures parsed,
deduped across prints, and collapsed correctly, with a consistent balance anchor.

The file must come from the browser's own "Save as PDF" print destination. Windows' "Microsoft Print
to PDF" driver rasterises the page — visually identical output, zero extractable text, confirmed
across three tools. Ingest asserts a non-empty text layer and rejects with that specific cause.

Chosen over the alternatives considered: OCR text capture works but has no arithmetic check behind
it, so a plausible misread would survive review and only surface at month end. A DOM-reading
bookmarklet was rejected as unreliable — Content Security Policy blocking is browser-dependent and a
banking portal is the likeliest place to hit it — and it sits in a terms-of-service grey area that
printing does not.

Costs roughly ten rows per print, so two or three prints a week. Rows are provisional; the statement
supersedes them at month end.

---

### D25 — Reconciliation matches on date, amount, and direction, not merchant
**Decided.** The web history carries merchant names the statement does not — a subscription the
statement records only as a phone number appears named in the history view. Merchant-first matching
would fail on exactly those rows. Merchant is a tiebreaker.

A near miss on the same date and merchant with a small amount difference is offered as a correction
to the existing entry rather than treated as two transactions. Without this, one mistyped manual
entry becomes two permanent phantom rows.

---

### D26 — Statement import is deferred; the 90-day history window replaces it
**Decided.** Supersedes D17. The M2U history view offers 30, 60, and 90 day ranges, which means the
same tool does routine weekly capture *and* repair after a missed window. That was the last job the
statement was doing.

The balance anchor on every print already answers "is anything missing." The 90-day window answers
"then get it." A monthly reconciliation pass against a separate, harder-to-parse source adds nothing
on top of those two.

`statement-import.md` is retained in full rather than deleted. It cost several rounds of real-data
analysis, and the conditions that would revive it are concrete: balance drift a 90-day re-import
cannot resolve, or wanting history older than 90 days.

**Structural consequence.** The two pieces that were discovered from statement data but belong to
every source moved out into `event-collapse.md` and `normalisation.md`, and stay in the build.
Deferring a source spec must never take core pipeline logic with it.

Also retired by this: the three-list month-end reconciliation screen. It is replaced by a running
balance figure and a "widen the window and re-import" action, which is less to build and less to
learn.

---

## Adding an entry

Any new dependency, any deviation from these specs, and any resolution of an open question in
`product-spec.md` gets an entry here. One paragraph. State what was chosen and what it rules out.
