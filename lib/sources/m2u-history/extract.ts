/**
 * The extract layer: PDF bytes -> lines of text. Pure — it receives a
 * `Uint8Array` and returns strings; receiving bytes is not file-system access
 * (AGENTS.md rule 6). This is the ONLY module in the codebase permitted a PDF
 * dependency (D10, D20).
 *
 * The dependency is Mozilla's pdf.js (`pdfjs-dist`, legacy build), run on the
 * main thread with the worker disabled so it works on Vercel's serverless
 * runtime with no native binaries. Text extraction needs neither canvas nor
 * fonts, so none of pdf.js's rendering paths are pulled in.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Thrown when a PDF has no extractable text — the signature of a rasterised
 * print (Windows "Microsoft Print to PDF" rather than the browser's own "Save
 * as PDF"; see docs/history-import.md, D17). The ingest layer catches this and
 * renders wording about the print destination for a human (Sprint 3); throwing
 * it is all the extract layer does.
 */
export class RasterisedCaptureError extends Error {
  constructor() {
    super(
      "This PDF has no text layer, which means it was rasterised. Re-export it " +
        "using the browser's own “Save as PDF”, not “Microsoft Print to PDF”.",
    );
    this.name = "RasterisedCaptureError";
  }
}

interface PdfTextItem {
  str: string;
  hasEOL: boolean;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof (item as { str: unknown }).str === "string"
  );
}

/**
 * Turn PDF bytes into text lines in reading order.
 *
 * pdf.js emits one text item per run and a zero-width item with `hasEOL` at
 * each line break; we accumulate runs and cut a line on every EOL. Blank lines
 * are dropped — the history format carries no meaning in them and the parser
 * segments by content, not position. Concatenating every page's lines is
 * deliberate: a block clipped by the sticky header on page 2 still extracts in
 * full (docs/history-import.md).
 *
 * @throws {RasterisedCaptureError} when the document yields no text at all.
 */
export async function extract(bytes: Uint8Array): Promise<string[]> {
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const lines: string[] = [];
  let charCount = 0;

  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();

      let current = "";
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        current += item.str;
        charCount += item.str.length;
        if (item.hasEOL) {
          const trimmed = current.trim();
          if (trimmed.length > 0) lines.push(trimmed);
          current = "";
        }
      }
      const tail = current.trim();
      if (tail.length > 0) lines.push(tail);
    }
  } finally {
    await loadingTask.destroy();
  }

  if (charCount === 0) {
    throw new RasterisedCaptureError();
  }

  return lines;
}
