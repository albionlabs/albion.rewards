import { config } from 'dotenv';
config();

export interface PinataUploadResult {
  cid: string;
  gatewayUrl: string;
}

export async function uploadToPinata(
  content: string,
  filename: string,
  contentType = 'text/csv'
): Promise<PinataUploadResult> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT environment variable is not set');

  const gateway = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

  const formData = new FormData();
  formData.append('file', new Blob([content], { type: contentType }), filename);
  formData.append('network', 'public');
  formData.append('name', filename);

  const response = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const cid = result.data.cid;

  return {
    cid,
    gatewayUrl: `${gateway}/${cid}`,
  };
}
