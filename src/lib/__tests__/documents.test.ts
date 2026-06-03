import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { docDisplayName, mergeDocuments, type AssetDocument } from '../documents';
import { convertToPdf } from '../documents';

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

vi.mock('node:fs');
vi.mock('node:child_process');

describe('convertToPdf', () => {
  let fs: typeof import('node:fs');
  let cp: typeof import('node:child_process');

  beforeEach(async () => {
    fs = await import('node:fs');
    cp = await import('node:child_process');
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes a .pdf through unchanged', async () => {
    const bytes = Buffer.from('%PDF-1.7');
    vi.spyOn(fs, 'readFileSync').mockReturnValue(bytes as never);

    const out = await convertToPdf('/in/April Sales.pdf');

    expect(out.filename).toBe('April Sales.pdf');
    expect(out.bytes).toEqual(bytes);
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('converts a .docx via soffice and returns the produced pdf bytes', async () => {
    const pdfBytes = Buffer.from('%PDF-from-docx');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true); // soffice bin + output pdf exist
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue('/tmp/docpdf-xyz' as never);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(pdfBytes as never);
    vi.spyOn(fs, 'rmSync').mockReturnValue(undefined as never);
    const execSpy = vi.spyOn(cp, 'execFileSync').mockReturnValue(Buffer.from('') as never);

    const out = await convertToPdf('/in/26_04_Albion_Report.docx');

    expect(execSpy).toHaveBeenCalledOnce();
    const [, args] = execSpy.mock.calls[0];
    expect(args).toContain('--headless');
    expect(args).toContain('--convert-to');
    expect(args).toContain('pdf');
    expect(args).toContain('/in/26_04_Albion_Report.docx');
    expect(out.filename).toBe('26_04_Albion_Report.pdf');
    expect(out.bytes).toEqual(pdfBytes);
  });

  it('throws a helpful error when soffice is not found', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false); // no known soffice path
    // mkdtempSync/rmSync must be stubbed: vi.mock('node:fs') auto-mocks the whole
    // module, so an un-stubbed mkdtempSync returns undefined and path.join would
    // throw a TypeError before we ever reach execFileSync.
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue('/tmp/docpdf-missing' as never);
    vi.spyOn(fs, 'rmSync').mockReturnValue(undefined as never);
    const execSpy = vi.spyOn(cp, 'execFileSync').mockImplementation(() => {
      throw new Error('command not found: soffice');
    });

    await expect(convertToPdf('/in/x.docx')).rejects.toThrow(/libreoffice/i);
    expect(execSpy).toHaveBeenCalled();
  });

  it('rejects unsupported extensions', async () => {
    await expect(convertToPdf('/in/notes.txt')).rejects.toThrow(/\.pdf or \.docx/i);
  });
});
