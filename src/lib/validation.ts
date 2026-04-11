import fs from 'fs';
import { ethers } from 'ethers';
import { SimpleMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256 } from 'ethers';
import { USDC_DECIMALS, CSV_AMOUNT_DECIMALS, TOKENS } from '../constants';

/**
 * Convert --month YYYY-MM to date range string: YYYY-MM-DD_to_YYYY-MM-DD
 */
export function resolveOutputDir(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const mon = parseInt(monthStr);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fmt(firstDay)}_to_${fmt(lastDay)}`;
}

/**
 * Validate that the CLI amount (human-readable USDC) matches the CSV total.
 * CSV amounts use 18 decimals (SFT token decimals), not USDC 6 decimals.
 */
export function validateCsvTotal(cliAmount: number, csvAmountsWei: bigint[]): boolean {
  const totalWei = csvAmountsWei.reduce((sum, a) => sum + a, 0n);
  // Use ethers.parseUnits via string to avoid floating-point precision loss at 10^18
  const cliWei = ethers.parseUnits(cliAmount.toString(), CSV_AMOUNT_DECIMALS);
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

  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  if (!fs.existsSync(treePath)) throw new Error(`Tree JSON not found: ${treePath}`);
  if (!fs.existsSync(metadataPath)) throw new Error(`metadata.json not found: ${metadataPath}`);

  const csvData = parseCsv(csvPath);
  if (csvData.length !== 256) {
    throw new Error(`${token.symbol} CSV must have 256 entries, found ${csvData.length}`);
  }

  const merkleCheck = verifyMerkleRoot(csvPath, treePath);
  if (!merkleCheck.valid) {
    throw new Error(
      `${token.symbol} merkle root mismatch: computed=${merkleCheck.computedRoot}, saved=${merkleCheck.savedRoot}`
    );
  }

  const csvAmounts = csvData.map(([, , amount]) => BigInt(amount));
  if (!validateCsvTotal(cliAmount, csvAmounts)) {
    const totalWei = csvAmounts.reduce((sum, a) => sum + a, 0n);
    throw new Error(
      `${token.symbol} amount mismatch: CLI=${cliAmount} USDC, CSV total=${totalWei} wei`
    );
  }

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
  requiredAmountHuman: number,
  tokenAddress: string,
): Promise<void> {
  const usdc = new ethers.Contract(
    tokenAddress,
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
