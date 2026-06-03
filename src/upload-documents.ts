/**
 * Upload sales/operations reports to Pinata and merge them into the latest
 * month's metadata.json document hub for both tokens.
 *
 * Usage:
 *   npm run upload-docs -- \
 *     --doc 2026-04:sales:"/path/Egdon Apr26.pdf" \
 *     --doc 2026-04:operations:"/path/26_04_Albion_Report.docx" \
 *     [--into 2026-04]
 *
 * Staging only: writes metadata.json. Phase 2 emitMeta pins documents[] on-chain.
 */
import { config } from 'dotenv';
config();

import * as fs from 'node:fs';
import { TOKENS } from './constants';
import { resolveOutputDir } from './lib/validation';
import { uploadFileToPinata } from './lib/pinata';
import {
  DOC_KINDS,
  type DocKind,
  type AssetDocument,
  convertToPdf,
  docDisplayName,
  mergeDocuments,
} from './lib/documents';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RANGE_RE = /^(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})$/;

export interface DocArg {
  month: string;
  kind: DocKind;
  path: string;
}
export interface ParsedArgs {
  docs: DocArg[];
  into?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const docs: DocArg[] = [];
  let into: string | undefined;
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--into' && argv[i + 1]) {
      into = argv[++i];
    } else if (argv[i] === '--doc' && argv[i + 1]) {
      const value = argv[++i];
      const first = value.indexOf(':');
      const second = value.indexOf(':', first + 1);
      if (first < 0 || second < 0) {
        throw new Error(`Malformed --doc "${value}": expected <YYYY-MM>:<kind>:<path>`);
      }
      const month = value.slice(0, first);
      const kind = value.slice(first + 1, second);
      const path = value.slice(second + 1);
      if (!MONTH_RE.test(month)) {
        throw new Error(`Bad month in --doc "${value}": expected YYYY-MM`);
      }
      if (!(DOC_KINDS as readonly string[]).includes(kind)) {
        throw new Error(`Bad kind "${kind}" in --doc "${value}": expected ${DOC_KINDS.join(' | ')}`);
      }
      if (!path) throw new Error(`Missing path in --doc "${value}"`);
      const key = `${month}:${kind}`;
      if (seen.has(key)) throw new Error(`Duplicate (month, kind) in one run: ${key}`);
      seen.add(key);
      docs.push({ month, kind: kind as DocKind, path });
    }
  }

  if (docs.length === 0) {
    throw new Error('No --doc provided. Usage: --doc <YYYY-MM>:<sales|operations>:<path> [--into YYYY-MM]');
  }
  return { docs, into };
}

/** Latest output/ folder by end date of its YYYY-MM-DD_to_YYYY-MM-DD name. */
export function resolveLatestDateRange(outputBase: string): string {
  const ranges = fs
    .readdirSync(outputBase)
    .map((name) => ({ name, m: DATE_RANGE_RE.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => b.m[2].localeCompare(a.m[2]));
  if (ranges.length === 0) {
    throw new Error(`No date-range folders (YYYY-MM-DD_to_YYYY-MM-DD) found under ${outputBase}`);
  }
  return ranges[0].name;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputBase = 'output';
  const dateRange = args.into ? resolveOutputDir(args.into) : resolveLatestDateRange(outputBase);

  console.log(`\n=== Upload documents -> ${dateRange} ===\n`);

  // Convert + upload each file, building entries.
  const entries: AssetDocument[] = [];
  const summary: Array<{ month: string; kind: string; name: string; cid: string; url: string }> = [];
  for (const doc of args.docs) {
    if (!fs.existsSync(doc.path)) throw new Error(`File not found: ${doc.path}`);
    // Upload under a deterministic name; the entry's display name comes from docDisplayName.
    const { bytes } = await convertToPdf(doc.path);
    const upload = await uploadFileToPinata(bytes, `${doc.month}-${doc.kind}.pdf`, 'application/pdf');
    const name = docDisplayName(doc.month, doc.kind);
    entries.push({ name, type: 'pdf', ipfs: upload.cid });
    summary.push({ month: doc.month, kind: doc.kind, name, cid: upload.cid, url: upload.gatewayUrl });
    console.log(`  uploaded ${name} -> ${upload.cid}`);
  }

  // Merge into both tokens' metadata.
  for (const token of TOKENS) {
    const metadataPath = `${outputBase}/${dateRange}/${token.address}/metadata.json`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`metadata.json not found for ${token.symbol}: ${metadataPath}`);
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.asset.documents = mergeDocuments(metadata.asset.documents ?? [], entries);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    console.log(`  ${token.symbol}: documents[] now ${metadata.asset.documents.length} entries`);
  }

  console.log('\nSummary:');
  for (const s of summary) {
    console.log(`  ${s.month} ${s.kind.padEnd(10)} ${s.name}  [${s.cid}]  ${s.url}`);
  }
  console.log(
    '\nStaged into metadata.json (not committed, not pinned). ' +
      'Phase 2 emitMeta will pin documents[] on-chain.\n'
  );
}

// Only run when invoked directly, not when imported by tests.
const invokedDirectly =
  process.argv[1] !== undefined && /upload-documents\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error('\nFATAL:', error.message || error);
    process.exit(1);
  });
}
