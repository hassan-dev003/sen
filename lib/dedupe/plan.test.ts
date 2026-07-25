import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planImport, type ExistingRow } from "./plan";
import { parse, type ParsedCapture, type ParsedHistoryRow } from "@/lib/sources/m2u-history/parse";
import { NORMALIZER_VERSION } from "@/lib/normalize";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "history");

function captureFromFixture(name: string): ParsedCapture {
  const text = readFileSync(join(FIXTURES, `${name}.txt`), "utf8");
  return parse(text.replace(/\n$/, "").split("\n"));
}

/** A deterministic group-id generator for assertions. */
function counter() {
  let n = 0;
  return () => `g${++n}`;
}

describe("planImport — idempotency", () => {
  it("inserts every row on a first import", () => {
    const capture = captureFromFixture("clean-print");
    const plan = planImport({
      accountId: "acc-1",
      capture,
      existingHashes: new Set(),
      openRows: [],
      newGroupId: counter(),
    });
    expect(plan.report.rowsParsed).toBe(10);
    expect(plan.report.rowsInserted).toBe(10);
    expect(plan.report.rowsDuplicate).toBe(0);
    expect(plan.newTxns).toHaveLength(10);
    expect(plan.rawRows).toHaveLength(10);
  });

  it("inserts zero rows when the same capture is imported again", () => {
    const capture = captureFromFixture("clean-print");
    const first = planImport({
      accountId: "acc-1",
      capture,
      existingHashes: new Set(),
      openRows: [],
      newGroupId: counter(),
    });
    const existingHashes = new Set(first.newTxns.map((t) => t.dedupeHash));

    const second = planImport({
      accountId: "acc-1",
      capture,
      existingHashes,
      openRows: [],
      newGroupId: counter(),
    });
    expect(second.report.rowsInserted).toBe(0);
    expect(second.report.rowsDuplicate).toBe(10);
    expect(second.newTxns).toHaveLength(0);
    expect(second.regroups).toHaveLength(0);
  });

  it("inserts only the genuinely new rows on an overlapping import", () => {
    const capture = captureFromFixture("clean-print");
    const first = planImport({
      accountId: "acc-1",
      capture,
      existingHashes: new Set(),
      openRows: [],
      newGroupId: counter(),
    });
    // pretend six of the ten were already imported
    const alreadyThere = new Set(first.newTxns.slice(0, 6).map((t) => t.dedupeHash));

    const overlap = planImport({
      accountId: "acc-1",
      capture,
      existingHashes: alreadyThere,
      openRows: [],
      newGroupId: counter(),
    });
    expect(overlap.report.rowsInserted).toBe(4);
    expect(overlap.report.rowsDuplicate).toBe(6);
  });

  it("keys the hash to the account, so the same row differs across accounts", () => {
    const capture = captureFromFixture("clean-print");
    const a = planImport({ accountId: "acc-1", capture, existingHashes: new Set(), openRows: [], newGroupId: counter() });
    const b = planImport({ accountId: "acc-2", capture, existingHashes: new Set(), openRows: [], newGroupId: counter() });
    expect(a.newTxns[0]!.dedupeHash).not.toBe(b.newTxns[0]!.dedupeHash);
  });
});

function hrow(partial: Partial<ParsedHistoryRow> & Pick<ParsedHistoryRow, "sourceLineNo">): ParsedHistoryRow {
  return {
    bookedAt: "2026-06-01",
    descriptionRaw: "PRE-AUTH MYDEBIT PETRON",
    amountCents: 5000,
    direction: "debit",
    descriptionNormalized: "PETRON",
    merchant: "PETRON",
    merchantTruncated: false,
    rail: "PRE-AUTH MYDEBIT",
    dayOccurrence: 0,
    ...partial,
  };
}

describe("planImport — cross-batch regrouping", () => {
  it("regroups an earlier pending authorisation when its reversal arrives", () => {
    // a pending authorisation from an earlier batch
    const openAuth: ExistingRow = {
      id: "existing-auth",
      merchantKey: "PETRON",
      rail: "PRE-AUTH MYDEBIT",
      amountCents: 5000,
      direction: "debit",
      bookedAt: "2026-06-01",
      eventGroupId: "old-group",
      eventRole: "authorization",
      eventState: "pending",
    };
    // this capture supplies the matching reversal
    const capture: ParsedCapture = {
      rows: [
        hrow({
          sourceLineNo: 3,
          descriptionRaw: "REV PREAUTH MYDEBIT PETRON",
          descriptionNormalized: "PETRON",
          rail: "REV PREAUTH MYDEBIT",
          direction: "credit",
        }),
      ],
      balanceAnchorCents: null,
      anchorReliable: false,
      anchorConsistent: true,
      normalizerVersion: NORMALIZER_VERSION,
    };

    const plan = planImport({
      accountId: "acc-1",
      capture,
      existingHashes: new Set(),
      openRows: [openAuth],
      newGroupId: counter(),
    });

    // the reversal inserts; the existing auth regroups with it, now cancelled
    expect(plan.newTxns).toHaveLength(1);
    expect(plan.regroups).toHaveLength(1);
    const regroup = plan.regroups[0]!;
    expect(regroup.id).toBe("existing-auth");
    expect(regroup.eventState).toBe("cancelled");
    expect(regroup.eventGroupId).toBe(plan.newTxns[0]!.eventGroupId);
  });

  it("does not regroup existing rows when nothing new pairs with them", () => {
    const openAuth: ExistingRow = {
      id: "existing-auth",
      merchantKey: "PETRON",
      rail: "PRE-AUTH MYDEBIT",
      amountCents: 5000,
      direction: "debit",
      bookedAt: "2026-06-01",
      eventGroupId: "old-group",
      eventRole: "authorization",
      eventState: "pending",
    };
    // an unrelated fresh row at a different merchant
    const capture: ParsedCapture = {
      rows: [
        hrow({
          sourceLineNo: 3,
          descriptionRaw: "MAE QR ALI",
          descriptionNormalized: "ALI",
          rail: "MAE QR",
          merchant: "ALI",
        }),
      ],
      balanceAnchorCents: null,
      anchorReliable: false,
      anchorConsistent: true,
      normalizerVersion: NORMALIZER_VERSION,
    };

    const plan = planImport({
      accountId: "acc-1",
      capture,
      existingHashes: new Set(),
      openRows: [openAuth],
      newGroupId: counter(),
    });
    expect(plan.newTxns).toHaveLength(1);
    expect(plan.regroups).toHaveLength(0);
  });
});
