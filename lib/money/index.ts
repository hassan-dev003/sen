/**
 * Money. The only place ringgit is formatted or parsed.
 *
 * All amounts are integer cents (`bigint` in Postgres, `number` of cents here).
 * MYR has two decimal places, so RM 12.50 is 1250. Floating point never touches
 * a money value — there is no `.toFixed`, no `parseFloat`, no division that can
 * produce a fraction. See AGENTS.md rule 1 and docs/decisions.md D1.
 *
 * `amount_cents` on a transaction is always positive; direction carries the
 * sign (D2). `signedCents` is the one place that turns a stored amount back into
 * a signed figure, for balance reconstruction only.
 */

export type Cents = number;
export type Direction = "debit" | "credit";

export const CURRENCY = "MYR" as const;

function assertInteger(value: Cents, label: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
  }
}

/** Sum of two cent amounts. */
export function addCents(a: Cents, b: Cents): Cents {
  assertInteger(a, "a");
  assertInteger(b, "b");
  return a + b;
}

/** Difference of two cent amounts. */
export function subtractCents(a: Cents, b: Cents): Cents {
  assertInteger(a, "a");
  assertInteger(b, "b");
  return a - b;
}

/** Sum of a list of cent amounts. Empty list is zero. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertInteger(v, "value");
    total += v;
  }
  return total;
}

/**
 * A stored (always-positive) amount turned into a signed figure: debits are
 * negative, credits positive. Used to reconstruct balances from rows, never to
 * store an amount. Throws if given a negative amount, since a stored amount is
 * positive by invariant (D2).
 */
export function signedCents(amountCents: Cents, direction: Direction): Cents {
  assertInteger(amountCents, "amountCents");
  if (amountCents < 0) {
    throw new RangeError(
      `amountCents must be positive; sign is carried by direction (got ${amountCents})`,
    );
  }
  return direction === "debit" ? -amountCents : amountCents;
}

/** Group the integer part with thousands separators, no floating point. */
function groupThousands(digits: string): string {
  const out: string[] = [];
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out.push(",");
    }
    out.push(digits[i]!);
  }
  return out.join("");
}

/**
 * Format integer cents as MYR: `1250` → "RM 12.50", `-2300` → "-RM 23.00",
 * `100433` → "RM 1,004.33". The sign, if any, precedes the currency prefix.
 */
export function formatMYR(cents: Cents): string {
  assertInteger(cents, "cents");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const ringgit = Math.trunc(abs / 100);
  const sen = abs % 100;
  const body = `RM ${groupThousands(String(ringgit))}.${String(sen).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/**
 * Parse a MYR string into integer cents without floating point.
 *
 * Accepts an optional `RM` prefix, thousands separators, and a leading minus
 * (with or without a space): "RM 1,004.33", "1004.33", "- RM 23.00", "12.50".
 * The fractional part may be 0, 1, or 2 digits. Throws on anything else, so a
 * malformed amount fails loudly rather than silently becoming the wrong number.
 */
export function parseMYR(input: string): Cents {
  const trimmed = input.trim();
  const match = /^(-)?\s*(?:RM)?\s*([0-9,]+)(?:\.([0-9]{1,2}))?$/i.exec(trimmed);
  if (!match) {
    throw new RangeError(`Not a valid MYR amount: ${JSON.stringify(input)}`);
  }
  const [, sign, wholePart, fracPart = ""] = match;
  const whole = wholePart!.replace(/,/g, "");
  if (whole.length === 0) {
    throw new RangeError(`Not a valid MYR amount: ${JSON.stringify(input)}`);
  }
  const sen = fracPart.padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(sen);
  return sign === "-" ? -cents : cents;
}
