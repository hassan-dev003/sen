import type { SupabaseClient } from "@supabase/supabase-js";
import type { Direction } from "@/lib/sources/types";

export interface Batch {
  id: string;
  accountId: string;
  status: string;
  originalFilename: string | null;
  rowsParsed: number;
  rowsInserted: number;
  rowsDuplicate: number;
  balanceAnchorCents: number | null;
  anchorReliable: boolean | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

const COLUMNS =
  "id, account_id, status, original_filename, rows_parsed, rows_inserted, rows_duplicate, balance_anchor_cents, anchor_reliable, period_start, period_end, created_at";

type Raw = {
  id: string;
  account_id: string;
  status: string;
  original_filename: string | null;
  rows_parsed: number;
  rows_inserted: number;
  rows_duplicate: number;
  balance_anchor_cents: number | null;
  anchor_reliable: boolean | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
};

function toBatch(r: Raw): Batch {
  return {
    id: r.id,
    accountId: r.account_id,
    status: r.status,
    originalFilename: r.original_filename,
    rowsParsed: r.rows_parsed,
    rowsInserted: r.rows_inserted,
    rowsDuplicate: r.rows_duplicate,
    balanceAnchorCents: r.balance_anchor_cents,
    anchorReliable: r.anchor_reliable,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    createdAt: r.created_at,
  };
}

export async function getBatch(
  supabase: SupabaseClient,
  batchId: string,
): Promise<Batch | null> {
  const { data, error } = await supabase
    .from("import_batches")
    .select(COLUMNS)
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(`getBatch: ${error.message}`);
  return data ? toBatch(data as Raw) : null;
}

export async function listRecentBatches(
  supabase: SupabaseClient,
  limit = 10,
): Promise<Batch[]> {
  const { data, error } = await supabase
    .from("import_batches")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentBatches: ${error.message}`);
  return ((data ?? []) as Raw[]).map(toBatch);
}

/** Rows of one batch, for deriving the opening balance from a first import. */
export async function loadBatchRows(
  supabase: SupabaseClient,
  batchId: string,
): Promise<Array<{ amountCents: number; direction: Direction; bookedAt: string }>> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount_cents, direction, booked_at")
    .eq("batch_id", batchId);
  if (error) throw new Error(`loadBatchRows: ${error.message}`);
  return ((data ?? []) as Array<{ amount_cents: number; direction: Direction; booked_at: string }>).map(
    (r) => ({ amountCents: r.amount_cents, direction: r.direction, bookedAt: r.booked_at }),
  );
}

/** Distinct events among a batch's own rows (after collapse). */
export async function countBatchEvents(
  supabase: SupabaseClient,
  batchId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("event_group_id")
    .eq("batch_id", batchId);
  if (error) throw new Error(`countBatchEvents: ${error.message}`);
  const groups = new Set(
    (data ?? []).map((r: { event_group_id: string | null }) => r.event_group_id),
  );
  return groups.size;
}

export async function rollbackBatch(
  supabase: SupabaseClient,
  batchId: string,
): Promise<void> {
  const { error } = await supabase.rpc("rollback_import_batch", {
    p_batch_id: batchId,
  });
  if (error) throw new Error(`rollback_import_batch: ${error.message}`);
}
