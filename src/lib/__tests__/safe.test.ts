import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { extractOrderHashFromReceipt, extractOrderFromReceipt } from '../safe';

const ORDER_V4 =
  '(address owner, (address interpreter, address store, bytes bytecode) evaluable, (address token, bytes32 vaultId)[] validInputs, (address token, bytes32 vaultId)[] validOutputs, bytes32 nonce)';

// A non-trivial order so orderBytes encoding is meaningfully exercised (real IOs,
// non-empty bytecode, non-zero nonce) rather than an all-empty tuple.
const SAMPLE_ORDER = [
  '0x1111111111111111111111111111111111111111',
  [
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    '0xdeadbeef',
  ],
  [['0x4444444444444444444444444444444444444444', '0x' + '11'.repeat(32)]],
  [['0x5555555555555555555555555555555555555555', '0x' + '22'.repeat(32)]],
  '0x' + '77'.repeat(32),
];

function fakeReceipt(
  orderHash: string,
  opts?: { blockNumber?: number; order?: unknown[] },
): ethers.TransactionReceipt {
  const iface = new ethers.Interface([
    `event AddOrderV3(address sender, bytes32 orderHash, ${ORDER_V4} order)`,
  ]);
  const order = opts?.order ?? [
    '0x0000000000000000000000000000000000000001',
    ['0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003', '0x'],
    [], [],
    '0x' + '0'.repeat(64),
  ];
  const log = iface.encodeEventLog('AddOrderV3', [
    '0x0000000000000000000000000000000000000004', orderHash, order,
  ]);
  return {
    blockNumber: opts?.blockNumber,
    logs: [{ topics: log.topics, data: log.data }],
  } as unknown as ethers.TransactionReceipt;
}

describe('extractOrderHashFromReceipt', () => {
  it('returns the orderHash from an AddOrderV3 log', () => {
    const oh = '0x' + 'ab'.repeat(32);
    expect(extractOrderHashFromReceipt(fakeReceipt(oh))).toBe(oh);
  });

  it('throws when no AddOrderV3 log is present', () => {
    const empty = { logs: [] } as unknown as ethers.TransactionReceipt;
    expect(() => extractOrderHashFromReceipt(empty)).toThrow(/AddOrderV3/);
  });
});

describe('extractOrderFromReceipt', () => {
  it('returns orderHash, deployBlock, and orderBytes that decode back to the order', () => {
    const oh = '0x' + 'cd'.repeat(32);
    const result = extractOrderFromReceipt(
      fakeReceipt(oh, { blockNumber: 48271122, order: SAMPLE_ORDER }),
    );

    expect(result.orderHash).toBe(oh);
    expect(result.deployBlock).toBe(48271122);

    // orderBytes is the canonical field the issuance site decodes via
    // AbiCoder.decode([OrderV4], orderBytes) to reconstruct the order — so it
    // MUST round-trip back to the exact order from the event.
    const [decoded] = ethers.AbiCoder.defaultAbiCoder().decode(
      [ORDER_V4],
      result.orderBytes,
    );
    expect(decoded.owner.toLowerCase()).toBe((SAMPLE_ORDER[0] as string).toLowerCase());
    expect(decoded.nonce).toBe(SAMPLE_ORDER[4]);
    expect(decoded.validInputs[0].token.toLowerCase()).toBe(
      ('0x4444444444444444444444444444444444444444').toLowerCase(),
    );
    expect(decoded.validOutputs[0].vaultId).toBe('0x' + '22'.repeat(32));
    expect(decoded.evaluable.bytecode).toBe('0xdeadbeef');
  });

  it('throws when no AddOrderV3 log is present', () => {
    const empty = { logs: [] } as unknown as ethers.TransactionReceipt;
    expect(() => extractOrderFromReceipt(empty)).toThrow(/AddOrderV3/);
  });
});
