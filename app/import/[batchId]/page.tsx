import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { countBatchEvents, getBatch, loadBatchRows } from "@/lib/db/batches";
import { getPrimaryBankAccount, sumSignedOnAfter } from "@/lib/db/accounts";
import { deriveOpeningBalance, verifyBalance, type Verification } from "@/lib/dedupe/balance";
import { formatMYR } from "@/lib/money";
import { confirmOpeningBalanceAction, rollbackAction } from "../actions";

export default async function BatchReportPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const supabase = await createClient();

  const batch = await getBatch(supabase, batchId);
  if (!batch) notFound();

  const [account, eventCount] = await Promise.all([
    getPrimaryBankAccount(supabase),
    countBatchEvents(supabase, batchId),
  ]);

  // Balance section: either confirm a derived opening balance, or show the check.
  let openingConfirm: { cents: number; at: string } | null = null;
  let verification: Verification | null = null;
  if (account && account.openingBalanceCents === null) {
    const rows = await loadBatchRows(supabase, batchId);
    const derived = deriveOpeningBalance({
      rows,
      balanceAnchorCents: batch.balanceAnchorCents,
      anchorReliable: batch.anchorReliable ?? false,
    });
    if (derived) {
      openingConfirm = { cents: derived.openingBalanceCents, at: derived.openingBalanceAt };
    }
  } else if (account) {
    verification = await buildVerification(supabase, account, batch);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Import report</h1>
          <p className="text-sm opacity-70">
            {batch.originalFilename ?? "capture.pdf"} · {batch.status}
          </p>
        </div>
        <Link href="/import" className="text-sm underline">
          Back
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Rows parsed" value={String(batch.rowsParsed)} />
        <Stat label="Events" value={String(eventCount)} />
        <Stat label="New" value={String(batch.rowsInserted)} />
        <Stat label="Duplicate" value={String(batch.rowsDuplicate)} />
      </section>

      <section className="rounded-lg border border-black/10 p-6 dark:border-white/10">
        <h2 className="text-lg font-medium">Balance</h2>
        {!batch.anchorReliable && (
          <p className="mt-2 text-sm opacity-70">
            A non-zero float line made the printed balance unreliable, so the
            check is suppressed for this capture.
          </p>
        )}
        {openingConfirm && (
          <form action={confirmOpeningBalanceAction} className="mt-3 flex flex-col gap-3">
            <p className="text-sm opacity-70">
              This looks like the first import. Sen derived your opening balance
              on {openingConfirm.at}. Confirm or edit it — the balance check
              counts from here.
            </p>
            <input type="hidden" name="accountId" value={account!.id} />
            <input type="hidden" name="openingBalanceAt" value={openingConfirm.at} />
            <input type="hidden" name="batchId" value={batch.id} />
            <label className="text-sm font-medium">Opening balance (cents)</label>
            <input
              name="openingBalanceCents"
              type="number"
              defaultValue={openingConfirm.cents}
              className="w-48 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            />
            <p className="text-xs opacity-60">= {formatMYR(openingConfirm.cents)}</p>
            <button
              type="submit"
              className="w-fit rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
            >
              Confirm opening balance
            </button>
          </form>
        )}
        {verification && verification.applicable && (
          <p className="mt-2 text-sm">
            {verification.ok ? (
              <span className="text-green-600">
                Your captures account for the balance exactly.
              </span>
            ) : (
              <span className="text-amber-600">
                Off by {formatMYR(Math.abs(verification.differenceCents))}. Widen
                the history window and re-import; dedupe absorbs the overlap.
              </span>
            )}
          </p>
        )}
      </section>

      {batch.status === "imported" && (
        <form action={rollbackAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <button
            type="submit"
            className="rounded-md border border-red-600/40 px-3 py-2 text-sm text-red-600"
          >
            Roll back this import
          </button>
        </form>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs opacity-60">{label}</div>
    </div>
  );
}

async function buildVerification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  account: NonNullable<Awaited<ReturnType<typeof getPrimaryBankAccount>>>,
  batch: NonNullable<Awaited<ReturnType<typeof getBatch>>>,
) {
  const sum = account.openingBalanceAt
    ? await sumSignedOnAfter(supabase, account.id, account.openingBalanceAt)
    : 0;
  return verifyBalance({
    openingBalanceCents: account.openingBalanceCents,
    openingBalanceAt: account.openingBalanceAt,
    sumSignedOnAfterCents: sum,
    anchorCents: batch.balanceAnchorCents,
    anchorReliable: batch.anchorReliable ?? false,
  });
}
