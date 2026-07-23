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

### Capture

Transactions come from the M2U transaction history: print the view to PDF from the browser and drop
it in. Roughly ten rows per print, so two or three prints a week. The view offers 30, 60, and 90 day
windows, which makes it both the routine capture path and the repair path. Rows land as drafts in
the review queue like any other source.

Anything the bank cannot see — cash, mainly — is still typed in by hand.

### Import

The owner downloads a monthly statement PDF from Maybank2u and drops it into Sen. Sen parses it,
checks the running-balance arithmetic to prove nothing was dropped, discards rows already imported,
and produces a batch of drafts.

Import always ends on a report screen: rows found, events after collapse, rows new, rows skipped as
duplicates, and the result of all three balance checks. The owner should be able to tell at a glance
whether the import was clean. An import with a balance discontinuity is flagged loudly and can be
rolled back as a unit. A gap against the previous month's closing balance is a warning, not a
failure — importing out of order is legitimate.

### Verify

There is no month-end ritual. Every print carries the account's current balance, so each import
checks itself: everything Sen holds for that account should add up to the balance on the newest
capture. Verified, or off by an amount.

When it is off, the repair is the same tool — switch the history view to 60 or 90 days, print, and
re-import. Dedupe absorbs the overlap and the missing rows fill in. A missed fortnight is a minor
inconvenience rather than a permanent hole.

### Review

The draft queue is the app's front door. Each draft shows the raw description, the amount, the
date, and the proposed category. The owner works down the list.

This screen is used more than any other and must be fast and keyboard-driven. Confirm, change
category, and skip should all be single keystrokes. It should be possible to clear a month's
drafts in under two minutes without the mouse.

When the owner changes a proposed category, Sen offers to create a rule: *always categorise
descriptions matching this pattern as X*. Accepting applies it to the rest of the queue immediately.

### Manual entry

Cash purchases, and anything captured during the month before the statement exists, get typed in
directly. Same form as editing a draft, entered as already-confirmed. Under ten seconds for date,
amount, category, note.

This is the primary capture path for the whole app until a live feed exists. Real volume is roughly
70–90 economic events a month, most of them small and repetitive — the same handful of merchant
strings recurring many times each. The form has to survive that, so speed of entry is a hard
requirement on this screen, not a nice-to-have.

### Budgets and review

Monthly budget per category. The dashboard answers three questions, in this order of prominence:

1. What have I got left this month?
2. Where is it going?
3. Is that different from usual?

### Recurring

Sen detects transactions that repeat at a regular cadence and surfaces them as a list of committed
monthly spend. Detection proposes; it does not act.

**Detection keys on cadence and a stable normalised descriptor, not on a stable amount.** The
clearest monthly item in the sample varies in amount month to month, carries the period as a suffix
in its descriptor, and was missing entirely from one of three months. Amount is a typical value, not
a matching condition.

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

These need the owner's answer before the sprint that depends on them.

| Question | Blocks | Status |
| --- | --- | --- |
| What is the starting category taxonomy? | S1 seed | Open |
| Should MAE QR person-to-person transfers be spending, transfers, or their own category? They are high-volume and run in both directions. | S5 | Open |
| Should confirmed transactions be editable after the fact, or locked? | S4 | Open |
| Are Maybank e-statement PDFs password protected? | S2 | **Answered — no.** Three statements extracted cleanly as text. |
| Does the description column wrap onto a second line? | S2 | **Answered — no.** Blocks are 1–4 discrete lines; the merchant is truncated at 20 characters rather than wrapped. |
| How is spending captured? | S4 | **Answered — M2U history print-to-PDF** (D24) for bank transactions, manual entry for cash. Statement import deferred (D26). |
