import { describe, expect, it } from "vitest";
import {
  addCents,
  subtractCents,
  sumCents,
  signedCents,
  formatMYR,
  parseMYR,
} from "./index";

describe("cents arithmetic", () => {
  it("adds and subtracts", () => {
    expect(addCents(1250, 2300)).toBe(3550);
    expect(subtractCents(3550, 1250)).toBe(2300);
  });

  it("sums a list, empty is zero", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([100, 200, 433])).toBe(733);
  });

  it("rejects non-integer cents", () => {
    expect(() => addCents(12.5, 1)).toThrow(RangeError);
    expect(() => sumCents([1, 2.7])).toThrow(RangeError);
  });
});

describe("signedCents", () => {
  it("makes debits negative and credits positive", () => {
    expect(signedCents(1250, "debit")).toBe(-1250);
    expect(signedCents(1250, "credit")).toBe(1250);
  });

  it("reconstructs a balance from rows", () => {
    // opening 951_65, then a debit of 12.50 and a credit of 5.00
    const opening = 95165;
    const rows: Array<[number, "debit" | "credit"]> = [
      [1250, "debit"],
      [500, "credit"],
    ];
    const balance = opening + sumCents(rows.map(([a, d]) => signedCents(a, d)));
    expect(balance).toBe(95165 - 1250 + 500);
    expect(formatMYR(balance)).toBe("RM 944.15");
  });

  it("refuses a negative amount — sign belongs to direction", () => {
    expect(() => signedCents(-100, "debit")).toThrow(RangeError);
  });
});

describe("formatMYR", () => {
  it("formats zero and small amounts", () => {
    expect(formatMYR(0)).toBe("RM 0.00");
    expect(formatMYR(5)).toBe("RM 0.05");
    expect(formatMYR(1250)).toBe("RM 12.50");
  });

  it("adds thousands separators", () => {
    expect(formatMYR(100433)).toBe("RM 1,004.33");
    expect(formatMYR(123456789)).toBe("RM 1,234,567.89");
  });

  it("formats negatives with the sign before RM", () => {
    expect(formatMYR(-2300)).toBe("-RM 23.00");
    expect(formatMYR(-100433)).toBe("-RM 1,004.33");
  });

  it("rejects non-integer input", () => {
    expect(() => formatMYR(12.5)).toThrow(RangeError);
  });
});

describe("parseMYR", () => {
  it("parses the shapes seen in captures", () => {
    expect(parseMYR("RM 15.87")).toBe(1587);
    expect(parseMYR("- RM 23.00")).toBe(-2300);
    expect(parseMYR("RM 1,004.33")).toBe(100433);
    expect(parseMYR("12.50")).toBe(1250);
    expect(parseMYR("-12.50")).toBe(-1250);
  });

  it("handles missing or short fractional parts", () => {
    expect(parseMYR("RM 5")).toBe(500);
    expect(parseMYR("RM 5.5")).toBe(550);
  });

  it("round-trips with formatMYR", () => {
    for (const cents of [0, 5, 1250, 100433, 123456789]) {
      expect(parseMYR(formatMYR(cents))).toBe(cents);
    }
    expect(parseMYR(formatMYR(-2300))).toBe(-2300);
  });

  it("throws on garbage rather than guessing", () => {
    expect(() => parseMYR("")).toThrow(RangeError);
    expect(() => parseMYR("RM")).toThrow(RangeError);
    expect(() => parseMYR("12.345")).toThrow(RangeError);
    expect(() => parseMYR("abc")).toThrow(RangeError);
    expect(() => parseMYR("1.2.3")).toThrow(RangeError);
  });
});
