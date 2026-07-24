import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The sprint (roadmap Sprint 1): authenticate as a second user and confirm zero
 * rows visible from the first, table by table.
 *
 * Every user-facing table is seeded for user A, then queried as user B. B must
 * see none of A's rows; A must see its own — otherwise a "0 rows for B" result
 * would be meaningless against an empty table. Runs against a live Supabase
 * stack; in CI that is a local `supabase start`.
 */

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

// Every table that holds user data. raw_rows and transaction_tags carry no
// user_id and are isolated through their parent's policy.
const TABLES = [
  "accounts",
  "categories",
  "import_batches",
  "raw_rows",
  "rules",
  "transactions",
  "tags",
  "transaction_tags",
  "budgets",
  "recurring_series",
] as const;

type Row = Record<string, unknown>;

async function insertOne(
  client: SupabaseClient,
  table: string,
  row: Row,
): Promise<Row> {
  const { data, error } = await client.from(table).insert(row).select().single();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return data as Row;
}

/** Seed one row in every table, owned (directly or via parent) by `userId`. */
async function seedAll(client: SupabaseClient, userId: string): Promise<void> {
  const account = await insertOne(client, "accounts", {
    user_id: userId,
    name: "Bank",
    kind: "bank",
  });
  const category = await insertOne(client, "categories", {
    user_id: userId,
    name: "Food",
    kind: "expense",
  });
  const batch = await insertOne(client, "import_batches", {
    user_id: userId,
    account_id: account.id,
    source: "m2u_history",
  });
  await insertOne(client, "raw_rows", {
    batch_id: batch.id,
    line_no: 1,
    raw_text: "MAE QR X 1",
    parsed: {},
  });
  await insertOne(client, "rules", {
    user_id: userId,
    match_value: "X",
  });
  const txn = await insertOne(client, "transactions", {
    user_id: userId,
    account_id: account.id,
    source: "m2u_history",
    booked_at: "2026-07-01",
    amount_cents: 100,
    direction: "debit",
    description_raw: "X",
    description_normalized: "X",
    dedupe_hash: `hash-${userId}`,
  });
  const tag = await insertOne(client, "tags", { user_id: userId, name: "t" });
  await insertOne(client, "transaction_tags", {
    transaction_id: txn.id,
    tag_id: tag.id,
  });
  await insertOne(client, "budgets", {
    user_id: userId,
    category_id: category.id,
    period_month: "2026-07-01",
    amount_cents: 1000,
  });
  await insertOne(client, "recurring_series", {
    user_id: userId,
    label: "Salary",
    match_value: "SALARY",
    cadence_days: 30,
    typical_amount_cents: 1000,
  });
}

describe.skipIf(!configured)("RLS isolation between two users", () => {
  const admin = createClient(url ?? "", serviceKey ?? "", {
    auth: { persistSession: false },
  });

  const stamp = Date.now();
  const emailA = `user-a-${stamp}@example.com`;
  const emailB = `user-b-${stamp}@example.com`;
  const password = "test-password-12345";

  let userAId = "";
  let userBId = "";
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  async function makeUser(email: string): Promise<[string, SupabaseClient]> {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`createUser: ${created.error?.message}`);
    }
    const client = createClient(url ?? "", anonKey ?? "", {
      auth: { persistSession: false },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
    return [created.data.user.id, client];
  }

  beforeAll(async () => {
    [userAId, clientA] = await makeUser(emailA);
    [userBId, clientB] = await makeUser(emailB);
    // Only A is seeded. B owns nothing.
    await seedAll(clientA, userAId);
  });

  afterAll(async () => {
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });

  for (const table of TABLES) {
    it(`${table}: user A sees its row, user B sees none`, async () => {
      const seenByA = await clientA.from(table).select("*");
      expect(seenByA.error, `A reading ${table}`).toBeNull();
      expect(
        (seenByA.data ?? []).length,
        `A should see its own ${table} rows`,
      ).toBeGreaterThan(0);

      const seenByB = await clientB.from(table).select("*");
      expect(seenByB.error, `B reading ${table}`).toBeNull();
      expect(
        seenByB.data ?? [],
        `B must not see A's ${table} rows`,
      ).toHaveLength(0);
    });
  }

  it("user B cannot write a row it does not own", async () => {
    // Forging user A's id in a write must be refused by the WITH CHECK clause.
    const forged = await clientB
      .from("accounts")
      .insert({ user_id: userAId, name: "Forged", kind: "bank" });
    expect(forged.error, "forged insert should be rejected").not.toBeNull();
  });
});
