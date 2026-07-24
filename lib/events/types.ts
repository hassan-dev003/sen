import type { Direction } from "@/lib/sources/types";

export type EventRole =
  | "single"
  | "authorization"
  | "auth_reversal"
  | "settlement"
  | "settlement_reversal";

export type EventState = "resolved" | "pending" | "cancelled" | "orphan";

/**
 * The minimal, source-agnostic row the collapser needs. Any source maps its
 * parsed rows onto this shape; the collapser never learns which source it was
 * (docs/architecture.md).
 */
export interface CollapseInput {
  id: string;
  /** Booking date, YYYY-MM-DD. */
  bookedAt: string;
  /** Normalised merchant — the grouping key. */
  merchantKey: string;
  /** The classifying type/rail (first-line type). Null for uncategorisable rows. */
  type: string | null;
  /** Always positive. */
  amountCents: number;
  direction: Direction;
}

export interface CollapsedRow {
  id: string;
  eventGroupId: string;
  eventRole: EventRole;
}

export interface CollapsedEvent {
  eventGroupId: string;
  state: EventState;
  /** The economic amount: the settlement, or zero when it nets out. */
  amountCents: number;
  direction: Direction;
  /** Ids of every constituent row, retained and visible on expand. */
  rowIds: string[];
}

export interface CollapseResult {
  rows: CollapsedRow[];
  events: CollapsedEvent[];
}
