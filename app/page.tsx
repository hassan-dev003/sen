import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/app/components/app-nav";
import { countDraftEvents } from "@/lib/db/transactions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let draftCount = 0;
  try {
    draftCount = await countDraftEvents(supabase);
  } catch {
    draftCount = 0;
  }

  return (
    <>
      <AppNav email={user?.email} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10">
        <header className="flex flex-col gap-1">
          <p className="eyebrow">Sen</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {draftCount > 0
              ? `${draftCount} ${draftCount === 1 ? "event" : "events"} waiting`
              : "All caught up"}
          </h1>
          <p className="text-sm text-muted">
            Machines type, humans confirm. Import a capture, then clear the queue.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/review"
            className="group flex flex-col gap-1 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent"
          >
            <span className="text-sm font-medium">Review queue</span>
            <span className="text-sm text-muted">
              {draftCount > 0
                ? `${draftCount} draft ${draftCount === 1 ? "event" : "events"} to confirm`
                : "Nothing to review right now"}
            </span>
            <span className="mt-2 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
              Open →
            </span>
          </Link>

          <Link
            href="/import"
            className="group flex flex-col gap-1 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent"
          >
            <span className="text-sm font-medium">Import a capture</span>
            <span className="text-sm text-muted">
              Print the M2U history to PDF, then drop it in
            </span>
            <span className="mt-2 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
              Open →
            </span>
          </Link>
        </div>
      </main>
    </>
  );
}
