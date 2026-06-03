import { describe, it, expect } from 'vitest';
import { docDisplayName, mergeDocuments, type AssetDocument } from '../documents';

describe('docDisplayName', () => {
  it('formats sales report names', () => {
    expect(docDisplayName('2026-04', 'sales')).toBe('April 2026 Sales Report');
  });
  it('formats operations report names', () => {
    expect(docDisplayName('2026-04', 'operations')).toBe('April 2026 Operations Report');
  });
  it('handles a non-April month', () => {
    expect(docDisplayName('2025-09', 'operations')).toBe('September 2025 Operations Report');
  });
});

describe('mergeDocuments', () => {
  const a: AssetDocument = { name: 'April 2026 Sales Report', type: 'pdf', ipfs: 'cidA' };
  const b: AssetDocument = { name: 'April 2026 Operations Report', type: 'pdf', ipfs: 'cidB' };

  it('appends genuinely new entries', () => {
    expect(mergeDocuments([a], [b])).toEqual([a, b]);
  });
  it('overrides an existing entry with the same name and preserves its position', () => {
    const updated: AssetDocument = { name: a.name, type: 'pdf', ipfs: 'cidA2' };
    expect(mergeDocuments([a, b], [updated])).toEqual([updated, b]);
  });
  it('handles an empty existing array', () => {
    expect(mergeDocuments([], [a, b])).toEqual([a, b]);
  });
});
