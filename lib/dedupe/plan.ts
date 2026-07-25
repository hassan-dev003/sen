/**
 * Import planning. Pure: given a parsed capture and the relevant existing rows,
 * it decides what to insert, what to skip as a duplicate, and which earlier-batch
 * rows to regroup — without touching the database. The server action (lib/db)
 * applies the plan atomically.
 *
 * Idempotency is the whole point (docs/roadmap.md Sprint 3): re-importing the
 * same capture must insert zero rows and change nothing.
 */
import { collapseEvents } from "@/lib/events/collapse";
import type { CollapseInput, EventRole, EventState } from "@/lib/events/types";
import type { ParsedCapture } from "@/lib/sources/m2u-history/parse";
import type { Direction } from "@/lib/sources/types";
import { computeDedupeHash } from "./dedupe";

/** An existing transaction that could pair with incoming rows. */
export interface ExistingRow {
  id: string;
  merchantKey: string;
  rail: string | null;
  amountCents: number;
  direction: Direction;
  bookedAt: string;
  eventGroupId: string | null;
  eventRole: EventRole;
  eventState: EventState;
}

export interface PlannedRawRow {
  lineNo: number;
  rawText: string;
  parsed: Record<string, unknown>;
}

export interface PlannedTxn {
  rawLineNo: number;
  dedupeHash: string;
  bookedAt: string;
  amountCents: number;
  direction: Direction;
  descriptionRaw: string;
  descriptionNormalized: string;
  reference: string | null;
  merchant: string | null;
  merchantTruncated: boolean;
  rail: string | null;
  dayOccurrence: number;
  eventGroupId: string;
  eventRole: EventRole;
  eventState: EventState;
}

export interface Regroup {
  id: string;
  eventGroupId: string;
  eventRole: EventRole;
  eventState: EventState;
}

export interface ImportPlan {
  rawRows: PlannedRawRow[];
  newTxns: PlannedTxn[];
  regroups: Regroup[];
  report: {
    rowsParsed: number;
    rowsInserted: number;
    rowsDuplicate: number;
    eventsAfterCollapse: number;
  };
}

const NEW_PREFIX = "new:";

export function planImport(params: {
  accountId: string;
  capture: ParsedCapture;
  /** Every dedupe hash already stored for this account. */
  existingHashes: ReadonlySet<string>;
  /** Existing pending/orphan rows that could still regroup. */
  openRows: readonly ExistingRow[];
  /** Injected for deterministic tests; defaults to a UUID per group. */
  newGroupId?: () => string;
}): ImportPlan {
  const { accountId, capture, existingHashes, openRows } = params;
  const newGroupId = params.newGroupId ?? (() => crypto.randomUUID());

  // 1. Hash every parsed row and split genuinely-new from duplicate.
  const hashed = capture.rows.map((row) => ({
    row,
    dedupeHash: computeDedupeHash({
      accountId,
      bookedAt: row.bookedAt,
      descriptionNormalized: row.descriptionNormalized,
      direction: row.direction,
      amountCents: row.amountCents,
      rail: row.rail,
      dayOccurrence: row.dayOccurrence,
      normalizerVersion: capture.normalizerVersion,
    }),
  }));
  const fresh = hashed.filter((h) => !existingHashes.has(h.dedupeHash));
  const duplicateCount = hashed.length - fresh.length;

  // 2. Collapse over open existing rows plus the fresh rows. Duplicates are
  //    already represented by their DB rows, so they are left out.
  const freshById = new Map<string, (typeof fresh)[number]>();
  const inputs: CollapseInput[] = [];
  for (const existing of openRows) {
    inputs.push({
      id: existing.id,
      bookedAt: existing.bookedAt,
      merchantKey: existing.merchantKey,
      type: existing.rail,
      amountCents: existing.amountCents,
      direction: existing.direction,
    });
  }
  for (const h of fresh) {
    const id = `${NEW_PREFIX}${h.row.sourceLineNo}`;
    freshById.set(id, h);
    inputs.push({
      id,
      bookedAt: h.row.bookedAt,
      merchantKey: h.row.descriptionNormalized,
      type: h.row.rail,
      amountCents: h.row.amountCents,
      direction: h.row.direction,
    });
  }

  const collapsed = collapseEvents(inputs);
  const roleById = new Map(collapsed.rows.map((r) => [r.id, r.eventRole]));
  const stateByGroup = new Map(collapsed.events.map((e) => [e.eventGroupId, e.state]));
  const membersByGroup = new Map<string, string[]>();
  for (const r of collapsed.rows) {
    const bucket = membersByGroup.get(r.eventGroupId) ?? [];
    bucket.push(r.id);
    membersByGroup.set(r.eventGroupId, bucket);
  }

  // 3. A group is "active" only if it contains a fresh row — the missing half
  //    arrived. Groups made entirely of existing rows are left untouched, which
  //    is what keeps a re-import from churning event ids.
  const openById = new Map(openRows.map((o) => [o.id, o]));
  const uuidByGroup = new Map<string, string>();
  for (const [tempId, members] of membersByGroup) {
    if (members.some((m) => m.startsWith(NEW_PREFIX))) {
      uuidByGroup.set(tempId, newGroupId());
    }
  }

  // 4. Fresh rows insert with their group's uuid.
  const newTxns: PlannedTxn[] = [];
  const rawRows: PlannedRawRow[] = [];
  for (const r of collapsed.rows) {
    if (!r.id.startsWith(NEW_PREFIX)) continue;
    const h = freshById.get(r.id)!;
    const row = h.row;
    const eventGroupId = uuidByGroup.get(r.eventGroupId)!;
    newTxns.push({
      rawLineNo: row.sourceLineNo,
      dedupeHash: h.dedupeHash,
      bookedAt: row.bookedAt,
      amountCents: row.amountCents,
      direction: row.direction,
      descriptionRaw: row.descriptionRaw,
      descriptionNormalized: row.descriptionNormalized,
      reference: null,
      merchant: row.merchant,
      merchantTruncated: row.merchantTruncated,
      rail: row.rail,
      dayOccurrence: row.dayOccurrence,
      eventGroupId,
      eventRole: r.eventRole,
      eventState: stateByGroup.get(r.eventGroupId)!,
    });
    rawRows.push({
      lineNo: row.sourceLineNo,
      rawText: [row.descriptionRaw, row.bookedAt, String(row.amountCents)].join("\n"),
      parsed: { ...row },
    });
  }

  // 5. Existing rows in an active group regroup onto its uuid.
  const regroups: Regroup[] = [];
  for (const r of collapsed.rows) {
    if (r.id.startsWith(NEW_PREFIX)) continue;
    const uuid = uuidByGroup.get(r.eventGroupId);
    if (!uuid) continue; // group had no fresh row — leave it alone
    const existing = openById.get(r.id)!;
    regroups.push({
      id: existing.id,
      eventGroupId: uuid,
      eventRole: roleById.get(r.id)!,
      eventState: stateByGroup.get(r.eventGroupId)!,
    });
  }

  return {
    rawRows,
    newTxns,
    regroups,
    report: {
      rowsParsed: capture.rows.length,
      rowsInserted: newTxns.length,
      rowsDuplicate: duplicateCount,
      eventsAfterCollapse: uuidByGroup.size,
    },
  };
}
