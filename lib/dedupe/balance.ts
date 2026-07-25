/**
 * Balance verification for the history path (D21, docs/history-import.md).
 *
 * There is no per-row running balance, so completeness is checked against the
 * account balance printed on the newest capture, counting from a confirmed
 * opening balance:
 *
 *   opening_balance + sum(signed amounts on/after opening_balance_at)
 *     === balance_on_newest_print
 *
 * It is a running figure, never a gate, and is suppressed when a non-zero float
 * line made the anchor unreliable.
 */
import { signedCents } from "@/lib/money";
import type { Direction } from "@/lib/sources/types";

interface SignedRow {
  amountCents: number;
  direction: Direction;
}

/** Signed total of a set of rows: debits negative, credits positive. */
export function sumSigned(rows: readonly SignedRow[]): number {
  let total = 0;
  for (const r of rows) total += signedCents(r.amountCents, r.direction);
  return total;
}

/**
 * Derive the opening balance from the first capture (D21). Everything needed is
 * on the print: subtract the captured movements from the printed balance to get
 * the balance before them. Returns null when there is no reliable anchor or no
 * rows to count. The owner confirms or overwrites the result — Sen never sets it
 * silently.
 */
export function deriveOpeningBalance(capture: {
  rows: ReadonlyArray<SignedRow & { bookedAt: string }>;
  balanceAnchorCents: number | null;
  anchorReliable: boolean;
}): { openingBalanceCents: number; openingBalanceAt: string } | null {
  if (
    capture.balanceAnchorCents === null ||
    !capture.anchorReliable ||
    capture.rows.length === 0
  ) {
    return null;
  }
  const openingBalanceCents = capture.balanceAnchorCents - sumSigned(capture.rows);
  const openingBalanceAt = capture.rows
    .map((r) => r.bookedAt)
    .reduce((a, b) => (a < b ? a : b));
  return { openingBalanceCents, openingBalanceAt };
}

export interface Verification {
  /** False when there is no baseline yet, or the anchor is unreliable. */
  applicable: boolean;
  ok: boolean;
  /** anchor − (opening + movements). Zero means the captures fully explain it. */
  differenceCents: number;
}

/**
 * Compare the printed balance against the opening balance plus everything
 * captured on or after `opening_balance_at`. `sumSignedOnAfterCents` is that sum,
 * computed from the ledger by the caller.
 */
export function verifyBalance(params: {
  openingBalanceCents: number | null;
  openingBalanceAt: string | null;
  sumSignedOnAfterCents: number;
  anchorCents: number | null;
  anchorReliable: boolean;
}): Verification {
  const applicable =
    params.anchorReliable &&
    params.anchorCents !== null &&
    params.openingBalanceCents !== null &&
    params.openingBalanceAt !== null;

  if (!applicable) {
    return { applicable: false, ok: false, differenceCents: 0 };
  }

  const expected = params.anchorCents!;
  const actual = params.openingBalanceCents! + params.sumSignedOnAfterCents;
  const differenceCents = expected - actual;
  return { applicable: true, ok: differenceCents === 0, differenceCents };
}
