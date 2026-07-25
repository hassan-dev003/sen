/**
 * Projecting stored transaction rows back into reviewable events.
 *
 * Import time runs the collapser (docs/event-collapse.md) and persists an
 * `event_group_id`, `event_role`, and `event_state` on every row. The review
 * queue does the inverse: it reads those rows back and reconstructs one event
 * per group, so the owner reviews ~70 economic events rather than ~100 rows
 * (AGENTS.md #8 — events for money questions, rows for balance questions).
 *
 * This is a pure projection. It never queries; it takes the rows a query
 * returned and groups them. The amount and direction it derives per event match
 * exactly what `collapseEvents` emitted, so a projected event and the collapser's
 * event always agree — the rules live in one place conceptually and are asserted
 * against each other in the tests.
 */
import type { Direction } from "@/lib/sources/types";
import type { EventRole, EventState } from "./types";

export type ReviewState = "draft" | "confirmed" | "ignored";

/** One stored transaction row, as the queue query returns it. */
export interface QueueRow {
  id: string;
  eventGroupId: string;
  eventRole: EventRole;
  eventState: EventState;
  reviewState: ReviewState;
  bookedAt: string;
  amountCents: number;
  direction: Direction;
  descriptionRaw: string;
  merchant: string | null;
  rail: string | null;
  categoryId: string | null;
  batchId: string | null;
  note: string | null;
  isAdjustment: boolean;
}

/** One reviewable event: its economic figure, plus every row behind it. */
export interface QueueEvent {
  eventGroupId: string;
  state: EventState;
  reviewState: ReviewState;
  /** Booking date of the primary row (settlement, else auth, else the row). */
  bookedAt: string;
  /** The economic amount — the settlement, or zero when the group nets out. */
  amountCents: number;
  direction: Direction;
  descriptionRaw: string;
  merchant: string | null;
  rail: string | null;
  categoryId: string | null;
  batchId: string | null;
  note: string | null;
  isAdjustment: boolean;
  /** Constituent rows, oldest first, retained and shown on expand. */
  rows: QueueRow[];
}

/**
 * Precedence for choosing the row that speaks for the event — its date, its
 * description. The settlement is the real purchase; the authorisation stands in
 * while a settlement is still pending; a lone reversal represents an orphan.
 */
const PRIMARY_ORDER: EventRole[] = [
  "settlement",
  "authorization",
  "single",
  "auth_reversal",
  "settlement_reversal",
];

function primaryRow(rows: QueueRow[]): QueueRow {
  for (const role of PRIMARY_ORDER) {
    const hit = rows.find((r) => r.eventRole === role);
    if (hit) return hit;
  }
  return rows[0]!;
}

/**
 * The event's economic amount and direction, derived from its rows' roles.
 * Mirrors `collapseEvents` (lib/events/collapse.ts):
 *   - a settlement that was refunded nets to zero;
 *   - otherwise the settlement is the amount;
 *   - with no settlement, an authorisation is provisional (pending) or, once
 *     reversed, cancelled to zero;
 *   - a lone reversal (orphan) shows its own amount.
 */
function economicAmount(rows: QueueRow[]): { amountCents: number; direction: Direction } {
  const byRole = (role: EventRole) => rows.find((r) => r.eventRole === role);

  const single = byRole("single");
  if (single) return { amountCents: single.amountCents, direction: single.direction };

  const settlement = byRole("settlement");
  if (settlement) {
    const refunded = byRole("settlement_reversal");
    return {
      amountCents: refunded ? 0 : settlement.amountCents,
      direction: settlement.direction,
    };
  }

  const auth = byRole("authorization");
  if (auth) {
    const reversed = byRole("auth_reversal");
    return { amountCents: reversed ? 0 : auth.amountCents, direction: auth.direction };
  }

  // Nothing but a reversal: a cross-boundary orphan. Show what it is.
  const primary = primaryRow(rows);
  return { amountCents: primary.amountCents, direction: primary.direction };
}

function byBookedThenId(a: QueueRow, b: QueueRow): number {
  return a.bookedAt !== b.bookedAt
    ? a.bookedAt.localeCompare(b.bookedAt)
    : a.id.localeCompare(b.id);
}

/**
 * Group rows into events, newest event first. Within an event, rows are ordered
 * oldest first for a stable expand view. `reviewState` is taken from the primary
 * row: confirm/ignore act on the whole group at once, so a group's rows never
 * disagree in practice, and the primary is the authority if a partial state is
 * ever encountered.
 */
export function projectEvents(rows: readonly QueueRow[]): QueueEvent[] {
  const groups = new Map<string, QueueRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.eventGroupId) ?? [];
    bucket.push(row);
    groups.set(row.eventGroupId, bucket);
  }

  const events: QueueEvent[] = [];
  for (const [eventGroupId, groupRows] of groups) {
    const sorted = [...groupRows].sort(byBookedThenId);
    const primary = primaryRow(sorted);
    const { amountCents, direction } = economicAmount(sorted);
    events.push({
      eventGroupId,
      state: primary.eventState,
      reviewState: primary.reviewState,
      bookedAt: primary.bookedAt,
      amountCents,
      direction,
      descriptionRaw: primary.descriptionRaw,
      merchant: primary.merchant,
      rail: primary.rail,
      categoryId: primary.categoryId,
      batchId: primary.batchId,
      note: primary.note,
      isAdjustment: primary.isAdjustment,
      rows: sorted,
    });
  }

  // Newest first, mirroring the ledger's default ordering (architecture.md).
  events.sort((a, b) =>
    a.bookedAt !== b.bookedAt
      ? b.bookedAt.localeCompare(a.bookedAt)
      : a.eventGroupId.localeCompare(b.eventGroupId),
  );
  return events;
}
