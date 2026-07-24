/**
 * Database seed. Runs OUTSIDE any request path, so it is the one place the
 * service-role key is used (architecture.md#data-access, AGENTS.md #7).
 *
 * Creates, for the single owner (the user whose email is ALLOWED_EMAIL):
 *   - a bank account and a cash account (data-model.md, D12)
 *   - a minimal starting category set (data-model.md — the full taxonomy is the
 *     owner's to extend; product-spec.md open question)
 *
 * Idempotent: running it twice creates nothing new.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AccountKind = "bank" | "cash";
type CategoryKind = "expense" | "income" | "transfer";

const ACCOUNTS: Array<{ name: string; kind: AccountKind; institution?: string }> = [
  { name: "Maybank", kind: "bank", institution: "Maybank" },
  { name: "Cash", kind: "cash" },
];

// A deliberately small set. Correct beats complete (product-spec.md).
const CATEGORIES: Array<{ name: string; kind: CategoryKind; sort: number }> = [
  { name: "Food", kind: "expense", sort: 10 },
  { name: "Transport", kind: "expense", sort: 20 },
  { name: "Bills", kind: "expense", sort: 30 },
  { name: "Shopping", kind: "expense", sort: 40 },
  { name: "Health", kind: "expense", sort: 50 },
  { name: "Income", kind: "income", sort: 60 },
  { name: "Transfer", kind: "transfer", sort: 70 },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example.`);
  return value;
}

async function findOwnerId(
  admin: SupabaseClient,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers: ${error.message}`);
  const owner = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!owner) {
    throw new Error(
      `No user with email ${email}. Sign in once at the app so the account ` +
        `exists, then re-run the seed.`,
    );
  }
  return owner.id;
}

async function ensureAccount(
  admin: SupabaseClient,
  userId: string,
  account: (typeof ACCOUNTS)[number],
): Promise<void> {
  const { data, error } = await admin
    .from("accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", account.kind)
    .eq("name", account.name)
    .limit(1);
  if (error) throw new Error(`select accounts: ${error.message}`);
  if (data && data.length > 0) return;

  const insert = await admin.from("accounts").insert({
    user_id: userId,
    name: account.name,
    kind: account.kind,
    institution: account.institution ?? null,
  });
  if (insert.error) throw new Error(`insert account: ${insert.error.message}`);
}

async function ensureCategory(
  admin: SupabaseClient,
  userId: string,
  category: (typeof CATEGORIES)[number],
): Promise<void> {
  const { data, error } = await admin
    .from("categories")
    .select("id")
    .eq("user_id", userId)
    .eq("name", category.name)
    .is("parent_id", null)
    .limit(1);
  if (error) throw new Error(`select categories: ${error.message}`);
  if (data && data.length > 0) return;

  const insert = await admin.from("categories").insert({
    user_id: userId,
    name: category.name,
    kind: category.kind,
    sort_order: category.sort,
  });
  if (insert.error) throw new Error(`insert category: ${insert.error.message}`);
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const email = requireEnv("ALLOWED_EMAIL");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const userId = await findOwnerId(admin, email);

  for (const account of ACCOUNTS) {
    await ensureAccount(admin, userId, account);
  }
  for (const category of CATEGORIES) {
    await ensureCategory(admin, userId, category);
  }

  console.log(
    `Seed complete: ${ACCOUNTS.length} accounts, ${CATEGORIES.length} categories ensured.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
