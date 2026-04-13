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
    const csvAmountsWei = [
      500000000000000000000n,
      228450000000000000000n,
    ];
    expect(validateCsvTotal(728.45, csvAmountsWei)).toBe(true);
  });

  it('returns false on mismatch', () => {
    const csvAmountsWei = [500000000000000000000n];
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
