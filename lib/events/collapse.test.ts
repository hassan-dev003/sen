import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collapseEvents } from "./collapse";
import type { CollapseInput } from "./types";
import { parse } from "@/lib/sources/m2u-history/parse";
import type { Direction } from "@/lib/sources/types";

let seq = 0;
function row(
  type: string | null,
  amountCents: number,
  bookedAt: string,
  opts: { merchant?: string; direction?: Direction; id?: string } = {},
): CollapseInput {
  return {
    id: opts.id ?? `r${++seq}`,
    bookedAt,
    merchantKey: opts.merchant ?? "PETRON SIMPANG AMPA",
    type,
    amountCents,
    direction: opts.direction ?? "debit",
  };
}

/** The event that a given row ended up in. */
function eventOf(result: ReturnType<typeof collapseEvents>, rowId: string) {
  const assignment = result.rows.find((r) => r.id === rowId)!;
  return result.events.find((e) => e.eventGroupId === assignment.eventGroupId)!;
}

describe("the three-row pre-authorisation group", () => {
  it("collapses auth + reversal + settlement into one resolved event", () => {
    const auth = row("PRE-AUTH MYDEBIT", 1250, "2026-06-01");
    const rev = row("REV PREAUTH MYDEBIT", 1250, "2026-06-01", { direction: "credit" });
    const sett = row("PAYMENT VIA MYDEBIT", 1250, "2026-06-01");

    const result = collapseEvents([auth, rev, sett]);

    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.state).toBe("resolved");
    expect(event.amountCents).toBe(1250);
    expect(event.rowIds).toHaveLength(3);
    expect(new Set(event.rowIds)).toEqual(new Set([auth.id, rev.id, sett.id]));
  });

  it("matches regardless of print order (reversal listed first)", () => {
    const rev = row("REV PREAUTH MYDEBIT", 500, "2026-04-14", { direction: "credit" });
    const auth = row("PRE-AUTH MYDEBIT", 500, "2026-04-14");
    const sett = row("PAYMENT VIA MYDEBIT", 500, "2026-04-14");

    const result = collapseEvents([rev, auth, sett]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.state).toBe("resolved");
    expect(result.events[0]!.amountCents).toBe(500);
  });

  it("collapses when the settlement amount differs (foreign currency)", () => {
    const auth = row("PRE-AUTH DEBIT", 5268, "2026-06-10", { merchant: "DIGITALOCEAN.COM" });
    const rev = row("PRE-AUTH REFUND", 5268, "2026-06-10", { merchant: "DIGITALOCEAN.COM", direction: "credit" });
    const sett = row("SALE DEBIT", 5217, "2026-06-10", { merchant: "DIGITALOCEAN.COM" });

    const result = collapseEvents([auth, rev, sett]);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.state).toBe("resolved");
    expect(event.amountCents).toBe(5217); // the settlement, not the auth
    expect(event.rowIds).toHaveLength(3);
  });
});

describe("incomplete and two-row shapes", () => {
  it("nets an auth + reversal with no settlement to a cancelled event", () => {
    const auth = row("PRE-AUTH MYDEBIT", 1250, "2026-06-01");
    const rev = row("REV PREAUTH MYDEBIT", 1250, "2026-06-01", { direction: "credit" });

    const result = collapseEvents([auth, rev]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.state).toBe("cancelled");
    expect(result.events[0]!.amountCents).toBe(0);
    expect(result.events[0]!.rowIds).toHaveLength(2);
  });

  it("leaves an auth with no reversal pending", () => {
    const auth = row("PRE-AUTH MYDEBIT", 1250, "2026-06-01");
    const result = collapseEvents([auth]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.state).toBe("pending");
    expect(result.events[0]!.amountCents).toBe(1250);
  });

  it("collapses a settlement-reversal against its settlement, no auth", () => {
    const sett = row("PAYMENT VIA MYDEBIT", 100, "2026-05-02", { merchant: "APSB.MX.COVA" });
    const rev = row("PYMT VIA MYDEBIT RE", 100, "2026-05-09", { merchant: "APSB.MX.COVA", direction: "credit" });

    const result = collapseEvents([sett, rev]);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.state).toBe("resolved");
    expect(event.amountCents).toBe(0); // settled then refunded, nets to zero
    expect(new Set(event.rowIds)).toEqual(new Set([sett.id, rev.id]));
  });
});

describe("orphans at capture boundaries", () => {
  it("leaves an auth-reversal with no authorisation as an orphan", () => {
    const rev = row("REV PREAUTH MYDEBIT", 500, "2026-05-01", { direction: "credit" });
    const result = collapseEvents([rev]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.state).toBe("orphan");
    expect(result.events[0]!.rowIds).toEqual([rev.id]);
  });

  it("leaves a settlement-reversal with no settlement as an orphan", () => {
    const rev = row("PYMT VIA MYDEBIT RE", 100, "2026-05-01", { direction: "credit" });
    const result = collapseEvents([rev]);
    expect(result.events[0]!.state).toBe("orphan");
  });

  it("re-resolves an orphan when the missing half arrives in a later batch", () => {
    // batch 1: only the reversal is in scope
    const rev = row("REV PREAUTH MYDEBIT", 750, "2026-05-01", { direction: "credit" });
    expect(collapseEvents([rev]).events[0]!.state).toBe("orphan");

    // batch 2 supplies the authorisation; re-running over the union collapses it
    const auth = row("PRE-AUTH MYDEBIT", 750, "2026-04-29");
    const result = collapseEvents([rev, auth]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.state).toBe("cancelled");
    expect(result.events[0]!.rowIds).toHaveLength(2);
  });
});

describe("singles and separation", () => {
  it("passes non-card rows through as their own resolved events", () => {
    const a = row("MAE QR", 1500, "2026-06-01", { merchant: "SARAH" });
    const b = row(null, 800, "2026-06-01", { merchant: "MIXUE" });
    const result = collapseEvents([a, b]);
    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.state === "resolved")).toBe(true);
    expect(eventOf(result, a.id).rowIds).toEqual([a.id]);
  });

  it("does not merge two settlements at the same merchant beyond the window", () => {
    const early = row("PAYMENT VIA MYDEBIT", 4300, "2026-06-01");
    const late = row("PAYMENT VIA MYDEBIT", 4300, "2026-06-20"); // 19 days later
    const result = collapseEvents([early, late]);
    expect(result.events).toHaveLength(2);
  });

  it("assigns every input row to exactly one event", () => {
    const rows = [
      row("PRE-AUTH MYDEBIT", 1250, "2026-06-01"),
      row("REV PREAUTH MYDEBIT", 1250, "2026-06-01", { direction: "credit" }),
      row("PAYMENT VIA MYDEBIT", 1250, "2026-06-01"),
      row("MAE QR", 900, "2026-06-02", { merchant: "ALI" }),
    ];
    const result = collapseEvents(rows);
    expect(result.rows).toHaveLength(4);
    const allRowIds = result.events.flatMap((e) => e.rowIds);
    expect(new Set(allRowIds)).toEqual(new Set(rows.map((r) => r.id)));
    expect(allRowIds).toHaveLength(4); // no row counted twice
  });
});

describe("against the parsed history fixture", () => {
  it("collapses a triplet split across prints into one event", () => {
    const text = readFileSync(
      join(process.cwd(), "tests", "fixtures", "history", "triplet-across-prints.txt"),
      "utf8",
    );
    const { rows } = parse(text.replace(/\n$/, "").split("\n"));

    const input: CollapseInput[] = rows.map((r) => ({
      id: String(r.sourceLineNo),
      bookedAt: r.bookedAt,
      merchantKey: r.descriptionNormalized,
      type: r.rail,
      amountCents: r.amountCents,
      direction: r.direction,
    }));

    const result = collapseEvents(input);

    // PETRON's auth + reversal + settlement collapse; the unrelated MAE QR
    // row stays a single. Two events, four rows.
    expect(result.events).toHaveLength(2);
    const petron = result.events.find((e) => e.rowIds.length === 3)!;
    expect(petron.state).toBe("resolved");
    expect(petron.amountCents).toBe(5000);
    const single = result.events.find((e) => e.rowIds.length === 1)!;
    expect(single.state).toBe("resolved");
    expect(single.amountCents).toBe(750);
  });
});
