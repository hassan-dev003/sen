/**
 * Central, framework-free access to environment variables.
 *
 * Public values (safe to reach the client) are prefixed `NEXT_PUBLIC_`.
 * Server-only secrets are read through helpers that throw if called where they
 * should not be. The Supabase service-role key is deliberately absent here — it
 * belongs only to scripts (see scripts/), never a request path (AGENTS.md #7).
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

/** Public Supabase URL. Safe on the client. */
export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Public Supabase publishable/anon key. Safe on the client. */
export function supabaseAnonKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The single email address permitted to sign in. Sen is a single-user app
 * (product-spec.md); every other address is refused at the door.
 * Server-only — never expose this on the client.
 */
export function allowedEmail(): string {
  return required("ALLOWED_EMAIL", process.env.ALLOWED_EMAIL).trim().toLowerCase();
}
