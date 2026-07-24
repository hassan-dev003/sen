/**
 * The source-agnostic contract. Everything below `SourceAdapter` in the pipeline
 * (normalise, dedupe, event collapse) speaks `RawTransaction` and never branches
 * on which source produced it — see docs/architecture.md.
 */

export type TxnSource = "statement_pdf" | "m2u_history" | "finverse" | "manual";
export type Direction = "debit" | "credit";
export type PostingState = "pending" | "posted";

export interface RawTransaction {
  /** Stable bank/provider id, if the source gives one. Null for statements/history. */
  externalId: string | null;
  /** Booking date, YYYY-MM-DD. A transaction line has a date, not an instant. */
  bookedAt: string;
  valueDate: string | null;
  descriptionRaw: string;
  reference: string | null;
  /** Always positive. Sign is carried by `direction` (D2). */
  amountCents: number;
  direction: Direction;
  /** Present for statements; null for the history view and many APIs. */
  balanceAfterCents: number | null;
  postingState: PostingState;
  /** Position of the row in the source text, if meaningful. */
  sourceLineNo: number | null;
}

export interface SourceAdapter {
  readonly source: TxnSource;
  ingest(input: unknown): Promise<{
    accountHint: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    rows: RawTransaction[];
  }>;
}
