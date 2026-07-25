"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    sendMagicLink,
    initialState,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow">Sen</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Machines type, humans confirm.</p>
      </div>

      {state.status === "sent" ? (
        <p className="rounded-lg border border-credit/40 bg-credit-soft px-4 py-3 text-sm">
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-xs text-muted">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send magic link"}
          </button>
          {state.status === "error" && (
            <p className="text-sm text-danger">{state.message}</p>
          )}
        </form>
      )}
    </main>
  );
}
