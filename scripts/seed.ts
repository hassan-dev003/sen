/**
 * Database seed. Runs OUTSIDE any request path, so it is the one place the
 * service-role key is used (architecture.md#data-access, AGENTS.md #7).
 *
 * Sprint 0: a placeholder that verifies the service-role connection works.
 * Sprint 1 fills this in — a bank account, a cash account, and a minimal
 * category set (data-model.md).
 */
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. See .env.example.`);
  }
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
  if (error) {
    throw new Error(`Service-role connection failed: ${error.message}`);
  }

  console.log("Seed: service-role connection OK. Nothing to seed yet (Sprint 0).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
