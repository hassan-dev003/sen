import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sen</h1>
          <p className="text-sm opacity-70">
            Signed in as {user?.email ?? "unknown"}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-black/10 p-6 dark:border-white/10">
        <h2 className="text-lg font-medium">Nothing here yet</h2>
        <p className="mt-2 text-sm opacity-70">
          This is the authenticated shell. Import, review, ledger, budgets, and
          settings arrive in later sprints.
        </p>
      </section>
    </main>
  );
}
