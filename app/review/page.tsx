import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/app/components/app-nav";
import { getPrimaryBankAccount, sumSignedOnAfter } from "@/lib/db/accounts";
import { getLatestReliableAnchor } from "@/lib/db/batches";
import { listCategories } from "@/lib/db/categories";
import { loadDraftRows } from "@/lib/db/transactions";
import { projectEvents } from "@/lib/events/queue";
import { verifyBalance } from "@/lib/dedupe/balance";
import { ReviewQueue, type CategoryOption } from "./review-queue";
import { ManualEntry } from "./manual-entry";
import { BalanceBanner, type BalanceStatus } from "./balance-banner";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [account, categories, draftRows, anchorCents] = await Promise.all([
    getPrimaryBankAccount(supabase),
    listCategories(supabase),
    loadDraftRows(supabase),
    getLatestReliableAnchor(supabase),
  ]);

  const events = projectEvents(draftRows);
  const categoryOptions: CategoryOption[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
  }));

  let balance: BalanceStatus = { applicable: false, ok: false, differenceCents: 0 };
  if (account) {
    const sum = account.openingBalanceAt
      ? await sumSignedOnAfter(supabase, account.id, account.openingBalanceAt)
      : 0;
    const v = verifyBalance({
      openingBalanceCents: account.openingBalanceCents,
      openingBalanceAt: account.openingBalanceAt,
      sumSignedOnAfterCents: sum,
      anchorCents,
      anchorReliable: anchorCents !== null,
    });
    balance = {
      applicable: v.applicable,
      ok: v.ok,
      differenceCents: v.differenceCents,
    };
  }

  return (
    <>
      <AppNav email={user?.email} />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
        <header className="flex flex-col gap-1">
          <p className="eyebrow">Review</p>
          <h1 className="text-2xl font-semibold tracking-tight">Draft queue</h1>
          <p className="text-sm text-muted">
            Machines typed these. Confirm, categorise, or ignore. Nothing enters the
            ledger until you say so.
          </p>
        </header>

        <BalanceBanner status={balance} />

        <ManualEntry categories={categoryOptions} />

        <ReviewQueue initialEvents={events} categories={categoryOptions} />
      </main>
    </>
  );
}
