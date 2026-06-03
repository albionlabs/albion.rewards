import { keccak256 } from 'ethers';
import { CSV_AMOUNT_DECIMALS } from '../constants';

/** Encode an 18-decimal integer amount as the Rain Float bytes32 hex (0x + 64 hex). */
export async function floatAmountHex(amountWei: string | bigint): Promise<string> {
  const { Float } = await import('@rainlanguage/orderbook');
  const res = Float.fromFixedDecimal(BigInt(amountWei), CSV_AMOUNT_DECIMALS);
  if (res.error || !res.value) {
    throw new Error(
      `Float encode failed for amount ${amountWei}: ${res.error?.readableMsg ?? JSON.stringify(res.error)}`
    );
  }
  try {
    return res.value.asHex();
  } finally {
    res.value.free?.(); // release the WASM handle even if asHex throws
  }
}

const word = (x: string | bigint) => BigInt(x).toString(16).padStart(64, '0');

/** keccak256 leaf = hash(word(index) ++ word(address) ++ floatAmountWord). */
export async function buildClaimLeaf(
  index: string | bigint,
  address: string,
  amountWei: string | bigint
): Promise<string> {
  const amountWord = (await floatAmountHex(amountWei)).replace(/^0x/, '').toLowerCase().padStart(64, '0');
  return keccak256('0x' + word(index) + word(address) + amountWord);
}

/** Build leaves for already-parsed/trimmed [index, address, amount] rows. */
export async function buildClaimLeaves(rows: Array<[string, string, string]>): Promise<string[]> {
  const leaves: string[] = [];
  for (const [index, address, amount] of rows) {
    leaves.push(await buildClaimLeaf(index, address, amount));
  }
  return leaves;
}
