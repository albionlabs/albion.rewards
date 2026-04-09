import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadToPinata } from '../pinata';

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
