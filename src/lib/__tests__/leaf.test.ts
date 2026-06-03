import { describe, it, expect } from 'vitest';
import { keccak256 } from 'ethers';
import { buildClaimLeaf, buildClaimLeaves, floatAmountHex } from '../leaf';

describe('floatAmountHex', () => {
  it('encodes a whole-token amount and round-trips losslessly', async () => {
    const hex = await floatAmountHex(1000000000000000000n); // 1.0 @ 18 decimals
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
    const { Float } = await import('@rainlanguage/orderbook');
    const f = Float.fromHex(hex as `0x${string}`);
    expect(f.error).toBeFalsy();
    const back = f.value!.toFixedDecimal(18);
    expect(back.error).toBeFalsy();
    expect(BigInt(back.value!)).toBe(1000000000000000000n);
  });

  it('encodes zero via Float.fromFixedDecimal (matches SDK canonical encoding)', async () => {
    const hex = await floatAmountHex(0n);
    const { Float } = await import('@rainlanguage/orderbook');
    const expected = Float.fromFixedDecimal(0n, 18);
    expect(expected.error).toBeFalsy();
    // In alpha.229 Float zero encodes as all-zeros bytes32; the important thing is
    // that we go through Float.fromFixedDecimal, not that the bits are non-zero.
    expect(hex.toLowerCase()).toBe(expected.value!.asHex().toLowerCase());
  });
});

describe('buildClaimLeaf', () => {
  it('hashes index ++ address ++ floatAmount as three 32-byte words', async () => {
    const index = 5n;
    const address = '0x000000000000000000000000000000000000dEaD';
    const amount = 1234500000000000000000n;
    const amtHex = (await floatAmountHex(amount)).replace(/^0x/, '').toLowerCase().padStart(64, '0');
    const expected = keccak256(
      '0x' +
        index.toString(16).padStart(64, '0') +
        BigInt(address).toString(16).padStart(64, '0') +
        amtHex
    );
    expect(await buildClaimLeaf(index, address, amount)).toBe(expected);
  });

  it('is deterministic', async () => {
    const a = await buildClaimLeaf(1, '0x0000000000000000000000000000000000000001', 7n);
    const b = await buildClaimLeaf(1, '0x0000000000000000000000000000000000000001', 7n);
    expect(a).toBe(b);
  });
});

describe('buildClaimLeaves', () => {
  it('maps parsed rows to leaves in order', async () => {
    const rows: Array<[string, string, string]> = [
      ['0', '0x0000000000000000000000000000000000000001', '1000000000000000000'],
      ['1', '0x0000000000000000000000000000000000000000', '0'],
    ];
    const leaves = await buildClaimLeaves(rows);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]).toBe(await buildClaimLeaf(rows[0][0], rows[0][1], rows[0][2]));
    expect(leaves[1]).toBe(await buildClaimLeaf(rows[1][0], rows[1][1], rows[1][2]));
  });
});
