# Categorisation

The rules engine is what makes Sen worth using in month three. Get it right and the review queue
shrinks toward empty; get it wrong and this becomes another app that asks you to sort your own
transactions forever.

## The order of operations

Categorisation operates on **events**, not rows. A collapsed group gets one category, applied to
all its constituent rows. Never categorise an authorisation separately from its settlement.

For each new draft event, in strict order, stopping at the first hit:

1. **Rules** — deterministic pattern matches, ordered by `priority` ascending
2. **Merchant memory** — a previously confirmed transaction with the same
   `description_normalized` and its category
3. **LLM fallback** — optional, off by default, batch-suggests for unmatched rows
4. **Uncategorised** — a legitimate outcome, not a failure

Steps 1 and 2 are free, instant, and deterministic. Step 3 is neither. Most descriptions repeat, so
after the first month or two, step 3 should almost never fire. If it fires often, the normaliser is
stripping too little and identical merchants are producing different strings — fix that instead of
reaching for a bigger model.

**Nothing here confirms a transaction.** These produce a *proposal*. See `AGENTS.md` rule 2.

## Rule matching

```ts
interface Rule {
  id: string;
  priority: number;                 // lower wins
  field: 'description_normalized' | 'reference';
  matchType: 'contains' | 'starts_with' | 'exact' | 'regex';
  matchValue: string;
  setCategoryId: string | null;
  setMerchant: string | null;
  active: boolean;
}
```

First match by priority wins. Ties break by `created_at` ascending — older rules are more
established. Record the winning rule in `transactions.applied_rule_id`.

Two merchant shapes the matcher must handle, both observed in real statements:

- **No merchant at all.** Common on DuitNow QR rows carrying only a reference and a rail. Fall back
  to matching on the rail plus amount, or leave uncategorised — do not invent a merchant.
- **A bare phone number as the merchant.** Two recurring monthly subscriptions appear this way, with
  a US number and nothing else. `contains` matching on the number works; make sure normalisation
  does not strip it as a reference token.

Regex rules are supported but not offered in the "create rule from this edit" flow. They are a
power-user escape hatch, typed by hand in settings. Compile them with a timeout and disable any
rule that throws — a bad regex should not be able to break an import.

## The learning loop

This is the feature. Build it properly.

When the owner changes the category on a draft, offer, inline and without leaving the queue:

> Always categorise **DUITNOW QR MIXUE** as **Food**?
> [ Just this one ] [ Create rule ]

If they create the rule:

1. Insert a `rules` row with `learned = true`, `match_type = 'contains'`, and `match_value` set to
   the longest stable substring of the normalised description
2. Immediately re-run categorisation over all remaining `draft` rows and update the queue in place
3. Show how many other drafts it just caught — that number is the reward loop

Do **not** retroactively change `confirmed` transactions. Confirmation is a human judgement and a
rule created later does not get to overwrite it. Offer it as an explicit, separate action in
settings if the owner asks for it, with a preview of what would change.

### Choosing the match value

The suggested pattern should be the merchant portion of the normalised description, with the
banking prefix and any trailing reference stripped. Show it, and let the owner edit it before
saving. Never save a learned rule without showing the pattern — a silently-created rule that
matches too broadly is worse than no rule, because it produces confidently wrong drafts.

### Measuring rule quality

Every time a rule sets a category and the owner changes it, increment `override_count`. Settings
shows rules sorted by override ratio. A rule at 40% overrides is doing harm and should be narrowed
or deleted.

This is why `applied_rule_id` exists. Without it, the rules engine only ever accumulates and never
improves.

## LLM fallback (optional, Sprint 5, default off)

For descriptions that match nothing. Strictly a suggestion generator.

- Batch unmatched normalised descriptions — **unique strings only**, not one call per transaction
- Send descriptions and the category list. Send nothing else: no amounts, no dates, no balances,
  no account identifiers
- Require a JSON-only response mapping description to category name plus a confidence
- Unknown category names in the response are discarded, not created
- Cache by `description_normalized` so the same string is never sent twice
- Behind `ENABLE_LLM_CATEGORIZATION`, off by default

A suggestion accepted by the owner becomes an ordinary learned rule, which means the second
occurrence of that merchant costs nothing. The LLM is a cold-start tool, not a runtime dependency.

Provider is Cerebras, via its OpenAI-compatible endpoint. Base URL and model name go in
environment variables; do not hardcode a model identifier, and check Cerebras's current model list
when wiring it up. Cerebras is fast enough that batching a month of unmatched strings is a
sub-second call, which makes the caching rule above about cost and privacy rather than latency.

**Never send the model anything that would violate `AGENTS.md` rule 8.** A merchant name is
acceptable. A merchant name attached to an amount and a date is a spending profile. This is a
third-party inference provider, so the rule is absolute: no amounts, no dates, no balances, and in
particular **no counterparty names** — person-to-person transfers carry real people's names in the
merchant field and those must be filtered out before any request is built.

## Transfers

Movements between the owner's own accounts are not spending, and counting them as such is the
fastest way to make the dashboard lie.

- An ATM withdrawal debits the bank account and credits the cash account. Both legs get a
  `transfer` category and share a `transfer_group_id`.
- Pairing is proposed by matching an unpaired debit and credit with equal amounts within a
  three-day window across two of the owner's accounts. It is proposed, not applied.
- Every chart and budget calculation excludes categories where `kind = 'transfer'`. Write this as a
  shared query helper in `lib/db/` so it cannot be forgotten in one place and applied in another.

Person-to-person transfers are a large share of real activity, run in both directions via MAE QR,
and carry the counterparty's name in the merchant field. Whether they are spending, transfers, or a
category of their own is an open question in `product-spec.md`. Do not decide it in code.

Own-account transfers — where the counterparty name matches the account holder — are unambiguous
transfers and should be detected automatically.

## What not to build

- No auto-confirm at any confidence level
- No category taxonomy generated by a model
- No natural-language rule authoring
- No re-categorisation of confirmed history without explicit, previewed consent
