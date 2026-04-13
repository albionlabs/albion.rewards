import pako from 'pako';
import cbor from 'cbor-web';
import { ethers } from 'ethers';
import { MAGIC_NUMBERS, METADATA_SUBGRAPH_URL } from '../constants';

const { encodeCanonical, decodeAllSync } = cbor;

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
