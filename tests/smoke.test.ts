import { describe, expect, it } from "vitest";

/**
 * A single smoke test so the runner, CI wiring, and TypeScript config are
 * exercised from Sprint 0. Real domain tests arrive with lib/money in Sprint 1.
 */
describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
