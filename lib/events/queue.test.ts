import { describe, expect, it } from "vitest";
import { collapseEvents } from "./collapse";
import type { CollapseInput } from "./types";
import { projectEvents, type QueueRow } from "./queue";

/**
 * Build the QueueRows a real import would have stored, by running the collapser
 * over `inputs` and stamping its per-row group/role/state back onto each input.
 * This is exactly what the import pipeline persists, so projecting these rows
 * must reproduce the collapser's own events.
 */
function storedFrom(inputs: CollapseInput[]): QueueRow[] {
  const collapsed = collapseEvents(inputs);
  const roleAndState = new Map<string, { group: string; role: string; state: string }>();
  for (const e of collapsed.events) {
    for (const id of e.rowIds) {
      const r = collapsed.rows.find((row) => row.id === id)!;
      roleAndState.set(id, { group: e.eventGroupId, role: r.eventRole, state: e.state });
    }
  }
  return inputs.map((input) => {
    const meta = roleAndState.get(input.id)!;
    return {
      id: input.id,
      eventGroupId: meta.group,
      eventRole: meta.role as QueueRow["eventRole"],
      eventState: meta.state as QueueRow["eventState"],
      reviewState: "draft",
      bookedAt: input.bookedAt,
      amountCents: input.amountCents,
      direction: input.direction,
      descriptionRaw: `${input.type ?? ""} ${input.merchantKey}`.trim(),
      merchant: input.merchantKey,
      rail: input.type,
      categoryId: null,
      batchId: "batch-1",
      note: null,
      isAdjustment: false,
    } satisfies QueueRow;
  });
}

/** A single non-lifecycle row: a QR payment, a transfer, salary. */
function single(id: string, amountCents: number, direction: "debit" | "credit" = "debit"): CollapseInput {
  return { id, bookedAt: "2026-07-10", merchantKey: `M-${id}`, type: "DUITNOW QR", amountCents, direction };
}

describe("projectEvents — grouping", () => {
  it("returns one event per group, newest first", () => {
    const rows = storedFrom([
      { ...single("a", 1000), bookedAt: "2026-07-01" },
      { ...single("b", 2000), bookedAt: "2026-07-15" },
      { ...single("c", 3000), bookedAt: "2026-07-10" },
    ]);
    const events = projectEvents(rows);
    expect(events.map((e) => e.bookedAt)).toEqual(["2026-07-15", "2026-07-10", "2026-07-01"]);
    expect(events).toHaveLength(3);
  });

  it("orders constituent rows oldest first within an event", () => {
    // Auth + reversal + settlement, fed in a jumbled order.
    const inputs: CollapseInput[] = [
      { id: "sett", bookedAt: "2026-07-03", merchantKey: "PETRON", type: "PAYMENT VIA MYDEBIT", amountCents: 1250, direction: "debit" },
      { id: "rev", bookedAt: "2026-07-02", merchantKey: "PETRON", type: "REV PREAUTH MYDEBIT", amountCents: 1250, direction: "credit" },
      { id: "auth", bookedAt: "2026-07-01", merchantKey: "PETRON", type: "PRE-AUTH MYDEBIT", amountCents: 1250, direction: "debit" },
    ];
    const [event] = projectEvents(storedFrom(inputs));
    expect(event!.rows.map((r) => r.bookedAt)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(event!.rows).toHaveLength(3);
  });
});

describe("projectEvents — economic amount agrees with the collapser", () => {
  // Each scenario: inputs, and the single event the collapser yields. The
  // projection must reproduce that event's amount, direction, and state.
  const scenarios: Array<{ name: string; inputs: CollapseInput[] }> = [
    {
      name: "resolved triplet (auth, reversal, settlement) → settlement amount",
      inputs: [
        { id: "auth", bookedAt: "2026-07-01", merchantKey: "PETRON", type: "PRE-AUTH MYDEBIT", amountCents: 1250, direction: "debit" },
        { id: "rev", bookedAt: "2026-07-01", merchantKey: "PETRON", type: "REV PREAUTH MYDEBIT", amountCents: 1250, direction: "credit" },
        { id: "sett", bookedAt: "2026-07-01", merchantKey: "PETRON", type: "PAYMENT VIA MYDEBIT", amountCents: 1250, direction: "debit" },
      ],
    },
    {
      name: "foreign-currency settlement differs from the auth → settlement amount",
      inputs: [
        { id: "auth", bookedAt: "2026-07-01", merchantKey: "DIGITALOCEAN", type: "PRE-AUTH DEBIT", amountCents: 5268, direction: "debit" },
        { id: "rev", bookedAt: "2026-07-01", merchantKey: "DIGITALOCEAN", type: "PRE-AUTH REFUND", amountCents: 5268, direction: "credit" },
        { id: "sett", bookedAt: "2026-07-02", merchantKey: "DIGITALOCEAN", type: "SALE DEBIT", amountCents: 5217, direction: "debit" },
      ],
    },
    {
      name: "cancelled (auth + reversal, no settlement) → zero",
      inputs: [
        { id: "auth", bookedAt: "2026-07-01", merchantKey: "PARKING", type: "PRE-AUTH MYDEBIT", amountCents: 500, direction: "debit" },
        { id: "rev", bookedAt: "2026-07-01", merchantKey: "PARKING", type: "REV PREAUTH MYDEBIT", amountCents: 500, direction: "credit" },
      ],
    },
    {
      name: "pending (auth, no reversal yet) → provisional auth amount",
      inputs: [
        { id: "auth", bookedAt: "2026-07-01", merchantKey: "TOLL", type: "PRE-AUTH MYDEBIT", amountCents: 300, direction: "debit" },
      ],
    },
    {
      name: "settlement refunded (settlement + settlement-reversal) → zero",
      inputs: [
        { id: "sett", bookedAt: "2026-07-01", merchantKey: "COVA", type: "PAYMENT VIA MYDEBIT", amountCents: 100, direction: "debit" },
        { id: "srev", bookedAt: "2026-07-02", merchantKey: "COVA", type: "PYMT VIA MYDEBIT RE", amountCents: 100, direction: "credit" },
      ],
    },
    {
      name: "orphan reversal (no auth) → its own amount",
      inputs: [
        { id: "rev", bookedAt: "2026-07-01", merchantKey: "SHELL", type: "REV PREAUTH MYDEBIT", amountCents: 800, direction: "credit" },
      ],
    },
    {
      name: "plain single → its own amount",
      inputs: [single("qr", 4200, "credit")],
    },
  ];

  for (const { name, inputs } of scenarios) {
    it(name, () => {
      const collapsed = collapseEvents(inputs);
      expect(collapsed.events, "scenario should yield exactly one event").toHaveLength(1);
      const expected = collapsed.events[0]!;

      const [projected] = projectEvents(storedFrom(inputs));
      expect(projected!.amountCents).toBe(expected.amountCents);
      expect(projected!.direction).toBe(expected.direction);
      expect(projected!.state).toBe(expected.state);
    });
  }
});

describe("projectEvents — event-level fields", () => {
  it("takes description and category from the settlement, not the authorisation", () => {
    const rows = storedFrom([
      { id: "auth", bookedAt: "2026-07-01", merchantKey: "PETRON", type: "PRE-AUTH MYDEBIT", amountCents: 1250, direction: "debit" },
      { id: "sett", bookedAt: "2026-07-02", merchantKey: "PETRON", type: "PAYMENT VIA MYDEBIT", amountCents: 1250, direction: "debit" },
    ]);
    // Categorise the whole group, as an edit would.
    for (const r of rows) r.categoryId = "cat-food";
    const [event] = projectEvents(rows);
    expect(event!.bookedAt).toBe("2026-07-02"); // the settlement's date
    expect(event!.descriptionRaw).toContain("PAYMENT VIA MYDEBIT");
    expect(event!.categoryId).toBe("cat-food");
  });

  it("carries the adjustment flag through", () => {
    const [row] = storedFrom([single("adj", 900)]);
    row!.isAdjustment = true;
    const [event] = projectEvents([row!]);
    expect(event!.isAdjustment).toBe(true);
  });
});
