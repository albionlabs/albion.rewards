/**
 * Resume distribution from Phase 2 (step 5) using known safeTxHashes
 * from an already-executed first run.
 */
import { config } from 'dotenv';
config();

import fs from 'fs';
import readline from 'readline';
import { ethers } from 'ethers';
import { TOKENS, METABOARD_ADDRESS, METADATA_SAFE, METABOARD_ABI } from '../src/constants';
import { resolveOutputDir, validateToken, type TokenValidation } from '../src/lib/validation';
import { waitForExecution, extractOrderHashFromReceipt, proposeSafeTransaction } from '../src/lib/safe';
import { uploadToPinata } from '../src/lib/pinata';
import { fetchSchemaHash, buildMetadataHex, generateMetaboardSubject, patchPendingPayout } from '../src/lib/metadata';
import { commitAndPushMetadata } from '../src/lib/git';
import { updateIssuanceSiteAndPR, type IssuanceSiteUpdate } from '../src/lib/github';

const MONTH = '2026-02';
const R1_SAFE_TX_HASH = '0x0e261dc525213a9f5aa13e2a3c97c286f03b14af4ecf5e8d5b22b843443b9395';
const R2_SAFE_TX_HASH = '0xe156ba5ec6e023142398eec3c7fa0634642f7fe683a4b476581e149870ac8031';

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const dateRange = resolveOutputDir(MONTH);
  const outputBase = 'output';
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);

  // Re-validate to get paths
  const validations: TokenValidation[] = [];
  for (let i = 0; i < TOKENS.length; i++) {
    // Use 999999 as dummy amount — we just need paths, not amount validation
    const v = validateToken(outputBase, dateRange, TOKENS[i], 999999);
    validations.push(v);
  }

  const safeTxHashes = [R1_SAFE_TX_HASH, R2_SAFE_TX_HASH];

  // 5. Check execution and extract results
  console.log('5. Checking execution status...');
  const executionResults: Array<{ orderHash: string; txHash: string }> = [];

  for (let i = 0; i < TOKENS.length; i++) {
    console.log(`  Polling ${TOKENS[i].symbol}...`);
    const execResult = await waitForExecution(safeTxHashes[i]);
    console.log(`  ${TOKENS[i].symbol}: executed, txHash=${execResult.transactionHash}`);

    const receipt = await provider.getTransactionReceipt(execResult.transactionHash);
    if (!receipt) throw new Error(`Could not fetch receipt for ${execResult.transactionHash}`);

    const orderHash = extractOrderHashFromReceipt(receipt);
    console.log(`  ${TOKENS[i].symbol}: orderHash=${orderHash}`);

    executionResults.push({ orderHash, txHash: execResult.transactionHash });
  }

  // 6. Update metadata.json files
  console.log('\n6. Updating metadata.json files...');
  const metadataPaths: string[] = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const metadataPath = validations[i].metadataPath;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    patchPendingPayout(metadata, {
      date: new Date().toISOString(),
      txHash: executionResults[i].txHash,
      orderHash: executionResults[i].orderHash,
    });
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    metadataPaths.push(metadataPath);
    console.log(`  ${TOKENS[i].symbol}: metadata.json updated`);
  }

  commitAndPushMetadata(metadataPaths, MONTH);
  console.log('  Committed and pushed metadata updates.');

  // 7. Upload CSVs to Pinata
  console.log('\n7. Uploading CSVs to Pinata...');
  const csvUploads: Array<{ cid: string; gatewayUrl: string }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const csvContent = fs.readFileSync(validations[i].csvPath, 'utf8');
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
    const metadataJson = fs.readFileSync(validations[i].metadataPath, 'utf8');
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
    merkleRoot: validations[0].merkleRoot,
    csvGatewayUrl: csvUploads[0].gatewayUrl,
  };
  const r2Update: IssuanceSiteUpdate = {
    orderHash: executionResults[1].orderHash,
    csvCid: csvUploads[1].cid,
    merkleRoot: validations[1].merkleRoot,
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
