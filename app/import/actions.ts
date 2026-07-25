"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extract, RasterisedCaptureError } from "@/lib/sources/m2u-history/extract";
import { parse } from "@/lib/sources/m2u-history/parse";
import { planImport } from "@/lib/dedupe/plan";
import { getPrimaryBankAccount, setOpeningBalance } from "@/lib/db/accounts";
import { applyImport, loadExistingHashes, loadOpenRows } from "@/lib/db/import";
import { rollbackBatch } from "@/lib/db/batches";

export type ImportState = { status: "idle" | "error"; message?: string };

function minMax(dates: string[]): { start: string | null; end: string | null } {
  if (dates.length === 0) return { start: null, end: null };
  let start = dates[0]!;
  let end = dates[0]!;
  for (const d of dates) {
    if (d < start) start = d;
    if (d > end) end = d;
  }
  return { start, end };
}

export async function importCapture(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a PDF to import." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not signed in." };

  const account = await getPrimaryBankAccount(supabase);
  if (!account) {
    return { status: "error", message: "No bank account found. Run the seed first." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let lines: string[];
  try {
    lines = await extract(bytes);
  } catch (err) {
    if (err instanceof RasterisedCaptureError) {
      return { status: "error", message: err.message };
    }
    throw err;
  }

  const capture = parse(lines);
  if (capture.rows.length === 0) {
    return { status: "error", message: "No transactions found in that PDF." };
  }

  // Store the capture, then apply. Path is per-user so RLS confines it.
  const storagePath = `${user.id}/${randomUUID()}.pdf`;
  const upload = await supabase.storage
    .from("captures")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) {
    return { status: "error", message: `Upload failed: ${upload.error.message}` };
  }

  const [existingHashes, openRows] = await Promise.all([
    loadExistingHashes(supabase, account.id),
    loadOpenRows(supabase, account.id),
  ]);

  const plan = planImport({
    accountId: account.id,
    capture,
    existingHashes,
    openRows,
    newGroupId: () => randomUUID(),
  });

  const period = minMax(capture.rows.map((r) => r.bookedAt));
  const result = await applyImport(supabase, {
    accountId: account.id,
    storagePath,
    filename: file.name,
    periodStart: period.start,
    periodEnd: period.end,
    balanceAnchorCents: capture.balanceAnchorCents,
    anchorReliable: capture.anchorReliable,
    plan,
  });

  redirect(`/import/${result.batchId}`);
}

export async function rollbackAction(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) return;
  const supabase = await createClient();
  await rollbackBatch(supabase, batchId);
  revalidatePath("/import");
  redirect("/import");
}

export async function confirmOpeningBalanceAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get("accountId") ?? "");
  const cents = Number(formData.get("openingBalanceCents"));
  const at = String(formData.get("openingBalanceAt") ?? "");
  const batchId = String(formData.get("batchId") ?? "");
  if (!accountId || !at || !Number.isInteger(cents)) return;
  const supabase = await createClient();
  await setOpeningBalance(supabase, accountId, cents, at);
  revalidatePath(`/import/${batchId}`);
  redirect(`/import/${batchId}`);
}
