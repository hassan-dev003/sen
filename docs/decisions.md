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
continuity check for free. See `docs/statement-import.md#dedupe`.

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
**Decided.** Maybank publishes a statement for month M only after month M ends, so import can never
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

## Adding an entry

Any new dependency, any deviation from these specs, and any resolution of an open question in
`product-spec.md` gets an entry here. One paragraph. State what was chosen and what it rules out.
