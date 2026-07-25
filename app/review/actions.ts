"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseMYR } from "@/lib/money";
import { todayIso } from "@/lib/ui/format";
import {
  getCashAccount,
  getPrimaryBankAccount,
  sumSignedOnAfter,
} from "@/lib/db/accounts";
import { getLatestReliableAnchor } from "@/lib/db/batches";
import { getUnaccountedCategory } from "@/lib/db/categories";
import { verifyBalance } from "@/lib/dedupe/balance";
import {
  confirmEvents,
  ignoreEvents,
  insertManualEntry,
  revertEventsToDraft,
  setEventCategory,
} from "@/lib/db/transactions";
import type { Direction } from "@/lib/sources/types";

export async function confirmEventsAction(eventGroupIds: string[]): Promise<void> {
  const supabase = await createClient();
  await confirmEvents(supabase, eventGroupIds);
  revalidatePath("/review");
}

export async function ignoreEventsAction(eventGroupIds: string[]): Promise<void> {
  const supabase = await createClient();
  await ignoreEvents(supabase, eventGroupIds);
  revalidatePath("/review");
}

export async function revertEventsAction(eventGroupIds: string[]): Promise<void> {
  const supabase = await createClient();
  await revertEventsToDraft(supabase, eventGroupIds);
  revalidatePath("/review");
}

export async function setCategoryAction(
  eventGroupId: string,
  categoryId: string,
): Promise<void> {
  const supabase = await createClient();
  await setEventCategory(supabase, eventGroupId, categoryId);
  revalidatePath("/review");
}

export type ManualEntryState = { status: "idle" | "error" | "ok"; message?: string };

/** Type in a cash purchase. Lands confirmed — the owner is the authority. */
export async function addManualEntryAction(
  _prev: ManualEntryState,
  formData: FormData,
): Promise<ManualEntryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not signed in." };

  const account = await getCashAccount(supabase);
  if (!account) {
    return { status: "error", message: "No cash account found. Run the seed first." };
  }

  const bookedAt = String(formData.get("bookedAt") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookedAt)) {
    return { status: "error", message: "Choose a valid date." };
  }

  let amountCents: number;
  try {
    amountCents = parseMYR(String(formData.get("amount") ?? ""));
  } catch {
    return { status: "error", message: "Enter an amount like 12.50." };
  }
  if (amountCents <= 0) {
    return { status: "error", message: "Amount must be more than zero." };
  }

  const direction: Direction =
    String(formData.get("direction")) === "credit" ? "credit" : "debit";
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const description = note ?? "Cash entry";

  await insertManualEntry(supabase, {
    userId: user.id,
    accountId: account.id,
    bookedAt,
    amountCents,
    direction,
    categoryId,
    note,
    description,
  });
  revalidatePath("/review");
  return { status: "ok" };
}

export type AdjustmentState = { status: "idle" | "error" | "ok"; message?: string };

/**
 * Post an adjustment for a balance difference that survived a wider re-import
 * (D21). The difference is recomputed from the ledger here, never trusted from
 * the client — the owner confirms the action, Sen supplies the figure. It lands
 * in `Unaccounted`, flagged `is_adjustment`, and counts in charts.
 */
export async function postAdjustmentAction(
  _prev: AdjustmentState,
  _formData: FormData,
): Promise<AdjustmentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not signed in." };

  const [account, anchorCents, unaccounted] = await Promise.all([
    getPrimaryBankAccount(supabase),
    getLatestReliableAnchor(supabase),
    getUnaccountedCategory(supabase),
  ]);
  if (!account) return { status: "error", message: "No bank account found." };
  if (!unaccounted) {
    return { status: "error", message: "No Unaccounted category found. Run the seed." };
  }

  const sum = account.openingBalanceAt
    ? await sumSignedOnAfter(supabase, account.id, account.openingBalanceAt)
    : 0;
  const verification = verifyBalance({
    openingBalanceCents: account.openingBalanceCents,
    openingBalanceAt: account.openingBalanceAt,
    sumSignedOnAfterCents: sum,
    anchorCents,
    anchorReliable: anchorCents !== null,
  });

  if (!verification.applicable) {
    return { status: "error", message: "No reliable balance to reconcile against yet." };
  }
  if (verification.differenceCents === 0) {
    return { status: "error", message: "Nothing to adjust — the balance already verifies." };
  }

  // signed(adjustment) must equal the difference so the check closes to zero.
  const diff = verification.differenceCents;
  await insertManualEntry(supabase, {
    userId: user.id,
    accountId: account.id,
    bookedAt: todayIso(),
    amountCents: Math.abs(diff),
    direction: diff > 0 ? "credit" : "debit",
    categoryId: unaccounted.id,
    note: "Balance adjustment",
    description: "Balance adjustment",
    isAdjustment: true,
  });
  revalidatePath("/review");
  return { status: "ok" };
}
