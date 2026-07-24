/**
 * The parse layer: text lines -> structured rows. Pure, and depends only on the
 * order of the lines it is given (docs/history-import.md). No PDF library, no
 * database, no file system — the caller has already turned bytes into lines via
 * `extract`.
 *
 * Every transaction in the M2U history view is exactly three lines: a flattened
 * description, then a date, then an amount. A transaction is any line followed
 * by a date line and then an amount line; everything else is page furniture,
 * discarded by that shape rather than by matching its content.
 */
import { parseMYR } from "@/lib/money";
import { normalize, NORMALIZER_VERSION, type Normalized } from "@/lib/normalize";
import type { Direction } from "@/lib/sources/types";

export interface ParsedHistoryRow extends Normalized {
  /** Booking date, YYYY-MM-DD. */
  bookedAt: string;
  descriptionRaw: string;
  /** Always positive; sign is in `direction`. */
  amountCents: number;
  direction: Direction;
  /**
   * Index within the row's own date, counted oldest-first. M2U lists newest
   * first, so oldest-first keeps existing indices stable when a new transaction
   * lands on the current day (docs/history-import.md#no-running-balance).
   */
  dayOccurrence: number;
  /** Index of the description line in the input. */
  sourceLineNo: number;
}

export interface ParsedCapture {
  rows: ParsedHistoryRow[];
  /** The account balance printed on the capture, or null if none was found. */
  balanceAnchorCents: number | null;
  /** False when any float line was non-zero, which invalidates the anchor. */
  anchorReliable: boolean;
  normalizerVersion: number;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

const DATE_RE = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;
const AMOUNT_RE = /^-?\s*RM\s[\d,]+\.\d{2}$/;

function parseDate(line: string): string | null {
  const m = DATE_RE.exec(line);
  if (!m) return null;
  const [, day, mon, year] = m;
  return `${year}-${MONTHS[mon!]}-${day!.padStart(2, "0")}`;
}

function parseAmount(line: string): { amountCents: number; direction: Direction } | null {
  if (!AMOUNT_RE.test(line)) return null;
  const signed = parseMYR(line);
  return {
    amountCents: Math.abs(signed),
    direction: signed < 0 ? "debit" : "credit",
  };
}

/** Read the balance anchor and float lines out of the page furniture. */
function readAnchor(lines: readonly string[]): {
  balanceAnchorCents: number | null;
  anchorReliable: boolean;
} {
  let balanceAnchorCents: number | null = null;
  let sawNonZeroFloat = false;

  for (const line of lines) {
    if (balanceAnchorCents === null) {
      const m = /Current balance RM ([\d,]+\.\d{2})/i.exec(line);
      if (m) balanceAnchorCents = parseMYR(m[1]!);
    }
    for (const f of line.matchAll(/float RM ([\d,]+\.\d{2})/gi)) {
      if (parseMYR(f[1]!) !== 0) sawNonZeroFloat = true;
    }
  }

  return {
    balanceAnchorCents,
    anchorReliable: balanceAnchorCents !== null && !sawNonZeroFloat,
  };
}

/** Assign each row an index within its date, counted oldest-first. */
function assignDayOccurrence(
  rows: Array<Omit<ParsedHistoryRow, "dayOccurrence">>,
): ParsedHistoryRow[] {
  const byDate = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const bucket = byDate.get(row.bookedAt) ?? [];
    bucket.push(i);
    byDate.set(row.bookedAt, bucket);
  });

  const occurrence = new Array<number>(rows.length);
  for (const indices of byDate.values()) {
    // `indices` is in file order (newest first); reverse for oldest-first.
    indices.forEach((rowIndex, posInDate) => {
      occurrence[rowIndex] = indices.length - 1 - posInDate;
    });
  }

  return rows.map((row, i) => ({ ...row, dayOccurrence: occurrence[i]! }));
}

export function parse(lines: readonly string[]): ParsedCapture {
  const rows: Array<Omit<ParsedHistoryRow, "dayOccurrence">> = [];

  let i = 0;
  while (i < lines.length) {
    const date = i + 1 < lines.length ? parseDate(lines[i + 1]!) : null;
    const amount = i + 2 < lines.length ? parseAmount(lines[i + 2]!) : null;

    if (date && amount) {
      const descriptionRaw = lines[i]!;
      rows.push({
        bookedAt: date,
        descriptionRaw,
        amountCents: amount.amountCents,
        direction: amount.direction,
        sourceLineNo: i,
        ...normalize(descriptionRaw),
      });
      i += 3;
    } else {
      i += 1;
    }
  }

  return {
    rows: assignDayOccurrence(rows),
    ...readAnchor(lines),
    normalizerVersion: NORMALIZER_VERSION,
  };
}
