# Product spec

## Who this is for

One person. The owner. Malaysia, MYR, a single Maybank savings account that debit card purchases,
bank transfers, and DuitNow QR payments all draw from. Cash is used rarely and logged by hand.

This is not a product for other users. It has exactly one customer, and that customer is
available for questions at all times. Design for that.

## Principles

**Machines type, humans confirm.** The friction Sen removes is data entry. The friction Sen keeps
is judgement. That trade is the entire product.

**Correct beats complete.** A ledger you trust with four categories beats one you doubt with forty.

**Every edit teaches.** Correcting a draft should reduce future corrections. If the review queue
isn't shrinking month over month, the app is failing.

**Boring is a feature.** No streaks, no gamification, no nudges, no AI financial coach. It shows
you what happened and what you have left.

## Core flows

### Import

The owner downloads a monthly statement PDF from Maybank2u and drops it into Sen. Sen parses it,
checks the running-balance arithmetic to prove nothing was dropped, discards rows already imported,
and produces a batch of drafts.

Import always ends on a report screen: rows found, rows new, rows skipped as duplicates, and any
balance discontinuities. The owner should be able to tell at a glance whether the import was clean.
An import with a balance discontinuity is flagged loudly and can be rolled back as a unit.

### Review

The draft queue is the app's front door. Each draft shows the raw description, the amount, the
date, and the proposed category. The owner works down the list.

This screen is used more than any other and must be fast and keyboard-driven. Confirm, change
category, and skip should all be single keystrokes. It should be possible to clear a month's
drafts in under two minutes without the mouse.

When the owner changes a proposed category, Sen offers to create a rule: *always categorise
descriptions matching this pattern as X*. Accepting applies it to the rest of the queue immediately.

### Manual entry

Cash purchases and anything else the bank doesn't see get typed in directly. Same form as editing
a draft, entered as already-confirmed. Under ten seconds for date, amount, category, note.

### Budgets and review

Monthly budget per category. The dashboard answers three questions, in this order of prominence:

1. What have I got left this month?
2. Where is it going?
3. Is that different from usual?

### Recurring

Sen detects transactions that repeat at a regular cadence with a stable amount and surfaces them
as a list of committed monthly spend. Detection proposes; it does not act.

## Non-goals

**Do not build these.** Not in v1, not "while I'm in there," not behind a flag. Each one has killed
a personal finance side project before.

- Multi-user, sharing, households, or invitations
- Multi-currency, FX conversion, or foreign transaction handling
- Investment, brokerage, EPF, or net-worth tracking
- Loans, mortgages, or amortisation schedules
- Bill splitting or IOUs
- Receipt photo capture or OCR
- Forecasting, projections, or "you'll run out on the 23rd" predictions
- Goals, savings challenges, streaks, or any gamification
- Notifications, email digests, or push
- Data export to accounting software
- A mobile app (the web app must be usable on a phone; that is different)
- Any second bank or account type before the first one works end to end
- An LLM chat interface over the ledger

Every item above is defensible in isolation. That is exactly why the list exists.

## What "done" looks like for v1

The owner imports a statement each month, spends under five minutes in the review queue, and
trusts the dashboard enough to make an actual spending decision from it. Three consecutive months
of that and v1 is finished.

## Open questions

These need the owner's answer before the sprint that depends on them:

| Question | Blocks | Status |
| --- | --- | --- |
| Are Maybank e-statement PDFs password protected? If so, how is the password derived? | S2 | Open |
| Does the statement description column ever wrap onto a second line? | S2 | Open |
| What is the starting category taxonomy? | S1 seed | Open |
| Does the owner want DuitNow QR merchant payments and P2P transfers separated automatically? | S5 | Open |
| Should confirmed transactions be editable after the fact, or locked? | S4 | Open |
