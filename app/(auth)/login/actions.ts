"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { allowedEmail } from "@/lib/env";

export type LoginState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

/**
 * Sends a magic link — but only ever to the single permitted address.
 * Any other email is refused before Supabase is touched, so this endpoint can
 * never be used to spray links at arbitrary inboxes (product-spec.md: one user).
 */
export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (email !== allowedEmail()) {
    return {
      status: "error",
      message: "That address is not permitted to sign in.",
    };
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return {
      status: "error",
      message: "Could not send the link. Try again in a moment.",
    };
  }

  return {
    status: "sent",
    message: "Check your inbox for a sign-in link.",
  };
}
