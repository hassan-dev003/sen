import { describe, expect, it } from "vitest";
import { formatDayMonth, formatFullDate } from "./format";

describe("date formatting", () => {
  it("formats day and month", () => {
    expect(formatDayMonth("2026-07-23")).toBe("23 Jul");
    expect(formatDayMonth("2026-01-01")).toBe("1 Jan");
    expect(formatDayMonth("2026-12-09")).toBe("9 Dec");
  });

  it("formats the full date", () => {
    expect(formatFullDate("2026-07-23")).toBe("23 Jul 2026");
  });

  it("does not shift across a time-zone boundary", () => {
    // A naive `new Date("2026-07-01")` is midnight UTC and can render as Jun 30
    // west of Greenwich. The formatter must read the ISO string literally.
    expect(formatDayMonth("2026-07-01")).toBe("1 Jul");
    expect(formatFullDate("2026-07-01")).toBe("1 Jul 2026");
  });

  it("rejects a non-ISO date", () => {
    expect(() => formatDayMonth("23/07/2026")).toThrow();
  });
});
