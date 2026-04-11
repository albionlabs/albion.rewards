/**
 * Resume distribution from step 7 — metadata already patched and committed.
 * Hardcoded results from the first run's executed transactions.
 */
import { config } from 'dotenv';
config();

import fs from 'fs';
import readline from 'readline';
import { ethers } from 'ethers';
import { TOKENS, METABOARD_ADDRESS, METADATA_SAFE, METABOARD_ABI } from '../src/constants';
import { resolveOutputDir } from '../src/lib/validation';
import { proposeSafeTransaction, waitForExecution } from '../src/lib/safe';
import { uploadToPinata } from '../src/lib/pinata';
import { fetchSchemaHash, buildMetadataHex, generateMetaboardSubject } from '../src/lib/metadata';
import { updateIssuanceSiteAndPR, type IssuanceSiteUpdate } from '../src/lib/github';

const MONTH = '2026-02';

// Results from step 5 (already extracted)
const executionResults = [
  { orderHash: '0x3b976cdb37e00c214fd7212abd052e5da0760e39f0c8d9631ac122a13c3b4b44', txHash: '0xd047459e82ffce76ba43312465a33a21406ef7ba6cc4d2fc124f5ae0d97f0959' },
  { orderHash: '0xc0b5da036283d08ff457b4146198e66ed1e81a3f7da67d638b3a3c40a9a92f5e', txHash: '0x01c689234fa3912d22a64f2f0e5bb2e1b0020db0ac469adaff099c1d429e83a0' },
];

// Merkle roots from validation (needed for issuance site update)
const merkleRoots = ['0x12b0ad08', '0xa8a356b9']; // Will be read from tree files

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const dateRange = resolveOutputDir(MONTH);
  const outputBase = 'output';

  // Get paths and merkle roots from tree files
  const tokenPaths = TOKENS.map((token) => {
    const tokenDir = `${outputBase}/${dateRange}/${token.address}`;
    return {
      csvPath: `${tokenDir}/rewards_${dateRange}.csv`,
      treePath: `${tokenDir}/tree_${dateRange}.json`,
      metadataPath: `${tokenDir}/metadata.json`,
    };
  });

  // Read actual merkle roots from saved trees
  const { SimpleMerkleTree } = await import('@openzeppelin/merkle-tree');
  const actualMerkleRoots = tokenPaths.map((p) => {
    const tree = SimpleMerkleTree.load(JSON.parse(fs.readFileSync(p.treePath, 'utf8')));
    return tree.root as string;
  });

  // 7. Upload CSVs to Pinata
  console.log('7. Uploading CSVs to Pinata...');
  const csvUploads: Array<{ cid: string; gatewayUrl: string }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const csvContent = fs.readFileSync(tokenPaths[i].csvPath, 'utf8');
    const filename = `rewards_${dateRange}_${TOKENS[i].symbol}.csv`;
    const result = await uploadToPinata(csvContent, filename);
    csvUploads.push(result);
    console.log(`  ${TOKENS[i].symbol}: CID=${result.cid}`);
  }

  // 8. Pin metadata on SFTs
  console.log('\n8. Pinning metadata on SFTs...');
  const schemaHash = await fetchSchemaHash(TOKENS[0].address);
  console.log(`  Schema hash: ${schemaHash}`);

  const emitMetaCalls: Array<{ to: string; data: string; value: string }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const metadataJson = fs.readFileSync(tokenPaths[i].metadataPath, 'utf8');
    const metadataFilename = `metadata_${TOKENS[i].symbol}_${MONTH}.json`;
    const metadataUpload = await uploadToPinata(metadataJson, metadataFilename, 'application/json');
    console.log(`  ${TOKENS[i].symbol}: metadata CID=${metadataUpload.cid}`);

    const metadataHex = buildMetadataHex(metadataJson, schemaHash, metadataUpload.cid);
    const subject = generateMetaboardSubject(TOKENS[i].address);

    const iface = new ethers.Interface(METABOARD_ABI);
    const calldata = iface.encodeFunctionData('emitMeta', [subject, metadataHex]);
    emitMetaCalls.push({ to: METABOARD_ADDRESS, data: calldata, value: '0' });
  }

  const metadataProposal = await proposeSafeTransaction(METADATA_SAFE, emitMetaCalls);
  console.log(`  Metadata Safe tx: ${metadataProposal.safeUrl}`);

  console.log('\n========================================');
  console.log('PAUSE: Sign and execute the metadata Safe transaction:');
  console.log(`  ${metadataProposal.safeUrl}`);
  console.log('========================================\n');

  await waitForEnter('Press Enter after the metadata transaction is signed and executed...');

  // 9. Verify metadata tx executed
  console.log('\n9. Checking metadata tx execution...');
  await waitForExecution(metadataProposal.safeTxHash);
  console.log('  Metadata tx executed.');

  // 10. Update issuance-site
  console.log('\n10. Updating issuance-site...');
  const r1Update: IssuanceSiteUpdate = {
    orderHash: executionResults[0].orderHash,
    csvCid: csvUploads[0].cid,
    merkleRoot: actualMerkleRoots[0],
    csvGatewayUrl: csvUploads[0].gatewayUrl,
  };
  const r2Update: IssuanceSiteUpdate = {
    orderHash: executionResults[1].orderHash,
    csvCid: csvUploads[1].cid,
    merkleRoot: actualMerkleRoots[1],
    csvGatewayUrl: csvUploads[1].gatewayUrl,
  };

  const prUrl = await updateIssuanceSiteAndPR(r1Update, r2Update, MONTH);
  console.log(`  PR created: ${prUrl}`);

  console.log('\n========================================');
  console.log('Distribution Phase 2 complete!');
  console.log(`  R1 orderHash: ${executionResults[0].orderHash}`);
  console.log(`  R2 orderHash: ${executionResults[1].orderHash}`);
  console.log(`  R1 CSV CID: ${csvUploads[0].cid}`);
  console.log(`  R2 CSV CID: ${csvUploads[1].cid}`);
  console.log(`  Issuance-site PR: ${prUrl}`);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nFATAL:', error.message || error);
  process.exit(1);
});
