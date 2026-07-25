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
        className="text-sm file:mr-3 file:rounded-md file:border file:border-black/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Importing…" : "Import capture"}
      </button>
      {state.status === "error" && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
    </form>
  );
}
