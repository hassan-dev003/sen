import type { SupabaseClient } from "@supabase/supabase-js";
import { signedCents } from "@/lib/money";
import type { Direction } from "@/lib/sources/types";

export interface Account {
  id: string;
  name: string;
  kind: "bank" | "cash";
  openingBalanceCents: number | null;
  openingBalanceAt: string | null;
}

/** The single bank account. Sen imports into exactly one (product-spec.md). */
export async function getPrimaryBankAccount(
  supabase: SupabaseClient,
): Promise<Account | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, kind, opening_balance_cents, opening_balance_at")
    .eq("kind", "bank")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getPrimaryBankAccount: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    kind: data.kind,
    openingBalanceCents: data.opening_balance_cents,
    openingBalanceAt: data.opening_balance_at,
  };
}

export async function setOpeningBalance(
  supabase: SupabaseClient,
  accountId: string,
  openingBalanceCents: number,
  openingBalanceAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("accounts")
    .update({
      opening_balance_cents: openingBalanceCents,
      opening_balance_at: openingBalanceAt,
    })
    .eq("id", accountId);
  if (error) throw new Error(`setOpeningBalance: ${error.message}`);
}

/**
 * Signed sum of all transactions booked on or after `fromDate`, for balance
 * verification. Reconstructs from rows, not events (AGENTS.md #8).
 */
export async function sumSignedOnAfter(
  supabase: SupabaseClient,
  accountId: string,
  fromDate: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount_cents, direction")
    .eq("account_id", accountId)
    .gte("booked_at", fromDate);
  if (error) throw new Error(`sumSignedOnAfter: ${error.message}`);
  const rows = (data ?? []) as Array<{ amount_cents: number; direction: Direction }>;
  return rows.reduce((sum, r) => sum + signedCents(r.amount_cents, r.direction), 0);
}
