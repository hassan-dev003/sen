import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extract, RasterisedCaptureError } from "./extract";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "history");

function bytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

describe("extract", () => {
  it("returns lines in reading order from a browser-exported PDF", async () => {
    const lines = await extract(bytes("text-layer.pdf"));
    expect(lines.length).toBeGreaterThan(0);
    // furniture and the three-line blocks both come through
    expect(lines).toContain("MAE QR SARAH RISHAD HAMID * 255626498Q");
    expect(lines).toContain("24 Jul 2026");
    expect(lines).toContain("- RM 23.00");
    // no blank lines survive
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });

  it("throws RasterisedCaptureError on a zero-text-layer PDF", async () => {
    await expect(extract(bytes("rasterised.pdf"))).rejects.toBeInstanceOf(
      RasterisedCaptureError,
    );
  });

  it("names the cause and the fix in the error message", async () => {
    await expect(extract(bytes("rasterised.pdf"))).rejects.toThrow(
      /Save as PDF/,
    );
  });
});
