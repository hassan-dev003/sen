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
        <h1 className="text-2xl font-semibold">Sen</h1>
        <p className="mt-1 text-sm opacity-70">
          Machines type, humans confirm.
        </p>
      </div>

      {state.status === "sent" ? (
        <p className="rounded-md border border-green-600/40 bg-green-600/10 px-4 py-3 text-sm">
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send magic link"}
          </button>
          {state.status === "error" && (
            <p className="text-sm text-red-600">{state.message}</p>
          )}
        </form>
      )}
    </main>
  );
}
