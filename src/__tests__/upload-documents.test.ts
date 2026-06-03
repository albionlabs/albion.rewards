import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseArgs, resolveLatestDateRange } from '../upload-documents';

vi.mock('node:fs');

describe('parseArgs', () => {
  it('parses repeated --doc flags and an optional --into', () => {
    const args = parseArgs([
      '--doc', '2026-04:sales:/p/Egdon Apr26.pdf',
      '--doc', '2026-04:operations:/p/26_04_Albion_Report.docx',
      '--into', '2026-04',
    ]);
    expect(args.into).toBe('2026-04');
    expect(args.docs).toEqual([
      { month: '2026-04', kind: 'sales', path: '/p/Egdon Apr26.pdf' },
      { month: '2026-04', kind: 'operations', path: '/p/26_04_Albion_Report.docx' },
    ]);
  });

  it('keeps colons in the path (split on first two only)', () => {
    const args = parseArgs(['--doc', '2026-04:sales:/p/odd:name.pdf']);
    expect(args.docs[0].path).toBe('/p/odd:name.pdf');
  });

  it('throws on a bad month', () => {
    expect(() => parseArgs(['--doc', '2026-4:sales:/p/x.pdf'])).toThrow(/month/i);
  });

  it('throws on an unknown kind', () => {
    expect(() => parseArgs(['--doc', '2026-04:financials:/p/x.pdf'])).toThrow(/kind/i);
  });

  it('throws when no --doc is given', () => {
    expect(() => parseArgs(['--into', '2026-04'])).toThrow(/--doc/);
  });

  it('throws on a duplicate (month, kind)', () => {
    expect(() =>
      parseArgs(['--doc', '2026-04:sales:/p/a.pdf', '--doc', '2026-04:sales:/p/b.pdf'])
    ).toThrow(/duplicate/i);
  });

  it('throws on a malformed --doc with no colons', () => {
    expect(() => parseArgs(['--doc', 'noColonsHere'])).toThrow(/malformed/i);
  });

  it('throws on a --doc with an empty path', () => {
    expect(() => parseArgs(['--doc', '2026-04:sales:'])).toThrow(/path/i);
  });

  it('throws on a bad --into format', () => {
    expect(() => parseArgs(['--doc', '2026-04:sales:/p/x.pdf', '--into', '2026-4'])).toThrow(/into/i);
  });
});

describe('resolveLatestDateRange', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the dir with the latest end date', async () => {
    const fs = await import('node:fs');
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      '2026-03-01_to_2026-03-31',
      '2026-04-01_to_2026-04-30',
      '2026-02-01_to_2026-02-28',
      'not-a-range',
    ] as never);
    expect(resolveLatestDateRange('output')).toBe('2026-04-01_to_2026-04-30');
  });

  it('throws when no date-range dirs exist', async () => {
    const fs = await import('node:fs');
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['README.md'] as never);
    expect(() => resolveLatestDateRange('output')).toThrow(/no .* folders/i);
  });
});
