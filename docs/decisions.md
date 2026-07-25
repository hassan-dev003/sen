# Decision log

Short records of live choices that would otherwise get re-litigated. **Every entry here is current.**
Reversed decisions are deleted and the numbering re-flowed, so nothing in this file needs reasoning
about whether it still applies. Decisions belonging to deferred work live with that work — see
`statement-import.md`.

Status values: **Decided**, or **Assumed** — chosen to unblock, still wants the owner's
confirmation.

---

### D1 — Money as integer cents
**Decided.** `bigint` cents in Postgres, `number` of cents in TypeScript. Floating point money bugs
in a budgeting app destroy trust in the numbers, which is the only thing the app sells.

---

### D2 — Amounts always positive, sign carried by `direction`
**Decided.** The alternative — signed amounts — produces three representations of a refund and
charts that disagree with the ledger. One representation, one enum.

---

### D3 — Nothing auto-confirms
**Decided.** No confidence threshold, no trusted merchants. The review step is the product. If it
becomes tedious the answer is better rules, never a bypass.

---

### D4 — Rules before LLM
**Decided.** Deterministic pattern matching handles the overwhelming majority of transactions,
costs nothing, runs instantly, and improves with use. The LLM is a cold-start tool for unseen
merchant strings, gated behind a flag and off by default.

---

### D5 — Single-tenant app, multi-tenant schema
**Decided.** One user, but every table carries `user_id` with RLS from day one. The cost is one
column and one policy per table; the cost of retrofitting is a rewrite. No sharing, invitation, or
household features are implied by this — see `product-spec.md#non-goals`.

---

### D6 — Budgets stored per month, not as recurring templates
**Decided.** Copy-forward writes new rows. History stays truthful: a budget raised in March remains
raised in March, and past months do not silently change when a template is edited.

---

### D7 — Confirmed transactions are never retroactively recategorised
**Decided.** A rule created in June does not get to overwrite a judgement made in April.
Retroactive application exists only as an explicit action with a preview.

---

### D8 — Next.js + Supabase + Vercel
**Decided.** Confirmed by the owner at the start of Sprint 0. Matches the owner's existing stack and
the sibling GID project, so the shell, auth patterns, and deployment are already familiar. The
Sprint 0 scaffold is built on it: Next.js App Router + TypeScript strict, Supabase/Postgres with
RLS, Supabase Auth magic-link, Tailwind, Vitest, and a hosted Supabase project provisioned in
`ap-southeast-1`.

---

### D9 — Recharts for charts
**Assumed.** Adequate for the four or five chart types in scope and light to integrate. Reversible
at any point; charts are the last sprint and touch nothing else.

---

### D10 — Text extraction is plain PDF text, not layout reconstruction
**Decided.** The capture path is a browser-exported PDF whose text layer extracts cleanly
in reading order — verified with `pypdf` on real captures — so no positional reconstruction is
needed. Use any maintained text extractor; the parser depends only on line order.

**The dependency is confined to `lib/sources/m2u-history/extract.ts` and appears nowhere else.**
It must accept a buffer rather than a path, and must run on Vercel's serverless runtime, so no
native binaries. Swapping it later should touch one file.

`extract` asserts a non-empty text layer and throws a typed error when it is empty; the ingest layer
turns that into wording for a human. A rasterised print produces zero characters, and that failure
has to be named at the door rather than surfacing as a confusing parse error deeper in.

---

### D11 — Payment rails are structured, not stripped
**Assumed.** `DUITNOW QR`, `IBFT`, `FPX`, `ATM WDL` and friends are moved into a structured field
rather than deleted, so they remain available to rules and to transfer detection. Depends on what
the owner's real statements actually contain. Revisit after the first real import.

---

### D12 — Cash handled by manual entry only
**Decided.** The owner rarely uses cash, so an envelope-reconciliation flow would be
overengineering. Cash is an account of kind `cash`; entries are typed in directly and land
confirmed. ATM withdrawals pair as transfers. No unaccounted-cash screen.

---

### D13 — Cerebras for LLM inference
**Decided.** Any model calls in Sen go to Cerebras rather than a first-party model API. Integrate
through its OpenAI-compatible endpoint with base URL and model name in environment variables, so
the provider is swappable and no model identifier is hardcoded. Because this is a third-party
inference provider handling data derived from bank records, the payload discipline in
`docs/categorization.md` is a hard requirement, not a guideline: merchant strings only, never
amounts, dates, balances, or counterparty names.

---

### D14 — Pre-authorisation groups collapse into events, order-independently
**Decided.** A card purchase reaches the ledger as several rows — authorisation, reversal,
settlement — for one economic event, roughly 30% of rows in the observed data. All rows are written,
preserving correspondence with the bank. They share an `event_group_id`, and the review queue and
every spending figure operate on events rather than rows. Collapsing by deleting rows was rejected:
it would break the balance arithmetic that makes import trustworthy.

Matching is **order-independent**. Statement and history views both print reversals before the
authorisations they reverse — the sequence is posting order, not lifecycle order. Matching pairs on
merchant, amount, and date proximity, never on position.

It also **tolerates orphans**. A reversal can appear in one capture with its authorisation in
another, and a settlement reversal is a two-row shape with no authorisation at all. Unmatched rows
at capture boundaries are expected, not errors; they re-resolve when the adjacent window is
imported.

---

### D15 — Direction comes from the amount's sign, never the transaction type
**Decided.** Maybank's type strings are misleading: `TRANSFER FROM A/C` is money leaving the
account and `FUND TRANSFER TO A/` is money arriving. Direction is read from the sign marker on the
amount — a leading `-` in the history view, a trailing `-`/`+` in the statement — and never inferred
from the type name. Where a balance figure is available to cross-check, disagreement fails the row
loudly rather than resolving by preference.

---

### D16 — Recurring detection keys on cadence and descriptor, not on amount
**Decided.** The clearest monthly recurring credit in the sample varies in amount month to month and
carries the period as a suffix in its descriptor, and was absent entirely in one of three months.
Requiring a stable amount would miss it. Detection keys on a stable normalised descriptor plus an
approximate cadence, with amount treated as a typical value rather than a matching condition.

---

### D17 — M2U transaction history, printed to PDF, is the capture path
**Decided.** Verified end to end: three real captures parsed,
deduped across prints, and collapsed correctly, with a consistent balance anchor.

The file must come from the browser's own "Save as PDF" print destination. Windows' "Microsoft Print
to PDF" driver rasterises the page — visually identical output, zero extractable text, confirmed
across three tools. Ingest asserts a non-empty text layer and rejects with that specific cause.

Chosen over the alternatives considered: OCR text capture works but has no arithmetic check behind
it, so a plausible misread would survive review undetected. A DOM-reading
bookmarklet was rejected as unreliable — Content Security Policy blocking is browser-dependent and a
banking portal is the likeliest place to hit it — and it sits in a terms-of-service grey area that
printing does not.

Costs roughly ten rows per print, so two or three prints a week. The view's 30, 60, and 90 day
windows make it the repair path as well: re-import a wider window and dedupe absorbs the overlap.

---

### D18 — Cross-source matching keys on date, amount, and direction
**Decided.** Merchant strings differ between sources for the same transaction. The history view
carries names the statement does not — a subscription the statement records only as a phone number
appears named in the history. Any matching between two sources therefore keys on date, amount, and
direction, with merchant as a tiebreaker only.

This governs the Finverse cutover and any future revival of statement import. It also governs
dedupe when a wider capture window is re-imported over an existing one: a near miss on the same date
and merchant with a small amount difference is offered as a correction to the existing row, never
inserted as a second transaction.

---

### D19 — Statement import is deferred; the 90-day history window replaces it
**Decided.** The M2U history view offers 30, 60, and 90 day ranges, which means the same tool does
routine weekly capture *and* repair after a missed window. That was the last job the statement was
doing.

The balance anchor on every print already answers "is anything missing." The 90-day window answers
"then get it." A monthly reconciliation pass against a separate, harder-to-parse source adds nothing
on top of those two, so there is no reconciliation step and no reconciliation screen — a running
balance figure and a "widen the window and re-import" action replace both.

`statement-import.md` is retained in full rather than deleted. It cost several rounds of real-data
analysis, and the conditions that would revive it are concrete: balance drift a 90-day re-import
cannot resolve, or wanting history older than 90 days.

**Structural consequence.** The two pieces that were discovered from statement data but belong to
every source moved out into `event-collapse.md` and `normalisation.md`, and stay in the build.
Deferring a source spec must never take core pipeline logic with it.

---

### D20 — `pdfjs-dist` is the PDF text extractor
**Decided.** The text extractor blessed by D10 is Mozilla's `pdfjs-dist` (legacy build), used only
in `lib/sources/m2u-history/extract.ts`. It is pure JavaScript with no native binaries, accepts a
`Uint8Array`, and runs the parse on the main thread with the worker disabled, so it works on
Vercel's serverless runtime. `unpdf` was tried first and rejected: its bundled pdf.js throws a
`structuredClone`/`postMessage` error under Node 22 in this environment. Text extraction needs no
canvas or fonts, so none of pdf.js's optional rendering paths are pulled in. Swapping it later
touches one file.

---


### D21 — A confirmed opening balance is the baseline; unresolved differences become adjustments
**Decided.** Balance verification needs a point to count from, and with statement import deferred
there is no closing balance to inherit. Two parts.

**The baseline is derived, then confirmed.** The first import already contains everything needed:
the account balance is on the print, and subtracting the captured transactions gives the balance
before them. Sen computes it and shows it; the owner accepts or overwrites. Deriving silently was
rejected — a first capture that missed a page would bake the error into the baseline forever, and
every later check would report a clean zero against a ledger that is wrong. Asking the owner to
supply the figure unaided was also rejected: they would have to reconstruct a historical balance
by hand, and a pre-filled number they can sanity-check is both easier and more accurate.

**Unresolved differences become explicit adjustments.** Widening the capture window is the first
remedy. When a difference survives that — something older than 90 days, or a transaction the history
view never showed — the owner posts one entry for the difference in an `Unaccounted` category,
following ordinary reconciliation practice: park the unknown somewhere visible rather than letting
it distort everything around it.

Adjustments are ordinary transactions flagged `is_adjustment`, and they **count in charts**. Hiding
them would make the ledger balance while the spending picture under-reports, which is a worse
failure than an ugly category. Being visible is also what creates pressure to resolve them, and
deleting one is the normal retraction when the real transaction turns up.

Sen never posts an adjustment by itself. It offers the figure; the owner decides — consistent with
D3.

---

### D22 — Confirmed transactions stay editable by the owner, with an audit trail
**Decided.** Resolves the `product-spec.md` open question that blocked Sprint 4. A
confirmed transaction is not locked: the owner can correct its category, amount, or note
after the fact. This is consistent with manual entry, which lands already-confirmed and is
edited through the same form (product-spec.md#manual-entry), and with a single-owner app
where the owner is the sole authority.

Two guards keep "editable" from meaning "untrustworthy":

- **Only the owner edits, never a rule.** This does not reopen D7 — a rule created later still
  never retroactively rewrites a confirmed row. Automatic recategorisation of confirmed history
  remains an explicit, previewed action, and nothing here changes that.
- **Every edit to a confirmed row is recorded.** Edits are written to a `transaction_revisions`
  audit table (what changed, from and to, when), so a correction is visible rather than silent.
  This is the owner's own data under RLS, not a log, so it does not conflict with AGENTS.md #9.

Editing a *draft* in the review queue is ordinary review, not a correction, and records no
revision — a draft is a proposal, not yet ledger truth. The revision trail and the edit surface
it hangs off (the ledger's row editor) are built in Sprint 6, where editing a confirmed
transaction first has a home; Sprint 4 establishes the decision and the review-queue behaviour
that depends on it (manual entries are editable, confirmation is not a one-way door).

---

## Adding an entry

Any new dependency, any deviation from these specs, and any resolution of an open question in
`product-spec.md` gets an entry here. One paragraph. State what was chosen and what it rules out.

**Superseded decisions are deleted, not annotated.** A decision log that carries its own history is
a log an agent has to reason about. Numbering is contiguous and is re-flowed when entries are
removed. Work that is *deferred* rather than reversed is different: it stays, in the spec it belongs
to, clearly marked — see `statement-import.md`.
