import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * A Supabase client bound to the current request's session cookies. Created per
 * request (architecture.md#data-access). Uses the publishable/anon key and RLS;
 * the service-role key never appears in a request path (AGENTS.md #7).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` was called from a Server Component. Safe to ignore when
          // middleware is refreshing the session (see lib/supabase/middleware.ts).
        }
      },
    },
  });
}
