import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extract } from "@/lib/sources/m2u-history/extract";
import { parse, type ParsedCapture } from "@/lib/sources/m2u-history/parse";
import { planImport } from "@/lib/dedupe/plan";
import { applyImport, loadExistingHashes, loadOpenRows } from "@/lib/db/import";
import { rollbackBatch } from "@/lib/db/batches";

/**
 * The sprint's key test (roadmap Sprint 3): importing the same capture twice
 * inserts zero rows. Plus cross-batch regrouping and rollback, exercised against
 * a real Postgres so the atomic RPC and the dedupe unique constraint are real.
 */

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

const FIXTURES = join(process.cwd(), "tests", "fixtures", "history");

async function doImport(client: SupabaseClient, accountId: string, capture: ParsedCapture) {
  const [existingHashes, openRows] = await Promise.all([
    loadExistingHashes(client, accountId),
    loadOpenRows(client, accountId),
  ]);
  const plan = planImport({ accountId, capture, existingHashes, openRows });
  return applyImport(client, {
    accountId,
    storagePath: `test/${crypto.randomUUID()}.pdf`,
    filename: "capture.pdf",
    periodStart: null,
    periodEnd: null,
    balanceAnchorCents: capture.balanceAnchorCents,
    anchorReliable: capture.anchorReliable,
    plan,
  });
}

describe.skipIf(!configured)("import pipeline (atomic)", () => {
  const admin = createClient(url ?? "", serviceKey ?? "", { auth: { persistSession: false } });
  const email = `import-${Date.now()}@example.com`;
  const password = "test-password-12345";
  let userId = "";
  let accountId = "";
  let client: SupabaseClient;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
    userId = created.data.user.id;

    client = createClient(url ?? "", anonKey ?? "", { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);

    const account = await client
      .from("accounts")
      .insert({ user_id: userId, name: "Bank", kind: "bank" })
      .select("id")
      .single();
    if (account.error) throw new Error(`account: ${account.error.message}`);
    accountId = account.data.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("inserts every row once, and zero rows on a re-import", async () => {
    // full pipeline: PDF bytes -> extract -> parse -> import
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "text-layer.pdf")));
    const capture = parse(await extract(bytes));

    const first = await doImport(client, accountId, capture);
    expect(first.rowsInserted).toBe(10);
    expect(first.rowsDuplicate).toBe(0);

    const second = await doImport(client, accountId, capture);
    expect(second.rowsInserted).toBe(0);
    expect(second.rowsDuplicate).toBe(10);

    const count = await client
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId);
    expect(count.count).toBe(10);
  });

  it("regroups an earlier pending authorisation when its reversal arrives later", async () => {
    // fresh account so the clean-print rows above don't interfere
    const acc = await client
      .from("accounts")
      .insert({ user_id: userId, name: "Bank2", kind: "bank" })
      .select("id")
      .single();
    const acc2 = acc.data!.id;

    const auth = parse([
      "PRE-AUTH MYDEBIT PETRON SIMPANG AMPA* QR1",
      "22 Jul 2026",
      "- RM 50.00",
    ]);
    await doImport(client, acc2, auth);

    const afterAuth = await client
      .from("transactions")
      .select("event_state")
      .eq("account_id", acc2);
    expect(afterAuth.data).toHaveLength(1);
    expect(afterAuth.data![0]!.event_state).toBe("pending");

    const reversal = parse([
      "REV PREAUTH MYDEBIT PETRON SIMPANG AMPA* QR2",
      "22 Jul 2026",
      "RM 50.00",
    ]);
    const res = await doImport(client, acc2, reversal);
    expect(res.rowsInserted).toBe(1);

    const rows = await client
      .from("transactions")
      .select("event_state, event_group_id, event_role")
      .eq("account_id", acc2);
    expect(rows.data).toHaveLength(2);
    // both rows now cancelled and in the same event group
    expect(rows.data!.every((r) => r.event_state === "cancelled")).toBe(true);
    expect(new Set(rows.data!.map((r) => r.event_group_id)).size).toBe(1);
  });

  it("rolls a batch back, deleting its rows", async () => {
    const acc = await client
      .from("accounts")
      .insert({ user_id: userId, name: "Bank3", kind: "bank" })
      .select("id")
      .single();
    const acc3 = acc.data!.id;

    const capture = parse([
      "MAE QR HANI STORE * QR9",
      "24 Jul 2026",
      "- RM 9.90",
    ]);
    const res = await doImport(client, acc3, capture);
    expect(res.rowsInserted).toBe(1);

    await rollbackBatch(client, res.batchId);

    const rows = await client.from("transactions").select("id").eq("account_id", acc3);
    expect(rows.data).toHaveLength(0);
  });
});
