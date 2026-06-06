import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const DOC_KINDS = ['sales', 'operations', 'quarterly', 'annual'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface AssetDocument {
  name: string;
  type: 'pdf';
  ipfs: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Validate the period token for a given kind. Period format depends on kind:
 *   sales | operations -> YYYY-MM
 *   quarterly          -> YYYY-Qn (n = 1-4)
 *   annual             -> YYYY
 * Throws with a descriptive message on mismatch.
 */
export function validatePeriod(period: string, kind: DocKind): void {
  if (kind === 'sales' || kind === 'operations') {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error(`Bad month "${period}" for ${kind}: expected YYYY-MM`);
    }
    const mm = Number(period.slice(5, 7));
    if (mm < 1 || mm > 12) {
      throw new Error(`Bad month "${period}": month must be 01-12`);
    }
  } else if (kind === 'quarterly') {
    if (!/^\d{4}-Q[1-4]$/.test(period)) {
      throw new Error(`Bad period "${period}" for quarterly: expected YYYY-Qn (n=1-4)`);
    }
  } else if (kind === 'annual') {
    if (!/^\d{4}$/.test(period)) {
      throw new Error(`Bad period "${period}" for annual: expected YYYY`);
    }
  }
}

/**
 * Period + kind -> display name shown in the document hub. Examples:
 *   "2026-04" + "sales"     -> "April 2026 Sales Report"
 *   "2026-04" + "operations"-> "April 2026 Operations Report"
 *   "2026-Q1" + "quarterly" -> "Q1 2026 Operations Report"
 *   "2025"    + "annual"    -> "2025 Annual Operations Report"
 */
export function docDisplayName(period: string, kind: DocKind): string {
  if (kind === 'sales' || kind === 'operations') {
    const [yearStr, monthStr] = period.split('-');
    const monthName = MONTH_NAMES[parseInt(monthStr, 10) - 1];
    const kindLabel = kind === 'sales' ? 'Sales' : 'Operations';
    return `${monthName} ${yearStr} ${kindLabel} Report`;
  }
  if (kind === 'quarterly') {
    const [yearStr, quarter] = period.split('-'); // quarter like "Q1"
    return `${quarter} ${yearStr} Operations Report`;
  }
  // annual
  return `${period} Annual Operations Report`;
}

/**
 * Merge incoming entries into existing, keyed by `name`. Incoming overrides a
 * same-named existing entry in place; genuinely new entries are appended.
 * Pure — does not mutate inputs.
 */
export function mergeDocuments(
  existing: AssetDocument[],
  incoming: AssetDocument[]
): AssetDocument[] {
  const result = existing.map((doc) => ({ ...doc }));
  for (const entry of incoming) {
    const idx = result.findIndex((d) => d.name === entry.name);
    if (idx >= 0) result[idx] = { ...entry };
    else result.push({ ...entry });
  }
  return result;
}

const SOFFICE_MAC_APP = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

/** Resolve the soffice binary: $SOFFICE_BIN, the macOS app bundle, else bare "soffice" (PATH). */
function resolveSofficeBin(): string {
  if (process.env.SOFFICE_BIN) return process.env.SOFFICE_BIN;
  if (fs.existsSync(SOFFICE_MAC_APP)) return SOFFICE_MAC_APP;
  return 'soffice';
}

const LIBREOFFICE_HINT =
  'LibreOffice (soffice) is required to convert .docx files. ' +
  'Install it with: brew install --cask libreoffice';

/**
 * Convert a report file to PDF bytes.
 * - .pdf  -> read through unchanged
 * - .docx -> LibreOffice headless conversion
 * Throws for any other extension, or with an install hint if soffice is missing.
 */
export async function convertToPdf(
  srcPath: string
): Promise<{ bytes: Buffer; filename: string }> {
  const ext = path.extname(srcPath).toLowerCase();

  if (ext === '.pdf') {
    return { bytes: fs.readFileSync(srcPath), filename: path.basename(srcPath) };
  }

  if (ext !== '.docx') {
    throw new Error(`Unsupported document "${srcPath}": expected .pdf or .docx`);
  }

  const soffice = resolveSofficeBin();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpdf-'));
  const pdfName = path.basename(srcPath, '.docx') + '.pdf';
  const pdfPath = path.join(tmpDir, pdfName);

  try {
    cp.execFileSync(
      soffice,
      [
        `-env:UserInstallation=file://${path.join(tmpDir, 'profile')}`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        tmpDir,
        srcPath,
      ],
      { stdio: 'pipe' }
    );
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to convert "${srcPath}" to PDF. ${LIBREOFFICE_HINT}\n  ${detail}`);
  }

  if (!fs.existsSync(pdfPath)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`soffice ran but produced no PDF for "${srcPath}". ${LIBREOFFICE_HINT}`);
  }

  const bytes = fs.readFileSync(pdfPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { bytes, filename: pdfName };
}
