"use client";

import { useActionState } from "react";
import { importCapture, type ImportState } from "./actions";

const initial: ImportState = { status: "idle" };

export function UploadForm() {
  const [state, action, pending] = useActionState(importCapture, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        type="file"
        name="file"
        accept="application/pdf"
        required
        className="text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:border-border-strong"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
      >
        {pending ? "Importing…" : "Import capture"}
      </button>
      {state.status === "error" && (
        <p className="text-sm text-danger">{state.message}</p>
      )}
    </form>
  );
}
