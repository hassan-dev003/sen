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

## Adding an entry

Any new dependency, any deviation from these specs, and any resolution of an open question in
`product-spec.md` gets an entry here. One paragraph. State what was chosen and what it rules out.
