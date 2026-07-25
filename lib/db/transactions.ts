import type { SupabaseClient } from "@supabase/supabase-js";
import type { Direction } from "@/lib/sources/types";
import type { QueueRow, ReviewState } from "@/lib/events/queue";

const QUEUE_COLUMNS =
  "id, event_group_id, event_role, event_state, review_state, booked_at, amount_cents, direction, description_raw, merchant, rail, category_id, batch_id, note, is_adjustment";

type RawQueueRow = {
  id: string;
  event_group_id: string;
  event_role: QueueRow["eventRole"];
  event_state: QueueRow["eventState"];
  review_state: ReviewState;
  booked_at: string;
  amount_cents: number;
  direction: Direction;
  description_raw: string;
  merchant: string | null;
  rail: string | null;
  category_id: string | null;
  batch_id: string | null;
  note: string | null;
  is_adjustment: boolean;
};

function toQueueRow(r: RawQueueRow): QueueRow {
  return {
    id: r.id,
    eventGroupId: r.event_group_id,
    eventRole: r.event_role,
    eventState: r.event_state,
    reviewState: r.review_state,
    bookedAt: r.booked_at,
    amountCents: r.amount_cents,
    direction: r.direction,
    descriptionRaw: r.description_raw,
    merchant: r.merchant,
    rail: r.rail,
    categoryId: r.category_id,
    batchId: r.batch_id,
    note: r.note,
    isAdjustment: r.is_adjustment,
  };
}

/** Every draft row, for projection into reviewable events (lib/events/queue). */
export async function loadDraftRows(
  supabase: SupabaseClient,
): Promise<QueueRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select(QUEUE_COLUMNS)
    .eq("review_state", "draft")
    .order("booked_at", { ascending: false });
  if (error) throw new Error(`loadDraftRows: ${error.message}`);
  return ((data ?? []) as RawQueueRow[]).map(toQueueRow);
}

/** How many drafts remain — the number that should trend toward zero. */
export async function countDraftEvents(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("event_group_id")
    .eq("review_state", "draft");
  if (error) throw new Error(`countDraftEvents: ${error.message}`);
  return new Set((data ?? []).map((r: { event_group_id: string }) => r.event_group_id))
    .size;
}

/**
 * Confirm every draft row in the given event groups. Confirmation is the one
 * gate into the ledger (AGENTS.md #2); it acts on whole events, never single
 * rows, so an authorisation and its settlement move together. Only draft rows
 * are touched, so a re-fired confirm is harmless.
 */
export async function confirmEvents(
  supabase: SupabaseClient,
  eventGroupIds: string[],
): Promise<number> {
  if (eventGroupIds.length === 0) return 0;
  const { data, error } = await supabase
    .from("transactions")
    .update({ review_state: "confirmed", confirmed_at: new Date().toISOString() })
    .in("event_group_id", eventGroupIds)
    .eq("review_state", "draft")
    .select("event_group_id");
  if (error) throw new Error(`confirmEvents: ${error.message}`);
  return new Set((data ?? []).map((r: { event_group_id: string }) => r.event_group_id))
    .size;
}

/** Ignore events — rows that should never reach the ledger. Reversible. */
export async function ignoreEvents(
  supabase: SupabaseClient,
  eventGroupIds: string[],
): Promise<void> {
  if (eventGroupIds.length === 0) return;
  const { error } = await supabase
    .from("transactions")
    .update({ review_state: "ignored" })
    .in("event_group_id", eventGroupIds)
    .eq("review_state", "draft");
  if (error) throw new Error(`ignoreEvents: ${error.message}`);
}

/** Undo: return confirmed or ignored events to the draft queue. */
export async function revertEventsToDraft(
  supabase: SupabaseClient,
  eventGroupIds: string[],
): Promise<void> {
  if (eventGroupIds.length === 0) return;
  const { error } = await supabase
    .from("transactions")
    .update({ review_state: "draft", confirmed_at: null })
    .in("event_group_id", eventGroupIds)
    .neq("review_state", "draft");
  if (error) throw new Error(`revertEventsToDraft: ${error.message}`);
}

/**
 * Set the category on every row of a draft event. A manual override, so any
 * `applied_rule_id` is cleared — the rule no longer owns this draft. Rules
 * never touch confirmed rows (D7), so this is draft-only by construction.
 */
export async function setEventCategory(
  supabase: SupabaseClient,
  eventGroupId: string,
  categoryId: string,
): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId, applied_rule_id: null })
    .eq("event_group_id", eventGroupId)
    .eq("review_state", "draft");
  if (error) throw new Error(`setEventCategory: ${error.message}`);
}

export interface ManualEntryInput {
  userId: string;
  accountId: string;
  bookedAt: string;
  amountCents: number;
  direction: Direction;
  categoryId: string | null;
  note: string | null;
  description: string;
  isAdjustment?: boolean;
}

/**
 * Insert one already-confirmed transaction: a cash entry typed by hand, or an
 * adjustment closing a balance difference (D21). It is its own single-row event.
 * The dedupe hash is a unique sentinel — manual rows are never deduped against
 * imports — which still satisfies the `(user_id, dedupe_hash)` unique index.
 */
export async function insertManualEntry(
  supabase: SupabaseClient,
  input: ManualEntryInput,
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: input.userId,
      account_id: input.accountId,
      source: "manual",
      review_state: "confirmed",
      posting_state: "posted",
      booked_at: input.bookedAt,
      amount_cents: input.amountCents,
      direction: input.direction,
      description_raw: input.description,
      description_normalized: input.description.trim().toUpperCase(),
      merchant: null,
      category_id: input.categoryId,
      note: input.note,
      is_adjustment: input.isAdjustment ?? false,
      event_group_id: crypto.randomUUID(),
      event_role: "single",
      event_state: "resolved",
      dedupe_hash: `manual:${crypto.randomUUID()}`,
      confirmed_at: now,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertManualEntry: ${error.message}`);
  return (data as { id: string }).id;
}
