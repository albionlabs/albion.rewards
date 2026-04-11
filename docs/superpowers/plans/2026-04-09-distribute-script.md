# Distribute Script Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tsx src/distribute.ts`, an interactive CLI that automates the 5-step monthly USDC rewards distribution for Albion SFT tokens on Base.

**Architecture:** Single orchestrator script (`src/distribute.ts`) calls focused library modules under `src/lib/`. Two pause points for Safe multisig signing. State lives in memory (no intermediate files). Fork simulation on Anvil before any Safe proposal.

**Tech Stack:** TypeScript (tsx), ethers v6, @safe-global/protocol-kit + api-kit, @rainlanguage/orderbook (DotrainOrderGui), pako + cbor-web (metadata CBOR encoding), Pinata v3 API, gh CLI (PR creation).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/constants.ts` | Modify: add all contract addresses, Safe addresses, URLs, magic numbers |
| `src/lib/pinata.ts` | Create: Pinata v3 API upload for CSVs and metadata JSON |
| `src/lib/metadata.ts` | Create: CBOR encoding pipeline, MetaBoard call builder, schema hash fetching, metadata JSON patching |
| `src/lib/safe.ts` | Create: Safe SDK wrapper — propose multisend tx, poll for execution, extract results |
| `src/lib/order.ts` | Create: DotrainOrderGui wrapper — fetch dotrain, build deployment calldata |
| `src/lib/simulation.ts` | Create: Anvil fork simulation — spawn anvil, impersonate Safe, execute calldata, verify events |
| `src/lib/github.ts` | Create: network.ts patching + PR creation via gh CLI |
| `src/lib/validation.ts` | Create: Pre-flight checks — CSV validation, merkle verification, balance checks, delegate checks |
| `src/distribute.ts` | Create: Main orchestrator — CLI args, interactive flow, Phase 1 + Phase 2 |

---

## Chunk 1: Foundation (constants, dependencies, pinata, metadata encoding)

### Task 1: Update constants.ts

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Read existing constants.ts**

Current file only has `ENERGY_FEILDS`. We need to add all addresses and config.

- [ ] **Step 2: Update constants.ts with all required values**

```ts
export const ENERGY_FEILDS = [
    '0xf836a500910453a397084ade41321ee20a5aade1',
    '0x1d57246fd0ba134d7cc78ddf3ed829379d95f4b7'
];

// Token addresses (lowercase for consistent comparison)
export const R1_TOKEN = '0xf836a500910453a397084ade41321ee20a5aade1';
export const R2_TOKEN = '0x1d57246fd0ba134d7cc78ddf3ed829379d95f4b7';

// Safe addresses
export const R1_SAFE = '0xa51fd23d6e2442805130eac0712f590691e91517';
export const R2_SAFE = '0x1c56fc57bbc18879d8059562a371722b682ca984';
export const METADATA_SAFE = '0x4e5bd3cf829010280f76754b49921d4e1448b8cf';

// Token config: maps token address to its Safe
export const TOKENS = [
  { address: R1_TOKEN, safe: R1_SAFE, symbol: 'ALB-WR1-R1' },
  { address: R2_TOKEN, safe: R2_SAFE, symbol: 'ALB-WR1-R2' },
] as const;

// Base chain
export const BASE_CHAIN_ID = 8453n;
export const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const WETH_BASE = '0x4200000000000000000000000000000000000006';
export const USDC_DECIMALS = 6;
// CSV amounts use 18 decimals (SFT token decimals), not USDC 6 decimals
export const CSV_AMOUNT_DECIMALS = 18;

// Rain / MetaBoard
export const METABOARD_ADDRESS = '0x59401c9302e79eb8ac6aea659b8b3ae475715e86';
export const CLAIMS_STRATEGY_URL = 'https://raw.githubusercontent.com/rainlanguage/rain.strategies/c2c4e2e75a034dd819110e223cb12344ea7ddf15/src/claims.rain';

// Metadata subgraph
export const METADATA_SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_clv14x04y9kzi01saerx7bxpg/subgraphs/metadata-base/2025-07-06-594f/gn';

// CBOR magic numbers (from operator.portal consts.ts)
export const MAGIC_NUMBERS = {
  RAIN_META_DOCUMENT: BigInt('0xff0a89c674ee7874'),
  OA_SCHEMA: BigInt('0xffa8e8a9b9cf4a31'),
  OA_HASH_LIST: BigInt('0xff9fae3cc645f463'),
  OA_STRUCTURE: BigInt('0xffc47a6299e8a911'),
} as const;

// MetaBoard ABI fragment
export const METABOARD_ABI = [
  {
    type: 'function',
    name: 'emitMeta',
    inputs: [
      { name: 'subject', type: 'bytes32', internalType: 'bytes32' },
      { name: 'meta', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/constants.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add distribution constants (addresses, ABIs, magic numbers)"
```

---

### Task 1.5: Install pako and cbor-web dependencies

These are needed by Task 3 (metadata.ts). The Safe SDK and orderbook packages are installed later in Task 5.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production deps**

Run: `npm install pako cbor-web`

- [ ] **Step 2: Install dev deps**

Run: `npm install -D @types/pako`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add pako and cbor-web dependencies for CBOR encoding"
```

---

### Task 2: Create src/lib/pinata.ts

**Files:**
- Create: `src/lib/pinata.ts`
- Test: `src/lib/__tests__/pinata.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// src/lib/__tests__/pinata.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadToPinata } from '../pinata';

describe('uploadToPinata', () => {
  beforeEach(() => {
    vi.stubEnv('PINATA_JWT', 'test-jwt-token');
    vi.stubEnv('PINATA_GATEWAY', 'https://gateway.pinata.cloud/ipfs');
  });

  it('sends correct request to Pinata v3 API', async () => {
    const mockResponse = {
      data: { cid: 'QmTestCid123', size: 100, created_at: '2026-04-09T00:00:00Z' },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await uploadToPinata('col1,col2\na,b', 'test.csv');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://uploads.pinata.cloud/v3/files');
    expect((options as RequestInit).method).toBe('POST');
    expect(result.cid).toBe('QmTestCid123');
    expect(result.gatewayUrl).toBe('https://gateway.pinata.cloud/ipfs/QmTestCid123');

    fetchSpy.mockRestore();
  });

  it('throws on non-200 response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    );

    await expect(uploadToPinata('data', 'file.csv')).rejects.toThrow('Pinata upload failed');
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/pinata.test.ts`
Expected: FAIL — module `../pinata` not found

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pinata.ts
import { config } from 'dotenv';
config();

export interface PinataUploadResult {
  cid: string;
  gatewayUrl: string;
}

export async function uploadToPinata(
  content: string,
  filename: string,
  contentType = 'text/csv'
): Promise<PinataUploadResult> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT environment variable is not set');

  const gateway = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

  const formData = new FormData();
  formData.append('file', new Blob([content], { type: contentType }), filename);
  formData.append('network', 'public');
  formData.append('name', filename);

  const response = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const cid = result.data.cid;

  return {
    cid,
    gatewayUrl: `${gateway}/${cid}`,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/pinata.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pinata.ts src/lib/__tests__/pinata.test.ts
git commit -m "feat: add Pinata v3 upload module"
```

---

### Task 3: Create src/lib/metadata.ts — CBOR encoding

**Files:**
- Create: `src/lib/metadata.ts`
- Test: `src/lib/__tests__/metadata.test.ts`

This module vendors the CBOR encoding pipeline from `operator.portal/src/lib/scripts/helpers.ts` and adds metadata JSON patching + schema hash fetching.

- [ ] **Step 1: Write the test file**

```ts
// src/lib/__tests__/metadata.test.ts
import { describe, it, expect } from 'vitest';
import {
  deflateJson,
  encodeCBORStructure,
  generateMetaboardSubject,
  buildMetadataHex,
} from '../metadata';

describe('deflateJson', () => {
  it('deflates a JSON string to a hex string starting with 0x', () => {
    const result = deflateJson('{"hello":"world"}');
    expect(result).toMatch(/^0x[0-9a-f]+$/);
    expect(result.length).toBeGreaterThan(4);
  });
});

describe('generateMetaboardSubject', () => {
  it('pads a token address to 32 bytes', () => {
    const subject = generateMetaboardSubject('0xf836a500910453a397084ade41321ee20a5aade1');
    expect(subject).toBe('0x000000000000000000000000f836a500910453a397084ade41321ee20a5aade1');
    expect(subject.length).toBe(66); // 0x + 64 hex chars
  });

  it('handles checksummed addresses', () => {
    const subject = generateMetaboardSubject('0xF836a500910453A397084ADe41321ee20a5AAde1');
    expect(subject).toBe('0x000000000000000000000000f836a500910453a397084ade41321ee20a5aade1');
  });
});

describe('encodeCBORStructure', () => {
  it('returns a hex string', () => {
    const result = encodeCBORStructure('{"test":true}', '0xabcdef');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('buildMetadataHex', () => {
  it('produces hex starting with rain meta document magic number', () => {
    const hex = buildMetadataHex('{"test":true}', '0xabcdef', 'QmTestCid');
    expect(hex).toMatch(/^0xff0a89c674ee7874/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/metadata.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metadata.ts
import pako from 'pako';
import { encodeCanonical } from 'cbor-web';
import { ethers } from 'ethers';
import { MAGIC_NUMBERS, METADATA_SUBGRAPH_URL } from '../constants';

// --- CBOR encoding (vendored from operator.portal helpers.ts) ---

export function deflateJson(data: string): string {
  const bytes = Uint8Array.from(pako.deflate(data));
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex = hex + bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function cborEncode(
  payload: string | ArrayBuffer,
  magicNumber: bigint,
  contentType: string | null,
  options: { contentEncoding?: string; schema?: string } | null
): string {
  const m = new Map<number | bigint, unknown>();
  m.set(0, payload);
  m.set(1, magicNumber);
  if (contentType) m.set(2, contentType);
  if (options) {
    if (options.contentEncoding) m.set(3, options.contentEncoding);
    if (options.schema) m.set(MAGIC_NUMBERS.OA_SCHEMA, options.schema);
  }
  // encodeCanonical may return Uint8Array in browser builds — wrap with Buffer for .toString('hex')
  return Buffer.from(encodeCanonical(m)).toString('hex').toLowerCase();
}

export function encodeCBORStructure(jsonString: string, schemaHash: string): string {
  const deflatedData = ethers.getBytes(deflateJson(jsonString)).buffer as ArrayBuffer;
  return cborEncode(deflatedData, MAGIC_NUMBERS.OA_STRUCTURE, 'application/json', {
    contentEncoding: 'deflate',
    schema: schemaHash,
  });
}

function encodeCBORHashList(cidString: string): string {
  return cborEncode(cidString, MAGIC_NUMBERS.OA_HASH_LIST, null, null);
}

// --- Public API ---

export function generateMetaboardSubject(tokenAddress: string): `0x${string}` {
  const clean = tokenAddress.replace(/^0x/i, '').toLowerCase();
  return `0x000000000000000000000000${clean}` as `0x${string}`;
}

/**
 * Build the full metadata hex string for emitMeta:
 * 0x + RAIN_META_DOCUMENT magic + encodedStructure + encodedHashList
 */
export function buildMetadataHex(
  jsonString: string,
  schemaHash: string,
  pinataCid: string
): string {
  const encodedStructure = encodeCBORStructure(jsonString, schemaHash);
  const encodedHashList = encodeCBORHashList(pinataCid);
  return (
    '0x' +
    MAGIC_NUMBERS.RAIN_META_DOCUMENT.toString(16).toLowerCase() +
    encodedStructure +
    encodedHashList
  );
}

// --- Schema hash fetching ---

/**
 * Fetch the schema hash from the latest on-chain metadata for a token.
 * Queries the metadata subgraph, decodes the CBOR, reads the OA_SCHEMA key.
 */
export async function fetchSchemaHash(tokenAddress: string): Promise<string> {
  const paddedSubject = generateMetaboardSubject(tokenAddress);

  const query = `{
    metaV1S(
      where: { subject: "${paddedSubject}" }
      orderBy: transaction__timestamp
      orderDirection: desc
      first: 1
    ) {
      meta
    }
  }`;

  const response = await fetch(METADATA_SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Metadata subgraph request failed: ${response.status}`);
  }

  const data = await response.json();
  const entries = data?.data?.metaV1S;
  if (!entries || entries.length === 0) {
    throw new Error(`No metadata found for token ${tokenAddress}`);
  }

  // Strip 18-character prefix (0x + 8 bytes magic) and decode CBOR
  // Must convert hex string to Buffer — cbor-web expects binary, not hex strings
  const { decodeAllSync } = await import('cbor-web');
  const hexPayload = entries[0].meta.slice(18);
  const buffer = Buffer.from(hexPayload, 'hex');
  const decoded = decodeAllSync(buffer);
  const container = Array.isArray(decoded) ? decoded[0] : null;

  if (container instanceof Map) {
    const hash = container.get(MAGIC_NUMBERS.OA_SCHEMA);
    if (typeof hash === 'string') return hash;
  }

  throw new Error(`Could not extract schema hash from metadata for ${tokenAddress}`);
}

// --- Metadata JSON patching ---

export interface PayoutPatch {
  date: string;
  txHash: string;
  orderHash: string;
}

/**
 * Patch the pending payoutData entry in a metadata JSON object.
 * Finds the first entry with empty date/txHash/orderHash and fills them in.
 * Returns the modified object (mutates in place).
 */
export function patchPendingPayout(
  metadata: Record<string, unknown>,
  patch: PayoutPatch
): Record<string, unknown> {
  const payoutData = metadata.payoutData as Array<{
    tokenPayout: { date: string; txHash: string; orderHash: string };
  }>;

  if (!Array.isArray(payoutData)) {
    throw new Error('metadata.payoutData is not an array');
  }

  const pending = payoutData.find(
    (entry) =>
      !entry.tokenPayout.date || !entry.tokenPayout.txHash || !entry.tokenPayout.orderHash
  );

  if (!pending) {
    throw new Error('No pending payoutData entry found (all entries already have date/txHash/orderHash)');
  }

  pending.tokenPayout.date = patch.date;
  pending.tokenPayout.txHash = patch.txHash;
  pending.tokenPayout.orderHash = patch.orderHash;

  return metadata;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/metadata.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/metadata.ts src/lib/__tests__/metadata.test.ts
git commit -m "feat: add metadata CBOR encoding and patching module"
```

---

### Task 4: Create src/lib/validation.ts — Pre-flight checks

**Files:**
- Create: `src/lib/validation.ts`
- Test: `src/lib/__tests__/validation.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// src/lib/__tests__/validation.test.ts
import { describe, it, expect } from 'vitest';
import { resolveOutputDir, validateCsvTotal, findPendingPayoutEntry } from '../validation';

describe('resolveOutputDir', () => {
  it('converts --month 2026-03 to date range', () => {
    const result = resolveOutputDir('2026-03');
    expect(result).toBe('2026-03-01_to_2026-03-31');
  });

  it('handles February non-leap year', () => {
    const result = resolveOutputDir('2026-02');
    expect(result).toBe('2026-02-01_to_2026-02-28');
  });

  it('handles February leap year', () => {
    const result = resolveOutputDir('2028-02');
    expect(result).toBe('2028-02-01_to_2028-02-29');
  });

  it('handles December', () => {
    const result = resolveOutputDir('2026-12');
    expect(result).toBe('2026-12-01_to_2026-12-31');
  });
});

describe('validateCsvTotal', () => {
  it('returns true when CLI amount matches CSV total (18 decimal CSV)', () => {
    // CLI amount is human-readable USDC (e.g. 728.45)
    // CSV amounts use 18 decimals (SFT token decimals)
    const csvAmountsWei = [
      500000000000000000000n, // 500 * 1e18
      228450000000000000000n, // 228.45 * 1e18
    ]; // total = 728.45 USDC
    expect(validateCsvTotal(728.45, csvAmountsWei)).toBe(true);
  });

  it('returns false on mismatch', () => {
    const csvAmountsWei = [500000000000000000000n]; // 500 USDC
    expect(validateCsvTotal(1234.56, csvAmountsWei)).toBe(false);
  });
});

describe('findPendingPayoutEntry', () => {
  it('finds entry with empty date/txHash/orderHash', () => {
    const metadata = {
      payoutData: [
        { tokenPayout: { date: '2025-09-17', txHash: '0xabc', orderHash: '0xdef' } },
        { tokenPayout: { date: '', txHash: '', orderHash: '', totalPayout: 100 } },
      ],
    };
    const entry = findPendingPayoutEntry(metadata);
    expect(entry).toBeDefined();
    expect(entry!.tokenPayout.totalPayout).toBe(100);
  });

  it('returns null when no pending entry', () => {
    const metadata = {
      payoutData: [
        { tokenPayout: { date: '2025-09-17', txHash: '0xabc', orderHash: '0xdef' } },
      ],
    };
    expect(findPendingPayoutEntry(metadata)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/validation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/validation.ts
import fs from 'fs';
import { ethers } from 'ethers';
import { SimpleMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256 } from 'ethers';
import { USDC_BASE, USDC_DECIMALS, CSV_AMOUNT_DECIMALS, TOKENS } from '../constants';

/**
 * Convert --month YYYY-MM to date range string: YYYY-MM-DD_to_YYYY-MM-DD
 */
export function resolveOutputDir(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const mon = parseInt(monthStr);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0); // day 0 of next month = last day of this month
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fmt(firstDay)}_to_${fmt(lastDay)}`;
}

/**
 * Validate that the CLI amount (human-readable USDC) matches the CSV total.
 * CSV amounts use 18 decimals (SFT token decimals), not USDC 6 decimals.
 * CLI amount is human-readable (e.g. 728.45).
 */
export function validateCsvTotal(cliAmount: number, csvAmountsWei: bigint[]): boolean {
  const totalWei = csvAmountsWei.reduce((sum, a) => sum + a, 0n);
  // Convert CLI amount to 18-decimal integer to match CSV format
  const cliWei = BigInt(Math.round(cliAmount * 10 ** CSV_AMOUNT_DECIMALS));
  return totalWei === cliWei;
}

/**
 * Find the pending payoutData entry (empty date/txHash/orderHash).
 */
export function findPendingPayoutEntry(
  metadata: Record<string, unknown>
): { tokenPayout: Record<string, unknown> } | null {
  const payoutData = metadata.payoutData as Array<{
    tokenPayout: { date: string; txHash: string; orderHash: string; [key: string]: unknown };
  }>;
  if (!Array.isArray(payoutData)) return null;

  const pending = payoutData.find(
    (entry) =>
      !entry.tokenPayout.date || !entry.tokenPayout.txHash || !entry.tokenPayout.orderHash
  );
  return pending ?? null;
}

/**
 * Parse a rewards CSV file. Returns array of [index, address, amount] tuples.
 */
export function parseCsv(csvPath: string): Array<[string, string, string]> {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  return lines.slice(1).map((line) => {
    const [index, address, amount] = line.split(',');
    return [index.trim(), address.trim(), amount.trim()];
  });
}

/**
 * Build merkle leaves from CSV data using the same encoding as src/merkle.ts.
 */
export function buildMerkleLeaves(csvData: Array<[string, string, string]>): string[] {
  return csvData.map(([index, address, amount]) => {
    const inputs = [BigInt(index), BigInt(address), BigInt(amount)];
    const packed = inputs.map((input) => input.toString(16).padStart(64, '0')).join('');
    return keccak256('0x' + packed);
  });
}

/**
 * Verify that a CSV produces the same merkle root as the saved tree JSON.
 */
export function verifyMerkleRoot(csvPath: string, treeJsonPath: string): {
  valid: boolean;
  computedRoot: string;
  savedRoot: string;
} {
  const csvData = parseCsv(csvPath);
  if (csvData.length !== 256) {
    throw new Error(`CSV must have exactly 256 entries, found ${csvData.length}`);
  }
  const leaves = buildMerkleLeaves(csvData);
  const tree = SimpleMerkleTree.of(leaves);
  const computedRoot = tree.root;

  const savedTree = JSON.parse(fs.readFileSync(treeJsonPath, 'utf8'));
  const loadedTree = SimpleMerkleTree.load(savedTree);
  const savedRoot = loadedTree.root;

  return { valid: computedRoot === savedRoot, computedRoot, savedRoot };
}

export interface TokenValidation {
  token: typeof TOKENS[number];
  dateRange: string;
  csvPath: string;
  treePath: string;
  metadataPath: string;
  csvData: Array<[string, string, string]>;
  merkleRoot: string;
}

/**
 * Run all pre-flight checks for a single token. Returns validated paths and data.
 */
export function validateToken(
  outputBase: string,
  dateRange: string,
  token: typeof TOKENS[number],
  cliAmount: number
): TokenValidation {
  const tokenDir = `${outputBase}/${dateRange}/${token.address}`;
  const csvPath = `${tokenDir}/rewards_${dateRange}.csv`;
  const treePath = `${tokenDir}/tree_${dateRange}.json`;
  const metadataPath = `${tokenDir}/metadata.json`;

  // Check files exist
  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  if (!fs.existsSync(treePath)) throw new Error(`Tree JSON not found: ${treePath}`);
  if (!fs.existsSync(metadataPath)) throw new Error(`metadata.json not found: ${metadataPath}`);

  // Parse CSV
  const csvData = parseCsv(csvPath);
  if (csvData.length !== 256) {
    throw new Error(`${token.symbol} CSV must have 256 entries, found ${csvData.length}`);
  }

  // Verify merkle root
  const merkleCheck = verifyMerkleRoot(csvPath, treePath);
  if (!merkleCheck.valid) {
    throw new Error(
      `${token.symbol} merkle root mismatch: computed=${merkleCheck.computedRoot}, saved=${merkleCheck.savedRoot}`
    );
  }

  // Validate amount
  const csvAmounts = csvData.map(([, , amount]) => BigInt(amount));
  if (!validateCsvTotal(cliAmount, csvAmounts)) {
    const totalWei = csvAmounts.reduce((sum, a) => sum + a, 0n);
    throw new Error(
      `${token.symbol} amount mismatch: CLI=${cliAmount} USDC, CSV total=${totalWei} wei`
    );
  }

  // Check pending metadata entry
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const pending = findPendingPayoutEntry(metadata);
  if (!pending) {
    throw new Error(`${token.symbol} has no pending payoutData entry in metadata.json`);
  }

  return {
    token,
    dateRange,
    csvPath,
    treePath,
    metadataPath,
    csvData,
    merkleRoot: merkleCheck.computedRoot,
  };
}

/**
 * Check USDC balance of a Safe is sufficient for the distribution amount.
 */
export async function checkUsdcBalance(
  provider: ethers.JsonRpcProvider,
  safeAddress: string,
  requiredAmountHuman: number
): Promise<void> {
  const usdc = new ethers.Contract(
    USDC_BASE,
    ['function balanceOf(address) view returns (uint256)'],
    provider
  );
  const balance: bigint = await usdc.balanceOf(safeAddress);
  const requiredWei = BigInt(Math.round(requiredAmountHuman * 10 ** USDC_DECIMALS));
  if (balance < requiredWei) {
    throw new Error(
      `Insufficient USDC in Safe ${safeAddress}: has ${balance}, needs ${requiredWei}`
    );
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/validation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/__tests__/validation.test.ts
git commit -m "feat: add pre-flight validation module"
```

---

## Chunk 2: Safe integration and order deployment

### Task 5: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production deps**

Run: `npm install @safe-global/protocol-kit @safe-global/api-kit @rainlanguage/orderbook`

(pako and cbor-web were already installed in Task 1.5)

- [ ] **Step 2: Verify installation**

Run: `npx tsc --noEmit src/constants.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add Safe SDK and orderbook dependencies"
```

Note: The `@rainlanguage/orderbook` version must be from raindex v4 to ensure `addOrder2` (not `addOrder3`). If `npm install` installs a newer version that uses `addOrder3`, pin to the exact v4 version. Check by looking at the installed package's exports for `DotrainOrderGui`.

---

### Task 6: Create src/lib/safe.ts — Safe SDK wrapper

**Files:**
- Create: `src/lib/safe.ts`

This module wraps the Safe SDK for proposing multisend transactions and polling for execution.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/safe.ts
import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { ethers } from 'ethers';
import { BASE_CHAIN_ID } from '../constants';

export interface ProposalResult {
  safeTxHash: string;
  safeUrl: string;
}

export interface ExecutionResult {
  transactionHash: string;
  safeTxHash: string;
}

/**
 * Propose a multisend Safe transaction.
 * @param safeAddress - The Safe to propose to
 * @param transactions - Array of {to, data, value} calls to bundle
 * @returns safeTxHash and Safe UI URL
 */
export async function proposeSafeTransaction(
  safeAddress: string,
  transactions: Array<{ to: string; data: string; value: string }>,
): Promise<ProposalResult> {
  const rpcUrl = process.env.BASE_RPC_URL;
  const signerKey = process.env.PROPOSER_PRIVATE_KEY;
  if (!rpcUrl) throw new Error('BASE_RPC_URL not set');
  if (!signerKey) throw new Error('PROPOSER_PRIVATE_KEY not set');

  // Safe SDK requires checksummed addresses — apply ethers.getAddress()
  const checksummedSafe = ethers.getAddress(safeAddress);

  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: signerKey,
    safeAddress: checksummedSafe,
  });

  const safeTransaction = await protocolKit.createTransaction({ transactions });
  const signedTx = await protocolKit.signTransaction(safeTransaction);
  const safeTxHash = await protocolKit.getTransactionHash(signedTx);

  const signer = new ethers.Wallet(signerKey);
  const proposerAddress = signer.address;

  const apiKit = new SafeApiKit({ chainId: BASE_CHAIN_ID });
  await apiKit.proposeTransaction({
    safeAddress: checksummedSafe,
    safeTransactionData: signedTx.data,
    safeTxHash,
    senderAddress: proposerAddress,
    senderSignature: signedTx.encodedSignatures(),
  });

  const safeUrl = `https://app.safe.global/transactions/tx?safe=base:${checksummedSafe}&id=multisig_${checksummedSafe}_${safeTxHash}`;

  return { safeTxHash, safeUrl };
}

/**
 * Poll Safe Transaction Service until a tx is executed.
 * @returns The on-chain transaction hash
 */
export async function waitForExecution(
  safeTxHash: string,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<ExecutionResult> {
  const intervalMs = options?.intervalMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 120000;

  const apiKit = new SafeApiKit({ chainId: BASE_CHAIN_ID });
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tx = await apiKit.getTransaction(safeTxHash);
    if (tx.isExecuted && tx.transactionHash) {
      return { transactionHash: tx.transactionHash, safeTxHash };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout: Safe tx ${safeTxHash} not executed within ${timeoutMs / 1000}s`);
}

/**
 * Check that the proposer is registered as a delegate on a Safe.
 */
export async function checkDelegate(safeAddress: string): Promise<void> {
  const signerKey = process.env.PROPOSER_PRIVATE_KEY;
  if (!signerKey) throw new Error('PROPOSER_PRIVATE_KEY not set');

  const signer = new ethers.Wallet(signerKey);
  const proposerAddress = signer.address.toLowerCase();

  const apiKit = new SafeApiKit({ chainId: BASE_CHAIN_ID });
  const delegates = await apiKit.getSafeDelegates({ safeAddress });

  const isDelegate = delegates.results.some(
    (d) => d.delegate.toLowerCase() === proposerAddress
  );

  if (!isDelegate) {
    throw new Error(
      `Proposer ${proposerAddress} is not a delegate on Safe ${safeAddress}. Add via Safe UI > Settings > Delegates.`
    );
  }
}

/**
 * Extract orderHash from AddOrderV2 event in a transaction receipt.
 * AddOrderV2 event signature: AddOrderV2(address sender, bytes32 orderHash, OrderV3 order)
 * The orderHash is the second parameter in the non-indexed event data.
 */
export function extractOrderHashFromReceipt(receipt: ethers.TransactionReceipt): string {
  // AddOrderV2 topic — computed from: keccak256("AddOrderV2(address,(address,(address,address,bytes),(address,bytes32)[],(address,bytes32)[],bytes32))")
  // We search for any log that has orderHash as a bytes32 in the data
  // The event is: AddOrderV2(address sender, OrderV3 order)
  // where sender is indexed, so orderHash is derived from the order struct

  // Strategy: look for logs from the orderbook that contain the AddOrderV2 event
  // The raindex v4 orderbook emits AddOrderV2 with the order hash
  // We need to find the right topic. For now, decode any log that matches.
  const iface = new ethers.Interface([
    'event AddOrderV2(address sender, bytes32 orderHash, (address owner, (address interpreter, address store, bytes bytecode) evaluable, (address token, bytes32 vaultId)[] validInputs, (address token, bytes32 vaultId)[] validOutputs, bytes32 nonce) order)',
  ]);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'AddOrderV2') {
        return parsed.args.orderHash;
      }
    } catch {
      // Not this event, continue
    }
  }

  throw new Error('AddOrderV2 event not found in transaction receipt');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only unrelated ones from existing code)

- [ ] **Step 3: Commit**

```bash
git add src/lib/safe.ts
git commit -m "feat: add Safe SDK wrapper for proposing and polling transactions"
```

---

### Task 7: Create src/lib/order.ts — DotrainOrderGui wrapper

**Files:**
- Create: `src/lib/order.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/order.ts
import { CLAIMS_STRATEGY_URL, USDC_BASE, WETH_BASE } from '../constants';

// Type for the deployment result from DotrainOrderGui
export interface DeploymentArgs {
  approvals: Array<{ token: string; calldata: string; to: string }>;
  deploymentCalldata: string;
  orderbookAddress: string;
  chainId: number;
}

/**
 * Fetch the claims .rain dotrain file from the pinned URL.
 */
async function fetchDotrain(): Promise<string> {
  const response = await fetch(CLAIMS_STRATEGY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch claims strategy: ${response.status}`);
  }
  return response.text();
}

/**
 * Build deployment transaction args for a claims order using the Rain SDK.
 *
 * Uses DotrainOrderGui (same pattern as raindex v4 webapp).
 * The SDK bundles addOrder2 + deposit2 into a single deploymentCalldata via TaskV1 post-action.
 *
 * @param merkleRoot - The hex merkle root from the CSV
 * @param depositAmountHuman - Human-readable USDC amount (e.g. "1234.56")
 * @param safeAddress - The Safe address that will own the order
 */
export async function buildOrderCalldata(
  merkleRoot: string,
  depositAmountHuman: string,
  safeAddress: string,
): Promise<DeploymentArgs> {
  // Dynamic import since @rainlanguage/orderbook may use WASM
  const { DotrainOrderGui } = await import('@rainlanguage/orderbook');

  const dotrain = await fetchDotrain();

  // The deployment key for claims orders — this needs to match what the .rain file exports.
  // Check the dotrain file for available deployment keys.
  const deploymentKey = 'base-claims';

  // Initialize the GUI (same as webapp's handleGuiInitialization)
  const gui = await DotrainOrderGui.newWithDeployment(dotrain, deploymentKey, () => {});

  // Configure tokens
  gui.setSelectToken('output', USDC_BASE);
  gui.setSelectToken('input', WETH_BASE);

  // Set the merkle root field
  gui.setFieldValue('root', merkleRoot);

  // Set deposit amount (human-readable string)
  gui.setDeposit('output', depositAmountHuman);

  // Get the transaction args
  const result = await gui.getDeploymentTransactionArgs(safeAddress);

  if ('error' in result) {
    throw new Error(`Failed to build deployment args: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to this file

Note: The exact API shape of `DotrainOrderGui` and the deployment key may need adjustment during implementation. The `.rain` file at `CLAIMS_STRATEGY_URL` defines available deployment keys. Read the fetched dotrain to find the correct key if `'base-claims'` doesn't work.

- [ ] **Step 3: Commit**

```bash
git add src/lib/order.ts
git commit -m "feat: add DotrainOrderGui wrapper for building order calldata"
```

---

## Chunk 3: Simulation, GitHub, and remaining utilities

### Task 8: Create src/lib/simulation.ts — Anvil fork simulation

**Files:**
- Create: `src/lib/simulation.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/simulation.ts
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { ethers } from 'ethers';

const ANVIL_PORT = 8546;

/**
 * Start an anvil fork of Base mainnet.
 * Returns the child process handle (caller must kill it).
 */
export function startAnvilFork(): ChildProcess {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error('BASE_RPC_URL not set');

  const anvil = spawn('anvil', [
    '--fork-url', rpcUrl,
    '--port', String(ANVIL_PORT),
    '--silent',
  ], { stdio: 'pipe' });

  return anvil;
}

/**
 * Wait for anvil to be ready by polling the RPC endpoint.
 */
export async function waitForAnvil(timeoutMs = 15000): Promise<ethers.JsonRpcProvider> {
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      await provider.getBlockNumber();
      return provider;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Anvil did not start within ${timeoutMs / 1000}s`);
}

/**
 * Simulate a Safe executing approve + deploy on an Anvil fork.
 * Verifies AddOrderV2 event is emitted.
 */
export async function simulateDeployment(
  provider: ethers.JsonRpcProvider,
  safeAddress: string,
  approvals: Array<{ to: string; calldata: string }>,
  deploymentCalldata: string,
  orderbookAddress: string,
): Promise<void> {
  // Impersonate the Safe
  await provider.send('anvil_impersonateAccount', [safeAddress]);

  // Fund the Safe with ETH for gas
  await provider.send('anvil_setBalance', [
    safeAddress,
    ethers.toQuantity(ethers.parseEther('10')),
  ]);

  const signer = await provider.getSigner(safeAddress);

  // Execute approval transactions
  for (const approval of approvals) {
    const tx = await signer.sendTransaction({
      to: approval.to,
      data: approval.calldata,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Simulation: approval tx failed for ${approval.to}`);
    }
  }

  // Execute deployment
  const deployTx = await signer.sendTransaction({
    to: orderbookAddress,
    data: deploymentCalldata,
  });
  const deployReceipt = await deployTx.wait();
  if (!deployReceipt || deployReceipt.status !== 1) {
    throw new Error('Simulation: deployment tx reverted');
  }

  // Verify AddOrderV2 event was emitted
  const iface = new ethers.Interface([
    'event AddOrderV2(address sender, bytes32 orderHash, (address, (address, address, bytes), (address, bytes32)[], (address, bytes32)[], bytes32) order)',
  ]);

  let foundEvent = false;
  for (const log of deployReceipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'AddOrderV2') {
        foundEvent = true;
        console.log(`  Simulation: AddOrderV2 emitted, orderHash=${parsed.args.orderHash}`);
        break;
      }
    } catch {
      // Not this event
    }
  }

  if (!foundEvent) {
    throw new Error('Simulation: AddOrderV2 event not found in deployment receipt');
  }

  // Stop impersonation
  await provider.send('anvil_stopImpersonatingAccount', [safeAddress]);
}

/**
 * Run the full simulation for both tokens.
 * Starts anvil, simulates both deployments, kills anvil.
 */
export async function runSimulation(
  tokenDeployments: Array<{
    safeAddress: string;
    symbol: string;
    approvals: Array<{ to: string; calldata: string }>;
    deploymentCalldata: string;
    orderbookAddress: string;
  }>
): Promise<void> {
  console.log('Starting Anvil fork simulation...');
  const anvil = startAnvilFork();

  try {
    const provider = await waitForAnvil();
    console.log('Anvil fork ready.');

    for (const deployment of tokenDeployments) {
      console.log(`Simulating ${deployment.symbol} deployment...`);
      await simulateDeployment(
        provider,
        deployment.safeAddress,
        deployment.approvals,
        deployment.deploymentCalldata,
        deployment.orderbookAddress,
      );
      console.log(`  ${deployment.symbol} simulation passed.`);
    }

    console.log('All simulations passed.');
  } finally {
    anvil.kill('SIGTERM');
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to this file

- [ ] **Step 3: Commit**

```bash
git add src/lib/simulation.ts
git commit -m "feat: add Anvil fork simulation module"
```

---

### Task 9: Create src/lib/github.ts — network.ts patching + PR

**Files:**
- Create: `src/lib/github.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/github.ts
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';

/**
 * Run a shell command synchronously. Throws on non-zero exit.
 */
function run(command: string, args: string[], options?: { cwd?: string }): string {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    cwd: options?.cwd,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

export interface IssuanceSiteUpdate {
  orderHash: string;
  csvCid: string;
  merkleRoot: string;
  csvGatewayUrl: string;
}

/**
 * Locate the Albion-issuance-site repo (sibling directory or configured path).
 * Set ISSUANCE_SITE_PATH in .env to override auto-detection.
 */
function findIssuanceSiteRepo(): string {
  const envPath = process.env.ISSUANCE_SITE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Check common sibling locations
  const candidates = [
    path.resolve(process.cwd(), '../Albion-issuance-site'),
    path.resolve(process.cwd(), '../../Albion-issuance-site'),
    path.resolve(process.cwd(), '../albion-issuance-site'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Cannot find Albion-issuance-site repo. Set ISSUANCE_SITE_PATH env var or clone as sibling directory.'
  );
}

/**
 * Update network.ts in the issuance-site repo with new claims entries.
 * Creates a new branch and opens a PR via gh CLI.
 *
 * @param r1Update - R1 token claims data
 * @param r2Update - R2 token claims data
 * @param month - The month string (e.g. "2026-03")
 */
export async function updateIssuanceSiteAndPR(
  r1Update: IssuanceSiteUpdate,
  r2Update: IssuanceSiteUpdate,
  month: string,
): Promise<string> {
  const repoPath = findIssuanceSiteRepo();
  const networkTsPath = path.join(repoPath, 'src/lib/network.ts');

  if (!fs.existsSync(networkTsPath)) {
    throw new Error(`network.ts not found at ${networkTsPath}`);
  }

  // Read current file to understand the structure
  let content = fs.readFileSync(networkTsPath, 'utf-8');

  // The exact patching strategy depends on the file structure.
  // We need to find the DEV_ENERGY_FIELDS claims arrays for each token
  // and append new entries. Read the existing entries as a template.
  //
  // This is intentionally left as a string-based patch that reads the current
  // structure. The field names and array structure should be confirmed by
  // reading the existing entries during implementation.

  // For now, create a new entry object for each token:
  const r1Entry = JSON.stringify({
    orderHash: r1Update.orderHash,
    csvLink: r1Update.csvGatewayUrl,
    expectedMerkleRoot: r1Update.merkleRoot,
    expectedContentHash: r1Update.csvCid,
  }, null, 2);

  const r2Entry = JSON.stringify({
    orderHash: r2Update.orderHash,
    csvLink: r2Update.csvGatewayUrl,
    expectedMerkleRoot: r2Update.merkleRoot,
    expectedContentHash: r2Update.csvCid,
  }, null, 2);

  // IMPLEMENTATION NOTE: During implementation, read the existing entries in network.ts
  // to discover the exact array name (e.g. `claims` inside DEV_ENERGY_FIELDS) and field
  // names. Then implement string-based patching:
  // 1. Find the closing `]` of the claims array for R1 token
  // 2. Insert the R1 entry before the `]`
  // 3. Repeat for R2 token
  // 4. Write the modified content back to disk
  //
  // Example regex approach:
  //   const pattern = new RegExp(`(${tokenAddress}[\\s\\S]*?claims:\\s*\\[)([\\s\\S]*?)(\\])`, 'i');
  //   content = content.replace(pattern, `$1$2  ${entryJson},\n  $3`);
  //
  // If the structure is too complex for regex, use a line-by-line parser.

  // For now, write the entries to the file:
  // This section must be completed during implementation after inspecting network.ts
  console.log(`R1 claims entry:\n${r1Entry}`);
  console.log(`R2 claims entry:\n${r2Entry}`);
  console.log(`\nnetwork.ts location: ${networkTsPath}`);

  // Git operations
  const branchName = `rewards-${month}`;

  // Ensure we're on a clean main branch first
  run('git', ['checkout', 'main'], { cwd: repoPath });
  run('git', ['pull', 'origin', 'main'], { cwd: repoPath });
  run('git', ['checkout', '-b', branchName], { cwd: repoPath });

  // After manual/automated patching of network.ts:
  run('git', ['add', 'src/lib/network.ts'], { cwd: repoPath });
  run('git', ['commit', '-m', `feat: add ${month} rewards claims data`], { cwd: repoPath });
  run('git', ['push', '-u', 'origin', branchName], { cwd: repoPath });

  // Create PR via gh CLI
  const prUrl = run('gh', [
    'pr', 'create',
    '--title', `Add ${month} rewards claims data`,
    '--body', `Automated by distribute.ts\n\nR1 orderHash: ${r1Update.orderHash}\nR2 orderHash: ${r2Update.orderHash}`,
    '--base', 'main',
  ], { cwd: repoPath });

  return prUrl;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to this file

- [ ] **Step 3: Commit**

```bash
git add src/lib/github.ts
git commit -m "feat: add issuance-site network.ts patching and PR creation"
```

---

### Task 10: Create src/lib/git.ts — Rewards repo git operations

**Files:**
- Create: `src/lib/git.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/git.ts
import { spawnSync } from 'node:child_process';

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

/**
 * Check that the git working tree is clean (no uncommitted changes).
 */
export function assertCleanGitState(): void {
  const status = run('git', ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error(
      `Git working tree is not clean. Commit or stash changes first:\n${status}`
    );
  }
}

/**
 * Commit and push metadata.json updates to the current branch.
 */
export function commitAndPushMetadata(
  metadataPaths: string[],
  month: string,
): void {
  for (const p of metadataPaths) {
    run('git', ['add', p]);
  }
  run('git', ['commit', '-m', `update ${month} rewards metadata with orderHash and txHash`]);
  run('git', ['push']);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/git.ts
git commit -m "feat: add git operations helper for rewards repo"
```

---

## Chunk 4: Main orchestrator

### Task 11: Create src/distribute.ts — Phase 1 (prepare + propose)

**Files:**
- Create: `src/distribute.ts`

- [ ] **Step 1: Write the main script**

This is the interactive orchestrator. It parses CLI args, runs all validations, simulates on anvil, then proposes Safe transactions.

```ts
// src/distribute.ts
import { config } from 'dotenv';
config();

import fs from 'fs';
import readline from 'readline';
import { ethers } from 'ethers';
import { TOKENS, USDC_BASE, BASE_CHAIN_ID, METABOARD_ADDRESS, METADATA_SAFE, METABOARD_ABI } from './constants';
import { resolveOutputDir, validateToken, checkUsdcBalance, type TokenValidation } from './lib/validation';
import { buildOrderCalldata, type DeploymentArgs } from './lib/order';
import { runSimulation } from './lib/simulation';
import { proposeSafeTransaction, waitForExecution, checkDelegate, extractOrderHashFromReceipt } from './lib/safe';
import { uploadToPinata } from './lib/pinata';
import { fetchSchemaHash, buildMetadataHex, generateMetaboardSubject, patchPendingPayout } from './lib/metadata';
import { assertCleanGitState, commitAndPushMetadata } from './lib/git';
import { updateIssuanceSiteAndPR, type IssuanceSiteUpdate } from './lib/github';

// --- CLI argument parsing ---

function parseArgs(): { month: string; r1Amount: number; r2Amount: number } {
  const args = process.argv.slice(2);
  let month = '';
  let r1Amount = 0;
  let r2Amount = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--month' && args[i + 1]) month = args[++i];
    else if (args[i] === '--r1-amount' && args[i + 1]) r1Amount = parseFloat(args[++i]);
    else if (args[i] === '--r2-amount' && args[i + 1]) r2Amount = parseFloat(args[++i]);
  }

  if (!month || isNaN(r1Amount) || r1Amount <= 0 || isNaN(r2Amount) || r2Amount <= 0) {
    console.error('Usage: tsx src/distribute.ts --month YYYY-MM --r1-amount <USDC> --r2-amount <USDC>');
    console.error('Amounts must be positive numbers.');
    process.exit(1);
  }

  return { month, r1Amount, r2Amount };
}

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

// --- Main ---

async function main() {
  const { month, r1Amount, r2Amount } = parseArgs();
  const amounts = [r1Amount, r2Amount];

  console.log(`\n=== Albion Rewards Distribution: ${month} ===\n`);

  // ---- PHASE 1: Prepare ----

  // 1. Pre-flight checks
  console.log('1. Running pre-flight checks...');
  assertCleanGitState();

  const dateRange = resolveOutputDir(month);
  const outputBase = 'output';

  const validations: TokenValidation[] = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const v = validateToken(outputBase, dateRange, TOKENS[i], amounts[i]);
    validations.push(v);
    console.log(`  ${TOKENS[i].symbol}: CSV OK, merkle root ${v.merkleRoot.slice(0, 10)}...`);
  }

  // Check delegates and balances
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  for (let i = 0; i < TOKENS.length; i++) {
    await checkDelegate(TOKENS[i].safe);
    await checkUsdcBalance(provider, TOKENS[i].safe, amounts[i]);
    console.log(`  ${TOKENS[i].symbol}: delegate OK, USDC balance OK`);
  }
  await checkDelegate(METADATA_SAFE);
  console.log('  Metadata Safe: delegate OK');

  console.log('Pre-flight checks passed.\n');

  // 2. Build order calldata
  console.log('2. Building order calldata...');
  const deployments: Array<{ validation: TokenValidation; args: DeploymentArgs }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const v = validations[i];
    const args = await buildOrderCalldata(
      v.merkleRoot,
      String(amounts[i]),
      TOKENS[i].safe,
    );
    deployments.push({ validation: v, args });
    console.log(`  ${TOKENS[i].symbol}: calldata built, orderbook=${args.orderbookAddress}`);
  }

  // 3. Simulate on Anvil fork
  console.log('\n3. Running fork simulation...');
  await runSimulation(
    deployments.map((d, i) => ({
      safeAddress: TOKENS[i].safe,
      symbol: TOKENS[i].symbol,
      approvals: d.args.approvals.map((a) => ({ to: a.to, calldata: a.calldata })),
      deploymentCalldata: d.args.deploymentCalldata,
      orderbookAddress: d.args.orderbookAddress,
    }))
  );

  // 4. Propose Safe transactions
  console.log('\n4. Proposing Safe transactions...');
  const proposals: Array<{ safeTxHash: string; safeUrl: string }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const d = deployments[i];
    const transactions = [
      ...d.args.approvals.map((a) => ({ to: a.to, data: a.calldata, value: '0' })),
      { to: d.args.orderbookAddress, data: d.args.deploymentCalldata, value: '0' },
    ];

    const proposal = await proposeSafeTransaction(TOKENS[i].safe, transactions);
    proposals.push(proposal);
    console.log(`  ${TOKENS[i].symbol}: proposed → ${proposal.safeUrl}`);
  }

  // ---- PAUSE 1 ----
  console.log('\n========================================');
  console.log('PAUSE: Sign and execute BOTH Safe transactions:');
  proposals.forEach((p, i) => console.log(`  ${TOKENS[i].symbol}: ${p.safeUrl}`));
  console.log('========================================\n');

  await waitForEnter('Press Enter after both transactions are signed and executed...');

  // ---- PHASE 2: Finalize ----

  // 5. Wait for execution and extract results
  console.log('\n5. Checking execution status...');
  const executionResults: Array<{ orderHash: string; txHash: string }> = [];

  for (let i = 0; i < TOKENS.length; i++) {
    console.log(`  Polling ${TOKENS[i].symbol}...`);
    const execResult = await waitForExecution(proposals[i].safeTxHash);
    console.log(`  ${TOKENS[i].symbol}: executed, txHash=${execResult.transactionHash}`);

    const receipt = await provider.getTransactionReceipt(execResult.transactionHash);
    if (!receipt) throw new Error(`Could not fetch receipt for ${execResult.transactionHash}`);

    const orderHash = extractOrderHashFromReceipt(receipt);
    console.log(`  ${TOKENS[i].symbol}: orderHash=${orderHash}`);

    executionResults.push({ orderHash, txHash: execResult.transactionHash });
  }

  // 6. Update metadata.json files
  console.log('\n6. Updating metadata.json files...');
  const metadataPaths: string[] = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const v = validations[i];
    const metadataPath = v.metadataPath;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    patchPendingPayout(metadata, {
      date: new Date().toISOString(),
      txHash: executionResults[i].txHash,
      orderHash: executionResults[i].orderHash,
    });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    metadataPaths.push(metadataPath);
    console.log(`  ${TOKENS[i].symbol}: metadata.json updated`);
  }

  commitAndPushMetadata(metadataPaths, month);
  console.log('  Committed and pushed metadata updates.');

  // 7. Upload CSVs to Pinata
  console.log('\n7. Uploading CSVs to Pinata...');
  const csvUploads: Array<{ cid: string; gatewayUrl: string }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const csvContent = fs.readFileSync(validations[i].csvPath, 'utf8');
    const filename = `rewards_${dateRange}_${TOKENS[i].symbol}.csv`;
    const result = await uploadToPinata(csvContent, filename);
    csvUploads.push(result);
    console.log(`  ${TOKENS[i].symbol}: CID=${result.cid}`);
  }

  // 8. Pin metadata on SFTs
  console.log('\n8. Pinning metadata on SFTs...');

  // Fetch schema hash from on-chain metadata (use R1 token, same schema for both)
  const schemaHash = await fetchSchemaHash(TOKENS[0].address);
  console.log(`  Schema hash: ${schemaHash}`);

  // Upload each metadata JSON to Pinata and build emitMeta calls
  const emitMetaCalls: Array<{ to: string; data: string; value: string }> = [];

  for (let i = 0; i < TOKENS.length; i++) {
    const metadataJson = fs.readFileSync(validations[i].metadataPath, 'utf8');
    const metadataFilename = `metadata_${TOKENS[i].symbol}_${month}.json`;
    const metadataUpload = await uploadToPinata(metadataJson, metadataFilename, 'application/json');
    console.log(`  ${TOKENS[i].symbol}: metadata CID=${metadataUpload.cid}`);

    const metadataHex = buildMetadataHex(metadataJson, schemaHash, metadataUpload.cid);
    const subject = generateMetaboardSubject(TOKENS[i].address);

    const iface = new ethers.Interface(METABOARD_ABI);
    const calldata = iface.encodeFunctionData('emitMeta', [subject, metadataHex]);
    emitMetaCalls.push({ to: METABOARD_ADDRESS, data: calldata, value: '0' });
  }

  // Propose batched emitMeta to Metadata Safe
  const metadataProposal = await proposeSafeTransaction(METADATA_SAFE, emitMetaCalls);
  console.log(`  Metadata Safe tx: ${metadataProposal.safeUrl}`);

  // ---- PAUSE 2 ----
  console.log('\n========================================');
  console.log('PAUSE: Sign and execute the metadata Safe transaction:');
  console.log(`  ${metadataProposal.safeUrl}`);
  console.log('========================================\n');

  await waitForEnter('Press Enter after the metadata transaction is signed and executed...');

  // 9. Verify metadata tx executed
  console.log('\n9. Checking metadata tx execution...');
  await waitForExecution(metadataProposal.safeTxHash);
  console.log('  Metadata tx executed.');

  // 10. Update issuance-site network.ts and create PR
  console.log('\n10. Updating issuance-site...');

  const r1Update: IssuanceSiteUpdate = {
    orderHash: executionResults[0].orderHash,
    csvCid: csvUploads[0].cid,
    merkleRoot: validations[0].merkleRoot,
    csvGatewayUrl: csvUploads[0].gatewayUrl,
  };

  const r2Update: IssuanceSiteUpdate = {
    orderHash: executionResults[1].orderHash,
    csvCid: csvUploads[1].cid,
    merkleRoot: validations[1].merkleRoot,
    csvGatewayUrl: csvUploads[1].gatewayUrl,
  };

  const prUrl = await updateIssuanceSiteAndPR(r1Update, r2Update, month);
  console.log(`  PR created: ${prUrl}`);

  // Done!
  console.log('\n========================================');
  console.log('Distribution complete!');
  console.log(`  R1 orderHash: ${executionResults[0].orderHash}`);
  console.log(`  R2 orderHash: ${executionResults[1].orderHash}`);
  console.log(`  R1 CSV CID: ${csvUploads[0].cid}`);
  console.log(`  R2 CSV CID: ${csvUploads[1].cid}`);
  console.log(`  Issuance-site PR: ${prUrl}`);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nFATAL:', error.message || error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/distribute.ts
git commit -m "feat: add main distribute.ts orchestrator script"
```

---

### Task 12: Integration testing — dry run walkthrough

**Files:**
- All `src/lib/*.ts` and `src/distribute.ts`

This task is a manual verification pass to ensure all pieces connect.

- [ ] **Step 1: Verify all imports resolve**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 2: Verify the help text works**

Run: `npx tsx src/distribute.ts`
Expected: Prints usage message and exits with code 1

- [ ] **Step 3: Run the existing test suite**

Run: `npx vitest run`
Expected: All tests pass (pinata, metadata, validation tests)

- [ ] **Step 4: Commit any fixes**

If any issues found, fix and commit:
```bash
git add -A
git commit -m "fix: integration fixes for distribute script"
```

---

### Task 13: AddOrderV2 event signature verification

**Files:**
- Modify: `src/lib/safe.ts` (if needed)
- Modify: `src/lib/simulation.ts` (if needed)

The `AddOrderV2` event ABI used in `extractOrderHashFromReceipt` and `simulateDeployment` needs to match the actual raindex v4 orderbook. The event signature used in the plan is a best-guess based on the v4 structs.

- [ ] **Step 1: Verify the event signature**

Look up the actual `AddOrderV2` event from the deployed orderbook contract on Base. The orderbook address will be returned by `gui.getDeploymentTransactionArgs()`. Check with:

Run: `npx tsx -e "const { ethers } = require('ethers'); console.log(ethers.id('AddOrderV2(address,bytes32,(address,(address,address,bytes),(address,bytes32)[],(address,bytes32)[],bytes32))'))"`

Compare this topic hash with what appears in real transaction receipts for existing orders.

- [ ] **Step 2: Update event ABI if needed**

If the topic doesn't match, adjust the ABI string in both `src/lib/safe.ts:extractOrderHashFromReceipt` and `src/lib/simulation.ts:simulateDeployment`.

- [ ] **Step 3: Commit if changed**

```bash
git add src/lib/safe.ts src/lib/simulation.ts
git commit -m "fix: correct AddOrderV2 event signature"
```

---

### Task 14: Final verification and script docs

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Add distribute script to package.json**

Add to the `"scripts"` section of `package.json`:

```json
"distribute": "tsx src/distribute.ts"
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add distribute script to package.json"
```
