import { keccak256 } from "ethers";
import { Float } from "@rainlanguage/float";
import { CSV_AMOUNT_DECIMALS } from "../constants";

type FloatEncodeResult = {
  value?: { asHex(): string };
  float?: { asHex(): string };
};

function asFloatHex(result: FloatEncodeResult, label: string): string {
  const encoded = result.value ?? result.float;
  if (!encoded) {
    throw new Error(`Failed to encode ${label} as Float`);
  }
  return encoded.asHex();
}

/**
 * Hash a CSV row the same way Rainlang claims orders verify merkle leaves:
 * Float(index, 0) ++ address as bytes32 ++ Float(amount, 18), then keccak256.
 */
export function buildClaimLeaf(
  index: string | bigint,
  address: string,
  amountWei: string | bigint,
): string {
  const indexAsFloat = asFloatHex(
    Float.fromFixedDecimalLossy(BigInt(index), 0),
    `index ${index}`,
  );
  const addressAsBytes32 =
    "0x" + BigInt(address).toString(16).padStart(64, "0");
  const amountAsFloat = asFloatHex(
    Float.fromFixedDecimalLossy(BigInt(amountWei), CSV_AMOUNT_DECIMALS),
    `amount ${amountWei}`,
  );

  const packed =
    indexAsFloat.slice(2) + addressAsBytes32.slice(2) + amountAsFloat.slice(2);
  return keccak256("0x" + packed);
}

/** Build leaves for already-parsed/trimmed [index, address, amount] rows. */
export function buildClaimLeaves(
  rows: Array<[string, string, string]>,
): string[] {
  return rows.map(([index, address, amount]) =>
    buildClaimLeaf(index, address, amount),
  );
}
