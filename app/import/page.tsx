import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listRecentBatches } from "@/lib/db/batches";
import { formatMYR } from "@/lib/money";
import { UploadForm } from "./upload-form";

export default async function ImportPage() {
  const supabase = await createClient();
  const batches = await listRecentBatches(supabase);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import</h1>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </header>

      <section className="rounded-lg border border-black/10 p-6 dark:border-white/10">
        <h2 className="text-lg font-medium">Import a capture</h2>
        <p className="mb-4 mt-1 text-sm opacity-70">
          Print the M2U transaction history to PDF (the browser&rsquo;s own Save
          as PDF), then drop it here.
        </p>
        <UploadForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Recent imports</h2>
        {batches.length === 0 ? (
          <p className="text-sm opacity-70">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-3">
                <div className="text-sm">
                  <Link href={`/import/${b.id}`} className="font-medium underline">
                    {b.originalFilename ?? "capture.pdf"}
                  </Link>
                  <span className="ml-2 opacity-60">
                    {b.status} · {b.rowsInserted} new / {b.rowsDuplicate} dup
                  </span>
                </div>
                <span className="text-sm opacity-60">
                  {b.balanceAnchorCents !== null ? formatMYR(b.balanceAnchorCents) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
