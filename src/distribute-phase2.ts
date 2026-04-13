/**
 * Phase 2: Verify execution, update metadata, upload to Pinata, propose metadata tx.
 *
 * Usage: npx tsx src/distribute-phase2.ts --month YYYY-MM
 *
 * Reads state from phase 1. Outputs metadata Safe transaction URL to sign.
 */
import { config } from 'dotenv';
config();

import fs from 'fs';
import { ethers } from 'ethers';
import { TOKENS, METABOARD_ADDRESS, METADATA_SAFE, METABOARD_ABI } from './constants';
import { resolveOutputDir, validateToken } from './lib/validation';
import { waitForExecution, extractOrderHashFromReceipt, proposeSafeTransaction } from './lib/safe';
import { uploadToPinata } from './lib/pinata';
import { fetchSchemaHash, buildMetadataHex, generateMetaboardSubject, patchPendingPayout } from './lib/metadata';
import { commitAndPushMetadata } from './lib/git';

function parseMonth(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--month' && args[i + 1]) return args[i + 1];
  }
  console.error('Usage: npx tsx src/distribute-phase2.ts --month YYYY-MM');
  process.exit(1);
}

interface Phase1State {
  month: string;
  dateRange: string;
  r1Amount: number;
  r2Amount: number;
  proposals: Array<{ symbol: string; safeTxHash: string; safeUrl: string }>;
  merkleRoots: string[];
}

function loadState(dateRange: string): Phase1State {
  const statePath = `output/${dateRange}/distribute-state.json`;
  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found: ${statePath}. Run phase 1 first.`);
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

async function main() {
  const month = parseMonth();
  const dateRange = resolveOutputDir(month);
  const state = loadState(dateRange);
  const amounts = [state.r1Amount, state.r2Amount];

  console.log(`\n=== Phase 2: Finalize Orders & Propose Metadata (${month}) ===\n`);

  // Re-validate to get paths
  const outputBase = 'output';
  const validations = TOKENS.map((token, i) => validateToken(outputBase, dateRange, token, amounts[i]));

  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);

  // 5. Wait for execution and extract results
  console.log('5. Checking execution status...');
  const executionResults: Array<{ orderHash: string; txHash: string }> = [];

  for (let i = 0; i < TOKENS.length; i++) {
    console.log(`  Polling ${TOKENS[i].symbol}...`);
    const execResult = await waitForExecution(state.proposals[i].safeTxHash);
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

  commitAndPushMetadata(metadataPaths, month);
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
    const metadataFilename = `metadata_${TOKENS[i].symbol}_${month}.json`;
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

  // Update state for phase 3
  const statePath = `${outputBase}/${dateRange}/distribute-state.json`;
  const updatedState = {
    ...state,
    executionResults,
    csvUploads,
    metadataProposal: {
      safeTxHash: metadataProposal.safeTxHash,
      safeUrl: metadataProposal.safeUrl,
    },
  };
  fs.writeFileSync(statePath, JSON.stringify(updatedState, null, 2) + '\n');

  console.log(`\nState saved to ${statePath}`);
  console.log('\n========================================');
  console.log('Sign and execute the metadata Safe transaction:');
  console.log(`  ${metadataProposal.safeUrl}`);
  console.log('\nThen run: npx tsx src/distribute-phase3.ts --month ' + month);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nFATAL:', error.message || error);
  process.exit(1);
});
