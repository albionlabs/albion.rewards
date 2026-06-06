import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { extractOrderHashFromReceipt } from '../safe';

const ORDER_V4 =
  '(address owner, (address interpreter, address store, bytes bytecode) evaluable, (address token, bytes32 vaultId)[] validInputs, (address token, bytes32 vaultId)[] validOutputs, bytes32 nonce)';

function fakeReceipt(orderHash: string): ethers.TransactionReceipt {
  const iface = new ethers.Interface([
    `event AddOrderV3(address sender, bytes32 orderHash, ${ORDER_V4} order)`,
  ]);
  const order = [
    '0x0000000000000000000000000000000000000001',
    ['0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003', '0x'],
    [], [],
    '0x' + '0'.repeat(64),
  ];
  const log = iface.encodeEventLog('AddOrderV3', [
    '0x0000000000000000000000000000000000000004', orderHash, order,
  ]);
  return { logs: [{ topics: log.topics, data: log.data }] } as unknown as ethers.TransactionReceipt;
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
