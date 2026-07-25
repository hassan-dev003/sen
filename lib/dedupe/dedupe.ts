import { createHash } from "node:crypto";
import type { Direction } from "@/lib/sources/types";

/**
 * The dedupe key for an M2U history row. The view carries no running balance, so
 * the hash substitutes a day-scoped occurrence index counted oldest-first
 * (docs/history-import.md#no-running-balance). The normaliser version is in the
 * key: if normalisation changes, hashes are recomputed from `raw_rows`.
 *
 * Enforced by the `(user_id, dedupe_hash)` unique index; import uses
 * `on conflict do nothing`, so importing the same capture twice inserts nothing.
 */
export interface DedupeKey {
  accountId: string;
  bookedAt: string;
  descriptionNormalized: string;
  direction: Direction;
  amountCents: number;
  rail: string | null;
  dayOccurrence: number;
  normalizerVersion: number;
}

export function computeDedupeHash(key: DedupeKey): string {
  const parts = [
    key.accountId,
    key.bookedAt,
    key.descriptionNormalized,
    key.direction,
    String(key.amountCents),
    key.rail ?? "",
    String(key.dayOccurrence),
    String(key.normalizerVersion),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
