import { describe, it, expect } from 'vitest';
import { formatClaimEntry, type IssuanceSiteUpdate } from '../github';

const UPDATE: IssuanceSiteUpdate = {
  orderHash: '0x' + 'ab'.repeat(32),
  csvCid: 'bafyCID',
  merkleRoot: '0x' + 'cd'.repeat(32),
  csvGatewayUrl: 'https://gw/ipfs/bafyCID',
  orderBytes: '0x' + 'ef'.repeat(64),
  deployBlock: 48271122,
};

describe('formatClaimEntry', () => {
  it('emits orderBytes and deployBlock so the issuance site can resolve the order', () => {
    const entry = formatClaimEntry(UPDATE, '          ');

    // The two fields whose absence caused the $0-claims bug.
    expect(entry).toContain(`"${UPDATE.orderBytes}"`);
    expect(entry).toMatch(/orderBytes:/);
    // deployBlock is a number literal — NOT quoted.
    expect(entry).toMatch(/deployBlock:\s*48271122\b/);
    expect(entry).not.toContain('"48271122"');
  });

  it('still emits the original four fields', () => {
    const entry = formatClaimEntry(UPDATE, '          ');
    expect(entry).toContain(`"${UPDATE.orderHash}"`);
    expect(entry).toContain(`${UPDATE.csvCid}`);
    expect(entry).toContain(`"${UPDATE.merkleRoot}"`);
    expect(entry).toMatch(/expectedContentHash:/);
  });

  it('produces a syntactically valid object literal (balanced braces)', () => {
    const entry = formatClaimEntry(UPDATE, '          ');
    const opens = (entry.match(/{/g) ?? []).length;
    const closes = (entry.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});
