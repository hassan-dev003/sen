/**
 * Generates the M2U history test fixtures. NOT part of the app or CI — a local
 * dev tool, run with `pnpm fixtures:generate`. Needs a Chromium binary
 * (Playwright's, pre-installed in the dev environment).
 *
 * Why go through a browser at all: the parse-layer `.txt` fixtures must reflect
 * the shape a real capture produces — line order, how furniture flattens, where
 * breaks fall — not a hand-typed guess (docs/roadmap.md, Sprint 2). So every
 * scenario is rendered to HTML, printed to PDF exactly as a real capture is
 * (browser "Save as PDF"), then run back through `extract`. The content is
 * synthetic; the shape is real.
 *
 * All bank data here is invented. Never generate a fixture from a real capture.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { extract } from "@/lib/sources/m2u-history/extract";

const execFileAsync = promisify(execFile);
const OUT_DIR = join(process.cwd(), "tests", "fixtures", "history");

function chromiumPath(): string {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  const dirs = existsSync(base) ? readdirSync(base) : [];
  const dir = dirs.find((d) => d.startsWith("chromium-"));
  if (!dir) throw new Error(`No Chromium under ${base}. Is Playwright installed?`);
  return join(base, dir, "chrome-linux", "chrome");
}

const CHROME = chromiumPath();

function html(lines: string[]): string {
  const body = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 330mm 210mm; margin: 8mm; }
    body { font: 11px monospace; }
    div { white-space: nowrap; }
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function renderPdf(lines: string[]): Promise<Uint8Array> {
  const work = join(tmpdir(), `sen-fixt-${Math.random().toString(36).slice(2)}`);
  await mkdir(work, { recursive: true });
  const htmlPath = join(work, "page.html");
  const pdfPath = join(work, "out.pdf");
  await writeFile(htmlPath, html(lines), "utf8");
  await execFileAsync(CHROME, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ]);
  const bytes = new Uint8Array(await readFile(pdfPath));
  await rm(work, { recursive: true, force: true });
  return bytes;
}

async function renderRasterisedPdf(lines: string[]): Promise<Uint8Array> {
  const work = join(tmpdir(), `sen-rast-${Math.random().toString(36).slice(2)}`);
  await mkdir(work, { recursive: true });
  const htmlPath = join(work, "page.html");
  const pngPath = join(work, "shot.png");
  await writeFile(htmlPath, html(lines), "utf8");
  await execFileAsync(CHROME, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1100,700",
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ]);
  const png = await readFile(pngPath);
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  await rm(work, { recursive: true, force: true });
  return pdf.save();
}

// --- Scenario content (all synthetic) --------------------------------------

const FURNITURE_HEAD = [
  "ACCOUNTS · VIEW STATEMENTS · Savings Account-i (Savings) · 5141XXXXXX88",
  "Available Balance RM 5,234.10 · Current balance RM 5,234.10 · One-day float RM 0.00 · Two-day float RM 0.00",
  "Late clearing/Outstation cheque float RM 0.00 · DETAILS AMOUNT",
  "All Transaction History · Last 30 days",
];
const FURNITURE_FOOT = [
  "24 Jul 2026, 10:32 AM · Maybank2u | Maybank Malaysia · https://www.maybank2u.com.my · 1/1",
  "© 2026 Malayan Banking Berhad (3813-K) · Terms & Conditions • Security and Privacy",
];

type Block = [desc: string, date: string, amount: string];
const block = (b: Block): string[] => [b[0], b[1], b[2]];

const CLEAN_BLOCKS: Block[] = [
  ["MAE QR SARAH RISHAD HAMID * 255626498Q", "24 Jul 2026", "- RM 23.00"],
  ["DUITNOW QR MIXUE MID VALLEY * QR71429243", "24 Jul 2026", "- RM 8.50"],
  ["PAYMENT VIA MYDEBIT TOUCH N GO * 126641398Q", "23 Jul 2026", "- RM 4.30"],
  ["PAYMENT VIA MYDEBIT RAPID KL LRT * 370647823Q", "23 Jul 2026", "- RM 2.10"],
  ["SALE DEBIT SHOPEE * 11113411886488", "22 Jul 2026", "- RM 59.90"],
  ["DUITNOW QR SETEL PETROL * QR75812013", "22 Jul 2026", "- RM 50.00"],
  ["MAE QR AHMAD FAIZAL * 445218832Q", "21 Jul 2026", "RM 100.00"],
  ["SVG GIRO CR ACME CORP SALARY 0726", "21 Jul 2026", "RM 6,500.00"],
  ["PAYMENT VIA MYDEBIT MCDONALDS KLCC * 998812376Q", "20 Jul 2026", "- RM 18.55"],
  ["PROFIT PAID", "20 Jul 2026", "RM 3.21"],
];

const SCENARIOS: Record<string, string[]> = {
  "clean-print": [
    ...FURNITURE_HEAD,
    ...CLEAN_BLOCKS.flatMap(block),
    ...FURNITURE_FOOT,
  ],
  "clipped-first-row": [
    ...FURNITURE_HEAD,
    ...block(["MAE QR KEDAI RUNCIT ALI * QR90000001", "24 Jul 2026", "- RM 12.00"]),
    // page 2 repeats the sticky header, visually clipping the next row
    ...FURNITURE_HEAD,
    ...block(["DUITNOW QR WATSONS KL * QR90000002", "23 Jul 2026", "- RM 34.90"]),
    ...FURNITURE_FOOT,
  ],
  "same-day-repeats": [
    ...FURNITURE_HEAD,
    ...block(["MAE QR KOPITIAM 88 * QR11111111", "23 Jul 2026", "- RM 5.00"]),
    ...block(["MAE QR KOPITIAM 88 * QR22222222", "23 Jul 2026", "- RM 5.00"]),
    ...FURNITURE_FOOT,
  ],
  "growing-day": [
    ...FURNITURE_HEAD,
    // newest first: a third same-day row has landed on top since the last capture
    ...block(["MAE QR KOPITIAM 88 * QR33333333", "23 Jul 2026", "- RM 5.00"]),
    ...block(["MAE QR KOPITIAM 88 * QR22222222", "23 Jul 2026", "- RM 5.00"]),
    ...block(["MAE QR KOPITIAM 88 * QR11111111", "23 Jul 2026", "- RM 5.00"]),
    ...FURNITURE_FOOT,
  ],
  "triplet-across-prints": [
    ...FURNITURE_HEAD,
    // auth appears first; its settlement and reversal are separated by an
    // unrelated row, as if they came from a different print
    ...block(["PRE-AUTH MYDEBIT PETRON SIMPANG AMPA* QR30000001", "22 Jul 2026", "- RM 50.00"]),
    ...block(["MAE QR NASI LEMAK CORNER * QR30000099", "22 Jul 2026", "- RM 7.50"]),
    ...block(["REV PREAUTH MYDEBIT PETRON SIMPANG AMPA* QR30000002", "22 Jul 2026", "RM 50.00"]),
    ...block(["PAYMENT VIA MYDEBIT PETRON SIMPANG AMPA* QR30000003", "22 Jul 2026", "- RM 50.00"]),
    ...FURNITURE_FOOT,
  ],
  "rail-variants": [
    ...FURNITURE_HEAD,
    ...block(["MAE QR SITI AMINAH * 255626001Q", "24 Jul 2026", "- RM 10.00"]),
    ...block(["DUITNOW QR- ZUS COFFEE * QR40000001", "24 Jul 2026", "- RM 11.50"]),
    ...block(["PAYMENT VIA MYDEBIT GUARDIAN KL * 126640002Q", "23 Jul 2026", "- RM 22.20"]),
    ...block(["SALE DEBIT LAZADA * 40000000000003", "23 Jul 2026", "- RM 88.00"]),
    ...block(["PRE-AUTH MYDEBIT SHELL SEKSYEN 7* QR40000004", "22 Jul 2026", "- RM 60.00"]),
    ...block(["REV PREAUTH MYDEBIT* SHELL SEKSYEN 7* QR40000005", "22 Jul 2026", "RM 60.00"]),
    ...block(["PYMT VIA MYDEBIT RE APSB.MX.COVA_SQUARE* QR40000006", "21 Jul 2026", "RM 1.00"]),
    ...FURNITURE_FOOT,
  ],
  "hyphenated-merchant": [
    ...FURNITURE_HEAD,
    ...block(["DUITNOW QR LCSB - Genting Semp* QR71429243", "24 Jul 2026", "- RM 15.00"]),
    ...FURNITURE_FOOT,
  ],
  "balance-anchor": [
    ...FURNITURE_HEAD,
    ...block(["MAE QR HANI STORE * QR50000001", "24 Jul 2026", "- RM 9.90"]),
    ...FURNITURE_FOOT,
  ],
  "nonzero-float": [
    "ACCOUNTS · VIEW STATEMENTS · Savings Account-i (Savings) · 5141XXXXXX88",
    "Available Balance RM 5,234.10 · Current balance RM 5,234.10 · One-day float RM 12.30 · Two-day float RM 0.00",
    "Late clearing/Outstation cheque float RM 0.00 · DETAILS AMOUNT",
    "All Transaction History · Last 30 days",
    ...block(["MAE QR HANI STORE * QR50000002", "24 Jul 2026", "- RM 9.90"]),
    ...FURNITURE_FOOT,
  ],
};

async function main(): Promise<void> {
  if (!existsSync(CHROME)) throw new Error(`Chromium not found at ${CHROME}`);
  await mkdir(OUT_DIR, { recursive: true });

  // Parse-layer .txt fixtures, each round-tripped through a real print + extract.
  for (const [name, lines] of Object.entries(SCENARIOS)) {
    const bytes = await renderPdf(lines);
    const extracted = await extract(bytes);
    await writeFile(join(OUT_DIR, `${name}.txt`), extracted.join("\n") + "\n", "utf8");
    console.log(`  ${name}.txt — ${extracted.length} lines`);
  }

  // Extract-layer binary fixtures — the only PDFs in the repo.
  const textLayer = await renderPdf(SCENARIOS["clean-print"]!);
  await writeFile(join(OUT_DIR, "text-layer.pdf"), textLayer);
  console.log("  text-layer.pdf");

  const rasterised = await renderRasterisedPdf([
    "ACCOUNTS · VIEW STATEMENTS · Savings Account-i",
    "MAE QR SARAH RISHAD HAMID * 255626498Q",
    "24 Jul 2026",
    "- RM 23.00",
  ]);
  await writeFile(join(OUT_DIR, "rasterised.pdf"), rasterised);
  console.log("  rasterised.pdf");

  const existing = await readdir(OUT_DIR);
  console.log(`Fixtures written to ${OUT_DIR} (${existing.length} files).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
