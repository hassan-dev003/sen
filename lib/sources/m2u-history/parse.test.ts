import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "./parse";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "history");

/** Load a `.txt` fixture as the line array `extract` would have produced. */
function lines(name: string): string[] {
  const text = readFileSync(join(FIXTURES, `${name}.txt`), "utf8");
  return text.replace(/\n$/, "").split("\n");
}

describe("segmentation", () => {
  it("parses ten three-line blocks and discards furniture", () => {
    const { rows } = parse(lines("clean-print"));
    expect(rows).toHaveLength(10);

    const first = rows[0]!;
    expect(first.bookedAt).toBe("2026-07-24");
    expect(first.amountCents).toBe(2300);
    expect(first.direction).toBe("debit");
    expect(first.merchant).toBe("SARAH RISHAD HAMID");
    expect(first.rail).toBe("MAE QR");

    const salary = rows.find((r) => r.merchant === "ACME CORP SALARY")!;
    expect(salary.direction).toBe("credit");
    expect(salary.amountCents).toBe(650000);
  });

  it("parses a row clipped by the page-2 sticky header", () => {
    const { rows } = parse(lines("clipped-first-row"));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.merchant)).toEqual([
      "KEDAI RUNCIT ALI",
      "WATSONS KL",
    ]);
  });
});

describe("same-day occurrence, oldest-first", () => {
  it("keeps two identical same-day rows distinct", () => {
    const { rows } = parse(lines("same-day-repeats"));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bookedAt === "2026-07-23")).toBe(true);
    // listed newest-first, so occurrence 1 then 0
    expect(rows.map((r) => r.dayOccurrence)).toEqual([1, 0]);
  });

  it("keeps older rows' indices stable when a new same-day row lands on top", () => {
    const full = lines("growing-day");
    const grown = parse(full).rows;
    expect(grown.map((r) => r.dayOccurrence)).toEqual([2, 1, 0]);

    // Drop the newest block (the first three-line block after the 4 furniture
    // lines) to reconstruct the capture before it grew.
    const before = [...full.slice(0, 4), ...full.slice(7)];
    const prior = parse(before).rows;

    const occ = (rows: typeof grown, ref: string) =>
      rows.find((r) => r.descriptionRaw.includes(ref))!.dayOccurrence;
    // the two older rows keep the indices they had before the new one arrived
    expect(occ(prior, "QR22222222")).toBe(occ(grown, "QR22222222"));
    expect(occ(prior, "QR11111111")).toBe(occ(grown, "QR11111111"));
  });
});

describe("rail and merchant variants", () => {
  it("strips every rail form, including trailing * and - variants", () => {
    const { rows } = parse(lines("rail-variants"));
    const rails = rows.map((r) => r.rail);
    expect(rails).toEqual([
      "MAE QR",
      "DUITNOW QR",
      "PAYMENT VIA MYDEBIT",
      "SALE DEBIT",
      "PRE-AUTH MYDEBIT",
      "REV PREAUTH MYDEBIT",
      "PYMT VIA MYDEBIT RE",
    ]);
  });

  it("keeps a hyphen in a truncated merchant", () => {
    const { rows } = parse(lines("hyphenated-merchant"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.merchant).toBe("LCSB - GENTING SEMP");
    expect(rows[0]!.merchantTruncated).toBe(true);
  });
});

describe("balance anchor", () => {
  it("extracts the anchor and marks it reliable when floats are zero", () => {
    const cap = parse(lines("balance-anchor"));
    expect(cap.balanceAnchorCents).toBe(523410);
    expect(cap.anchorReliable).toBe(true);
  });

  it("suppresses the anchor's reliability when a float line is non-zero", () => {
    const cap = parse(lines("nonzero-float"));
    expect(cap.balanceAnchorCents).toBe(523410); // still extracted
    expect(cap.anchorReliable).toBe(false); // but not trustworthy
  });

  it("takes the newest balance and flags disagreement across prints", () => {
    const cap = parse([
      "Current balance RM 5,234.10 · One-day float RM 0.00",
      "MAE QR HANI STORE * QR1",
      "24 Jul 2026",
      "- RM 9.90",
      "Current balance RM 5,200.00 · One-day float RM 0.00",
    ]);
    expect(cap.balanceAnchorCents).toBe(523410); // newest (first) wins
    expect(cap.anchorConsistent).toBe(false);
    expect(cap.anchorReliable).toBe(false); // disagreement suppresses the check
  });
});
