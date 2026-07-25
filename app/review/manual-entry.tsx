"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { todayIso } from "@/lib/ui/format";
import { addManualEntryAction, type ManualEntryState } from "./actions";
import type { CategoryOption } from "./review-queue";

const initial: ManualEntryState = { status: "idle" };

/**
 * Type in a cash purchase. Speed is a hard requirement here (product-spec.md):
 * date is pre-filled to today, the amount field autofocuses, and the whole form
 * is one row on desktop. Entries land confirmed — the owner is the authority.
 */
export function ManualEntry({ categories }: { categories: CategoryOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addManualEntryAction, initial);
  const amountRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) amountRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (state.status === "ok") {
      formRef.current?.reset();
      amountRef.current?.focus();
    }
  }, [state.status]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent"
      >
        + Add cash entry
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Cash entry</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Date
          <input
            type="date"
            name="bookedAt"
            defaultValue={todayIso()}
            required
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Amount
          <input
            ref={amountRef}
            name="amount"
            inputMode="decimal"
            placeholder="12.50"
            required
            className="tnum w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Direction
          <select
            name="direction"
            defaultValue="debit"
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-ink"
          >
            <option value="debit">Spent</option>
            <option value="credit">Received</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Category
          <select
            name="categoryId"
            defaultValue=""
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-ink"
          >
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
          Note
          <input
            name="note"
            placeholder="Nasi lemak"
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-ink"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      {state.status === "error" && (
        <p className="mt-2 text-xs text-danger">{state.message}</p>
      )}
      {state.status === "ok" && (
        <p className="mt-2 text-xs text-credit">Added. Enter another, or close.</p>
      )}
    </form>
  );
}
