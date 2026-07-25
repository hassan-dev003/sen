"use client";

import { useActionState } from "react";
import { formatMYR } from "@/lib/money";
import { postAdjustmentAction, type AdjustmentState } from "./actions";

const initial: AdjustmentState = { status: "idle" };

export interface BalanceStatus {
  applicable: boolean;
  ok: boolean;
  differenceCents: number;
}

/**
 * The running balance figure, visible without hunting for it (roadmap Sprint 4).
 * Verified, or off by an amount — and when it is off, the primary remedy is to
 * widen the history window and re-import. Posting an adjustment is the last
 * resort for a difference that survives that (D21); Sen offers the figure, the
 * owner confirms.
 */
export function BalanceBanner({ status }: { status: BalanceStatus }) {
  const [state, formAction, pending] = useActionState(postAdjustmentAction, initial);

  if (!status.applicable) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
        Balance check will appear once an opening balance is confirmed and a
        capture with a reliable balance is imported.
      </div>
    );
  }

  if (status.ok) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-credit/30 bg-credit-soft px-4 py-3 text-sm">
        <span aria-hidden className="size-2 rounded-full bg-credit" />
        <span className="text-ink">Your captures account for the balance exactly.</span>
      </div>
    );
  }

  const off = Math.abs(status.differenceCents);

  return (
    <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden className="size-2 rounded-full bg-warning" />
        <span className="text-ink">
          Off by <span className="tnum font-medium">{formatMYR(off)}</span>. Widen the
          history window (60 or 90 days) and re-import — dedupe absorbs the overlap.
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3 pl-4">
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-warning/50 px-2.5 py-1 text-xs text-warning hover:bg-warning/10 disabled:opacity-60"
          >
            {pending ? "Posting…" : `Post ${formatMYR(off)} adjustment`}
          </button>
        </form>
        <span className="text-xs text-muted">
          Only if it survives a wider re-import. Lands in Unaccounted.
        </span>
      </div>
      {state.status === "error" && (
        <p className="mt-1 pl-4 text-xs text-danger">{state.message}</p>
      )}
      {state.status === "ok" && (
        <p className="mt-1 pl-4 text-xs text-credit">Adjustment posted to Unaccounted.</p>
      )}
    </div>
  );
}
