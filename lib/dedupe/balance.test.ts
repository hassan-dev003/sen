import { describe, expect, it } from "vitest";
import { deriveOpeningBalance, sumSigned, verifyBalance } from "./balance";
import type { Direction } from "@/lib/sources/types";

function row(amountCents: number, direction: Direction, bookedAt = "2026-06-01") {
  return { amountCents, direction, bookedAt };
}

describe("sumSigned", () => {
  it("nets debits negative and credits positive", () => {
    expect(sumSigned([row(1250, "debit"), row(500, "credit")])).toBe(-750);
  });
});

describe("deriveOpeningBalance", () => {
  it("subtracts the captured movements from the printed balance", () => {
    // printed balance 100.00; movements: -12.50 debit, +5.00 credit => net -7.50
    // opening = 10000 - (-750) = 10750
    const derived = deriveOpeningBalance({
      rows: [row(1250, "debit", "2026-06-02"), row(500, "credit", "2026-06-01")],
      balanceAnchorCents: 10000,
      anchorReliable: true,
    });
    expect(derived).toEqual({ openingBalanceCents: 10750, openingBalanceAt: "2026-06-01" });
  });

  it("returns null when the anchor is unreliable or absent", () => {
    expect(
      deriveOpeningBalance({ rows: [row(100, "debit")], balanceAnchorCents: 10000, anchorReliable: false }),
    ).toBeNull();
    expect(
      deriveOpeningBalance({ rows: [row(100, "debit")], balanceAnchorCents: null, anchorReliable: true }),
    ).toBeNull();
  });
});

describe("verifyBalance", () => {
  it("verifies when opening plus movements equals the anchor", () => {
    const v = verifyBalance({
      openingBalanceCents: 10750,
      openingBalanceAt: "2026-06-01",
      sumSignedOnAfterCents: -750,
      anchorCents: 10000,
      anchorReliable: true,
    });
    expect(v).toEqual({ applicable: true, ok: true, differenceCents: 0 });
  });

  it("reports the difference when off, as a figure not a failure", () => {
    const v = verifyBalance({
      openingBalanceCents: 10750,
      openingBalanceAt: "2026-06-01",
      sumSignedOnAfterCents: -1000, // captured 2.50 more debit than the anchor shows
      anchorCents: 10000,
      anchorReliable: true,
    });
    expect(v.applicable).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.differenceCents).toBe(250);
  });

  it("is not applicable without a baseline or with an unreliable anchor", () => {
    expect(
      verifyBalance({ openingBalanceCents: null, openingBalanceAt: null, sumSignedOnAfterCents: 0, anchorCents: 10000, anchorReliable: true }).applicable,
    ).toBe(false);
    expect(
      verifyBalance({ openingBalanceCents: 100, openingBalanceAt: "2026-06-01", sumSignedOnAfterCents: 0, anchorCents: 10000, anchorReliable: false }).applicable,
    ).toBe(false);
  });
});
