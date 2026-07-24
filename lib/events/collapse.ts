/**
 * Event collapse. Core pipeline logic, applies to every source
 * (docs/event-collapse.md). A card purchase reaches the ledger as several rows —
 * an authorisation, its reversal, and a settlement — for one economic event.
 * This groups them into one reviewable event while retaining every row, so the
 * ledger still matches the bank exactly.
 *
 * It groups; it never deletes. It is order-independent (the bank prints
 * reversals before the authorisations they reverse) and tolerant of unmatched
 * rows at capture boundaries (a reversal whose authorisation is in a capture not
 * yet imported).
 */
import type {
  CollapseInput,
  CollapseResult,
  CollapsedEvent,
  CollapsedRow,
  EventRole,
} from "./types";

/**
 * First-line type -> role. A configurable table, not hard-coded logic
 * (docs/event-collapse.md). Anything not listed is a `single`: a standalone
 * transaction that is its own event (a transfer, a QR payment, salary).
 */
const ROLE_BY_TYPE: Record<string, EventRole> = {
  "PRE-AUTH MYDEBIT": "authorization",
  "PRE-AUTH DEBIT": "authorization",
  "REV PREAUTH MYDEBIT": "auth_reversal",
  "PRE-AUTH REFUND": "auth_reversal",
  "PAYMENT VIA MYDEBIT": "settlement",
  "SALE DEBIT": "settlement",
  "PYMT VIA MYDEBIT RE": "settlement_reversal",
};

/** Rows of one merchant this many days apart or less collapse together. */
const WINDOW_DAYS = 10;

function roleOf(row: CollapseInput): EventRole {
  return (row.type && ROLE_BY_TYPE[row.type]) || "single";
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return ms / 86_400_000;
}

/** Cluster a merchant's rows so neighbours within the window group together. */
function clusterByWindow(rows: CollapseInput[]): CollapseInput[][] {
  const sorted = [...rows].sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  const clusters: CollapseInput[][] = [];
  let current: CollapseInput[] = [];
  let last: string | null = null;
  for (const row of sorted) {
    if (last !== null && daysBetween(last, row.bookedAt) > WINDOW_DAYS) {
      clusters.push(current);
      current = [];
    }
    current.push(row);
    last = row.bookedAt;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/** Nearest by date, then by id, so pairing is deterministic. */
function nearestTo(target: CollapseInput) {
  return (a: CollapseInput, b: CollapseInput): number => {
    const da = daysBetween(target.bookedAt, a.bookedAt);
    const db = daysBetween(target.bookedAt, b.bookedAt);
    return da !== db ? da - db : a.id.localeCompare(b.id);
  };
}

class Emitter {
  private n = 0;
  readonly rows: CollapsedRow[] = [];
  readonly events: CollapsedEvent[] = [];

  emit(
    members: Array<{ row: CollapseInput; role: EventRole }>,
    state: CollapsedEvent["state"],
    amountCents: number,
    direction: CollapsedEvent["direction"],
  ): void {
    const eventGroupId = `g${++this.n}`;
    for (const { row, role } of members) {
      this.rows.push({ id: row.id, eventGroupId, eventRole: role });
    }
    this.events.push({
      eventGroupId,
      state,
      amountCents,
      direction,
      rowIds: members.map((m) => m.row.id),
    });
  }
}

function collapseCluster(cluster: CollapseInput[], out: Emitter): void {
  const auths = cluster.filter((r) => roleOf(r) === "authorization");
  const authRevs = cluster.filter((r) => roleOf(r) === "auth_reversal");
  const setts = cluster.filter((r) => roleOf(r) === "settlement");
  const settRevs = cluster.filter((r) => roleOf(r) === "settlement_reversal");

  // (3) pair each auth-reversal with an unpaired auth of the SAME amount,
  //     nearest by date, regardless of print order.
  const usedAuth = new Set<string>();
  const authForRev = new Map<string, CollapseInput>();
  for (const rev of authRevs) {
    const match = auths
      .filter((a) => !usedAuth.has(a.id) && a.amountCents === rev.amountCents)
      .sort(nearestTo(rev))[0];
    if (match) {
      usedAuth.add(match.id);
      authForRev.set(rev.id, match);
    }
  }

  // (4) pair each settlement-reversal with an unpaired settlement, same amount.
  const usedSett = new Set<string>();
  const settForRev = new Map<string, CollapseInput>();
  for (const rev of settRevs) {
    const match = setts
      .filter((s) => !usedSett.has(s.id) && s.amountCents === rev.amountCents)
      .sort(nearestTo(rev))[0];
    if (match) {
      usedSett.add(match.id);
      settForRev.set(rev.id, match);
    }
  }

  const pairedAuthRevs = authRevs.filter((r) => authForRev.has(r.id));
  const usedPair = new Set<string>();

  // (5) every settlement is an economic event. Attach the nearest unused
  //     auth+reversal pair (the pre-auth for this purchase) and, if the
  //     settlement was refunded, its settlement-reversal. Amounts need not match
  //     across the three — foreign-currency settlements differ from the auth.
  for (const sett of setts) {
    const members: Array<{ row: CollapseInput; role: EventRole }> = [
      { row: sett, role: "settlement" },
    ];

    const refund = settRevs.find((rv) => settForRev.get(rv.id)?.id === sett.id);
    if (refund) members.push({ row: refund, role: "settlement_reversal" });

    const pairRev = pairedAuthRevs
      .filter((r) => !usedPair.has(r.id))
      .sort(nearestTo(sett))[0];
    if (pairRev) {
      usedPair.add(pairRev.id);
      members.push({ row: authForRev.get(pairRev.id)!, role: "authorization" });
      members.push({ row: pairRev, role: "auth_reversal" });
    }

    out.emit(members, "resolved", refund ? 0 : sett.amountCents, sett.direction);
  }

  // (6) an auth+reversal pair with no settlement is a cancelled event, net zero.
  for (const rev of pairedAuthRevs) {
    if (usedPair.has(rev.id)) continue;
    const auth = authForRev.get(rev.id)!;
    out.emit(
      [
        { row: auth, role: "authorization" },
        { row: rev, role: "auth_reversal" },
      ],
      "cancelled",
      0,
      auth.direction,
    );
  }

  // (7) an auth with no reversal is still pending — provisional, re-resolved on
  //     the next import.
  for (const auth of auths) {
    if (usedAuth.has(auth.id)) continue;
    out.emit(
      [{ row: auth, role: "authorization" }],
      "pending",
      auth.amountCents,
      auth.direction,
    );
  }

  // (8) reversals with nothing to pair against are cross-boundary orphans.
  for (const rev of authRevs) {
    if (authForRev.has(rev.id)) continue;
    out.emit(
      [{ row: rev, role: "auth_reversal" }],
      "orphan",
      rev.amountCents,
      rev.direction,
    );
  }
  for (const rev of settRevs) {
    if (settForRev.has(rev.id)) continue;
    out.emit(
      [{ row: rev, role: "settlement_reversal" }],
      "orphan",
      rev.amountCents,
      rev.direction,
    );
  }
}

/**
 * Collapse a batch of rows into events. Singles pass through as their own
 * one-row events; card-lifecycle rows group by merchant and date proximity.
 */
export function collapseEvents(input: readonly CollapseInput[]): CollapseResult {
  const out = new Emitter();

  const lifecycle: CollapseInput[] = [];
  const byMerchant = new Map<string, CollapseInput[]>();

  for (const row of input) {
    if (roleOf(row) === "single") {
      out.emit([{ row, role: "single" }], "resolved", row.amountCents, row.direction);
    } else {
      lifecycle.push(row);
      const bucket = byMerchant.get(row.merchantKey) ?? [];
      bucket.push(row);
      byMerchant.set(row.merchantKey, bucket);
    }
  }

  for (const rows of byMerchant.values()) {
    for (const cluster of clusterByWindow(rows)) {
      collapseCluster(cluster, out);
    }
  }

  return { rows: out.rows, events: out.events };
}
