import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadToPinata, uploadFileToPinata } from '../pinata';

describe('uploadToPinata', () => {
  beforeEach(() => {
    vi.stubEnv('PINATA_JWT', 'test-jwt-token');
    vi.stubEnv('PINATA_GATEWAY', 'https://gateway.pinata.cloud/ipfs');
  });

  it('sends correct request to Pinata v3 API', async () => {
    const mockResponse = {
      data: { cid: 'QmTestCid123', size: 100, created_at: '2026-04-09T00:00:00Z' },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await uploadToPinata('col1,col2\na,b', 'test.csv');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://uploads.pinata.cloud/v3/files');
    expect((options as RequestInit).method).toBe('POST');
    expect(result.cid).toBe('QmTestCid123');
    expect(result.gatewayUrl).toBe('https://gateway.pinata.cloud/ipfs/QmTestCid123');

    fetchSpy.mockRestore();
  });

  it('throws on non-200 response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    );

    await expect(uploadToPinata('data', 'file.csv')).rejects.toThrow('Pinata upload failed');
    fetchSpy.mockRestore();
  });
});

describe('uploadFileToPinata', () => {
  beforeEach(() => {
    vi.stubEnv('PINATA_JWT', 'test-jwt-token');
    vi.stubEnv('PINATA_GATEWAY', 'https://gateway.pinata.cloud/ipfs');
  });

  it('uploads raw bytes with the given filename and content type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { cid: 'QmBin456' } }), { status: 200 })
    );

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const result = await uploadFileToPinata(bytes, 'report.pdf', 'application/pdf');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://uploads.pinata.cloud/v3/files');
    const body = (options as RequestInit).body as FormData;
    const file = body.get('file') as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('application/pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(body.get('name')).toBe('report.pdf');
    expect(result.cid).toBe('QmBin456');
    expect(result.gatewayUrl).toBe('https://gateway.pinata.cloud/ipfs/QmBin456');

    fetchSpy.mockRestore();
  });

  it('throws on non-200 response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    );
    await expect(
      uploadFileToPinata(new Uint8Array([1, 2, 3]), 'file.pdf', 'application/pdf')
    ).rejects.toThrow('Pinata upload failed');
    fetchSpy.mockRestore();
  });
});
