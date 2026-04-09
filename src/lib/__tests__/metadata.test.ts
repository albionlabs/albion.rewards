import { describe, it, expect } from 'vitest';
import {
  deflateJson,
  encodeCBORStructure,
  generateMetaboardSubject,
  buildMetadataHex,
  patchPendingPayout,
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
    expect(subject.length).toBe(66);
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

describe('patchPendingPayout', () => {
  it('patches the first entry with empty date/txHash/orderHash', () => {
    const metadata = {
      payoutData: [
        { tokenPayout: { date: '2025-09-17', txHash: '0xabc', orderHash: '0xdef', totalPayout: 100 } },
        { tokenPayout: { date: '', txHash: '', orderHash: '', totalPayout: 200 } },
      ],
    };
    const result = patchPendingPayout(metadata, {
      date: '2026-03-15T12:00:00Z',
      txHash: '0x123',
      orderHash: '0x456',
    });
    expect((result.payoutData as any)[1].tokenPayout.date).toBe('2026-03-15T12:00:00Z');
    expect((result.payoutData as any)[1].tokenPayout.txHash).toBe('0x123');
    expect((result.payoutData as any)[1].tokenPayout.orderHash).toBe('0x456');
  });

  it('throws when no pending entry exists', () => {
    const metadata = {
      payoutData: [
        { tokenPayout: { date: '2025-09-17', txHash: '0xabc', orderHash: '0xdef' } },
      ],
    };
    expect(() =>
      patchPendingPayout(metadata, { date: 'x', txHash: 'x', orderHash: 'x' })
    ).toThrow('No pending payoutData entry found');
  });
});
