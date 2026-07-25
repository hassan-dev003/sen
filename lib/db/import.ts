import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingRow, ImportPlan } from "@/lib/dedupe/plan";
import type { EventRole, EventState } from "@/lib/events/types";
import type { Direction } from "@/lib/sources/types";

/** Every dedupe hash already stored for an account (for duplicate detection). */
export async function loadExistingHashes(
  supabase: SupabaseClient,
  accountId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("transactions")
    .select("dedupe_hash")
    .eq("account_id", accountId);
  if (error) throw new Error(`loadExistingHashes: ${error.message}`);
  return new Set((data ?? []).map((r: { dedupe_hash: string }) => r.dedupe_hash));
}

/** Rows that could still regroup: pending/orphan and not yet confirmed. */
export async function loadOpenRows(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ExistingRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, description_normalized, rail, amount_cents, direction, booked_at, event_group_id, event_role, event_state",
    )
    .eq("account_id", accountId)
    .in("event_state", ["pending", "orphan"])
    .neq("review_state", "confirmed");
  if (error) throw new Error(`loadOpenRows: ${error.message}`);
  type Raw = {
    id: string;
    description_normalized: string;
    rail: string | null;
    amount_cents: number;
    direction: Direction;
    booked_at: string;
    event_group_id: string | null;
    event_role: EventRole;
    event_state: EventState;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    merchantKey: r.description_normalized,
    rail: r.rail,
    amountCents: r.amount_cents,
    direction: r.direction,
    bookedAt: r.booked_at,
    eventGroupId: r.event_group_id,
    eventRole: r.event_role,
    eventState: r.event_state,
  }));
}

export interface ImportRpcResult {
  batchId: string;
  rowsParsed: number;
  rowsInserted: number;
  rowsDuplicate: number;
}

/** Apply the plan atomically through the import_m2u_batch function. */
export async function applyImport(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    storagePath: string;
    filename: string;
    periodStart: string | null;
    periodEnd: string | null;
    balanceAnchorCents: number | null;
    anchorReliable: boolean;
    plan: ImportPlan;
  },
): Promise<ImportRpcResult> {
  const { data, error } = await supabase.rpc("import_m2u_batch", {
    p_account_id: params.accountId,
    p_storage_path: params.storagePath,
    p_filename: params.filename,
    p_period_start: params.periodStart,
    p_period_end: params.periodEnd,
    p_balance_anchor_cents: params.balanceAnchorCents,
    p_anchor_reliable: params.anchorReliable,
    p_rows_parsed: params.plan.report.rowsParsed,
    p_raw_rows: params.plan.rawRows,
    p_txns: params.plan.newTxns,
    p_regroups: params.plan.regroups,
  });
  if (error) throw new Error(`import_m2u_batch: ${error.message}`);
  return data as ImportRpcResult;
}
