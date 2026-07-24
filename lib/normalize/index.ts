/**
 * Shared merchant normalisation. `descriptionNormalized` is what rules, dedupe,
 * and cross-source matching all key on, so it must be deterministic, stable, and
 * versioned — changing it invalidates every existing dedupe hash. See
 * docs/normalisation.md.
 *
 * The load-bearing requirement: the same transaction seen through different
 * sources must normalise to the SAME merchant string. The M2U history view puts
 * the payment rail as a prefix; the statement puts it last. Both converge here.
 */

/**
 * Bump when the algorithm below changes in any way that alters its output. A
 * change means every dedupe hash must be recomputed from `raw_rows` in a
 * migration (docs/normalisation.md).
 */
export const NORMALIZER_VERSION = 1;

export interface Normalized {
  /** The canonical string rules and dedupe match on. Uppercase, cleaned. */
  descriptionNormalized: string;
  /** The display merchant, or null when the row carries only a reference. */
  merchant: string | null;
  /** True when the bank truncated the merchant to 20 chars with a trailing `*`. */
  merchantTruncated: boolean;
  /** The payment rail, moved out of the description into structured form. */
  rail: string | null;
}

/**
 * Known payment rails. Matched as a prefix, longest first, tolerating a trailing
 * `*` or `-` that belongs to the rail (`DUITNOW QR-`, `REV PREAUTH MYDEBIT*`).
 * The matched rail is recorded without that trailing mark.
 */
const RAILS: readonly string[] = [
  "PYMT VIA MYDEBIT RE",
  "IBK FUND TFR FR A/C",
  "IBK FUND TFR TO A/C",
  "REV PREAUTH MYDEBIT",
  "FUND TRANSFER TO A/",
  "PAYMENT VIA MYDEBIT",
  "TRANSFER FROM A/C",
  "PRE-AUTH MYDEBIT",
  "FPX PAYMENT FR A/",
  "PRE-AUTH REFUND",
  "PRE-AUTH DEBIT",
  "QR PAY SALES",
  "PYMT FROM A/C",
  "SVG GIRO CR",
  "PROFIT PAID",
  "DUITNOW QR",
  "SALE DEBIT",
  "MBB CT",
  "MAE QR",
];

// Sorted once, longest first, so "PRE-AUTH MYDEBIT" wins over "PRE-AUTH DEBIT".
const RAILS_BY_LENGTH = [...RAILS].sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pull a known rail prefix off the front, returning the rail and the rest. */
function splitRail(description: string): { rail: string | null; rest: string } {
  for (const rail of RAILS_BY_LENGTH) {
    // rail, then an optional trailing * or - that belongs to it, then a space
    // boundary or the end of the string.
    const re = new RegExp(`^${escapeRegExp(rail)}[*-]?(\\s+|$)`, "i");
    const m = re.exec(description);
    if (m) {
      return { rail, rest: description.slice(m[0].length) };
    }
  }
  return { rail: null, rest: description };
}

/** A per-transaction reference token, never part of the merchant identity. */
function isReferenceToken(token: string): boolean {
  return (
    /^QR\d+$/i.test(token) || // QR71429243
    /^\d+Q$/i.test(token) || // 126641398Q
    /^MBBQR\d+$/i.test(token) || // MBBQR...
    /^MB\d+[A-Z]$/i.test(token) || // MB123A
    /^T\d+$/i.test(token) || // T110296493826
    /^my\d+$/i.test(token) || // my3260024837
    token === "*" // a lone separator star
  );
}

const BARE_NUMERIC = /^\d{6,}$/;

/** A token that is neither a reference nor a bare number — a real name word. */
function isMerchantWord(token: string): boolean {
  return !isReferenceToken(token) && !BARE_NUMERIC.test(token);
}

/**
 * Reduce tokens to the merchant. References cluster at either end — a leading
 * reference and a trailing reference around the name (the FPX shape in
 * docs/statement-import.md), or a trailing `* reference` (the QR shape). Take
 * the span from the first real name word to the last; that trims references off
 * both ends while keeping anything between intact.
 *
 * When there is no name word, a lone long number is a phone-number merchant and
 * is kept (docs/categorization.md); anything else (a bare QR reference) leaves
 * no merchant at all.
 */
function merchantTokens(tokens: string[]): string[] {
  const first = tokens.findIndex(isMerchantWord);
  if (first === -1) {
    return tokens.length === 1 && BARE_NUMERIC.test(tokens[0]!) ? tokens : [];
  }
  let last = tokens.length - 1;
  while (last > first && !isMerchantWord(tokens[last]!)) last--;
  return tokens.slice(first, last + 1);
}

/**
 * Normalise a flattened M2U history description of the shape
 * `<rail> <merchant><*> <reference>` into structured parts.
 */
export function normalize(descriptionRaw: string): Normalized {
  const { rail, rest } = splitRail(descriptionRaw.trim());

  const tokens = rest.split(/\s+/).filter((t) => t.length > 0);
  let merchantRaw = merchantTokens(tokens).join(" ");

  // A `*` trailing the final merchant token is the bank's truncation marker
  // (position 21). A `*` embedded inside a token is part of the name and stays.
  let merchantTruncated = false;
  if (merchantRaw.endsWith("*")) {
    merchantTruncated = true;
    merchantRaw = merchantRaw.slice(0, -1);
  }

  let normalized = merchantRaw.toUpperCase().replace(/\s+/g, " ").trim();

  // A MMYY period suffix on the payroll line varies every month and would make a
  // rule match once and never again — strip it (docs/normalisation.md step 4).
  if (/\bSALARY\b/.test(normalized)) {
    normalized = normalized.replace(/\s+\d{4}$/, "").trim();
  }

  const merchant = normalized.length > 0 ? normalized : null;

  return {
    descriptionNormalized: normalized,
    merchant,
    merchantTruncated,
    rail,
  };
}
