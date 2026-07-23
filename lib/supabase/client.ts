import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** A Supabase client for use in Client Components. Publishable/anon key only. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
