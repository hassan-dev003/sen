import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/app/components/app-nav";
import { listRecentBatches } from "@/lib/db/batches";
import { formatMYR } from "@/lib/money";
import { formatFullDate } from "@/lib/ui/format";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const batches = await listRecentBatches(supabase);

  return (
    <>
      <AppNav email={user?.email} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
        <header className="flex flex-col gap-1">
          <p className="eyebrow">Import</p>
          <h1 className="text-2xl font-semibold tracking-tight">Import a capture</h1>
          <p className="text-sm text-muted">
            Print the M2U transaction history to PDF — the browser&rsquo;s own
            &ldquo;Save as PDF&rdquo;, not &ldquo;Microsoft Print to PDF&rdquo; — then drop it here.
          </p>
        </header>

        <section className="rounded-xl border border-border bg-surface p-5">
          <UploadForm />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Recent imports</h2>
          {batches.length === 0 ? (
            <p className="text-sm text-muted">No imports yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/import/${b.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {b.originalFilename ?? "capture.pdf"}
                      </span>
                      <span className="text-xs text-muted">
                        {formatFullDate(b.createdAt.slice(0, 10))} · {b.status} ·{" "}
                        <span className="tnum">{b.rowsInserted}</span> new /{" "}
                        <span className="tnum">{b.rowsDuplicate}</span> dup
                      </span>
                    </div>
                    <span className="tnum shrink-0 text-sm text-muted">
                      {b.balanceAnchorCents !== null ? formatMYR(b.balanceAnchorCents) : "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
