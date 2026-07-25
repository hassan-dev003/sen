import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/app/components/app-nav";
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
    <>
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Import report</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {batch.originalFilename ?? "capture.pdf"}
          </h1>
          <p className="text-sm text-muted">{batch.status}</p>
        </div>
        <Link href="/import" className="text-sm text-accent hover:underline">
          Back
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Rows parsed" value={String(batch.rowsParsed)} />
        <Stat label="Events" value={String(eventCount)} />
        <Stat label="New" value={String(batch.rowsInserted)} />
        <Stat label="Duplicate" value={String(batch.rowsDuplicate)} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">Balance</h2>
        {!batch.anchorReliable && (
          <p className="mt-2 text-sm text-muted">
            A non-zero float line made the printed balance unreliable, so the
            check is suppressed for this capture.
          </p>
        )}
        {openingConfirm && (
          <form action={confirmOpeningBalanceAction} className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-muted">
              This looks like the first import. Sen derived your opening balance
              on {openingConfirm.at}. Confirm or edit it — the balance check
              counts from here.
            </p>
            <input type="hidden" name="accountId" value={account!.id} />
            <input type="hidden" name="openingBalanceAt" value={openingConfirm.at} />
            <input type="hidden" name="batchId" value={batch.id} />
            <label className="text-xs text-muted">Opening balance (cents)</label>
            <input
              name="openingBalanceCents"
              type="number"
              defaultValue={openingConfirm.cents}
              className="tnum w-48 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-ink"
            />
            <p className="tnum text-xs text-faint">= {formatMYR(openingConfirm.cents)}</p>
            <button
              type="submit"
              className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
            >
              Confirm opening balance
            </button>
          </form>
        )}
        {verification && verification.applicable && (
          <p className="mt-2 flex items-center gap-2 text-sm">
            {verification.ok ? (
              <>
                <span aria-hidden className="size-2 rounded-full bg-credit" />
                <span>Your captures account for the balance exactly.</span>
              </>
            ) : (
              <>
                <span aria-hidden className="size-2 rounded-full bg-warning" />
                <span>
                  Off by{" "}
                  <span className="tnum font-medium">
                    {formatMYR(Math.abs(verification.differenceCents))}
                  </span>
                  . Widen the history window and re-import; dedupe absorbs the overlap.
                </span>
              </>
            )}
          </p>
        )}
      </section>

      {batch.status === "imported" && (
        <form action={rollbackAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <button
            type="submit"
            className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger-soft"
          >
            Roll back this import
          </button>
        </form>
      )}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="tnum text-2xl font-semibold">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
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
