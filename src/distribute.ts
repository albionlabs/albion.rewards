import { config } from 'dotenv';
config();

import fs from 'fs';
import readline from 'readline';
import { ethers } from 'ethers';
import { TOKENS, METABOARD_ADDRESS, METADATA_SAFE, METABOARD_ABI, USDC_BASE, WETH_BASE } from './constants';
import { resolveOutputDir, validateToken, checkUsdcBalance, type TokenValidation } from './lib/validation';
import { buildOrderCalldata, type DeploymentArgs } from './lib/order';
import { runSimulation } from './lib/simulation';
import { proposeSafeTransaction, waitForExecution, checkDelegate, extractOrderHashFromReceipt } from './lib/safe';
import { uploadToPinata } from './lib/pinata';
import { fetchSchemaHash, buildMetadataHex, generateMetaboardSubject, patchPendingPayout } from './lib/metadata';
import { assertCleanGitState, commitAndPushMetadata } from './lib/git';
import { updateIssuanceSiteAndPR, type IssuanceSiteUpdate } from './lib/github';

// --- CLI argument parsing ---

interface CliArgs {
  month: string;
  r1Amount: number;
  r2Amount: number;
  outputToken: string;
  inputToken: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let month = '';
  let r1Amount = NaN;
  let r2Amount = NaN;
  let outputToken = USDC_BASE;
  let inputToken = WETH_BASE;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--month' && args[i + 1]) month = args[++i];
    else if (args[i] === '--r1-amount' && args[i + 1]) r1Amount = parseFloat(args[++i]);
    else if (args[i] === '--r2-amount' && args[i + 1]) r2Amount = parseFloat(args[++i]);
    else if (args[i] === '--output-token' && args[i + 1]) outputToken = args[++i];
    else if (args[i] === '--input-token' && args[i + 1]) inputToken = args[++i];
  }

  if (!month || isNaN(r1Amount) || r1Amount <= 0 || isNaN(r2Amount) || r2Amount <= 0) {
    console.error('Usage: tsx src/distribute.ts --month YYYY-MM --r1-amount <USDC> --r2-amount <USDC>');
    console.error('Optional: --output-token <address> --input-token <address>');
    console.error('Amounts must be positive numbers.');
    process.exit(1);
  }

  return { month, r1Amount, r2Amount, outputToken, inputToken };
}

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

// --- Main ---

async function main() {
  const { month, r1Amount, r2Amount, outputToken, inputToken } = parseArgs();
  const amounts = [r1Amount, r2Amount];

  console.log(`\n=== Albion Rewards Distribution: ${month} ===`);
  if (outputToken !== USDC_BASE || inputToken !== WETH_BASE) {
    console.log(`  Custom tokens: output=${outputToken}, input=${inputToken}`);
  }
  console.log();

  // ---- PHASE 1: Prepare ----

  // 1. Pre-flight checks
  console.log('1. Running pre-flight checks...');
  assertCleanGitState();

  const dateRange = resolveOutputDir(month);
  const outputBase = 'output';

  const validations: TokenValidation[] = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const v = validateToken(outputBase, dateRange, TOKENS[i], amounts[i]);
    validations.push(v);
    console.log(`  ${TOKENS[i].symbol}: CSV OK, merkle root ${v.merkleRoot.slice(0, 10)}...`);
  }

  // Check delegates and balances
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  for (let i = 0; i < TOKENS.length; i++) {
    await checkDelegate(TOKENS[i].safe);
    await checkUsdcBalance(provider, TOKENS[i].safe, amounts[i], outputToken);
    console.log(`  ${TOKENS[i].symbol}: delegate OK, balance OK`);
  }
  await checkDelegate(METADATA_SAFE);
  console.log('  Metadata Safe: delegate OK');

  console.log('Pre-flight checks passed.\n');

  // 2. Build order calldata
  console.log('2. Building order calldata...');
  const deployments: Array<{ validation: TokenValidation; args: DeploymentArgs }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const v = validations[i];
    const args = await buildOrderCalldata(
      v.merkleRoot,
      String(amounts[i]),
      TOKENS[i].safe,
      outputToken,
      inputToken,
    );
    deployments.push({ validation: v, args });
    console.log(`  ${TOKENS[i].symbol}: calldata built, orderbook=${args.orderbookAddress}`);
  }

  // 3. Simulate on Anvil fork
  console.log('\n3. Running fork simulation...');
  await runSimulation(
    deployments.map((d, i) => ({
      safeAddress: TOKENS[i].safe,
      symbol: TOKENS[i].symbol,
      // SDK approvals have { token, calldata, symbol } — use token as the 'to' address
      approvals: d.args.approvals.map((a) => ({ to: a.token, calldata: a.calldata })),
      deploymentCalldata: d.args.deploymentCalldata,
      orderbookAddress: d.args.orderbookAddress,
    }))
  );

  // 4. Propose Safe transactions
  console.log('\n4. Proposing Safe transactions...');
  const proposals: Array<{ safeTxHash: string; safeUrl: string }> = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const d = deployments[i];
    const transactions = [
      // Map SDK approvals: token is the contract to call
      ...d.args.approvals.map((a) => ({ to: a.token, data: a.calldata, value: '0' })),
      { to: d.args.orderbookAddress, data: d.args.deploymentCalldata, value: '0' },
    ];

    const proposal = await proposeSafeTransaction(TOKENS[i].safe, transactions);
    proposals.push(proposal);
    console.log(`  ${TOKENS[i].symbol}: proposed → ${proposal.safeUrl}`);
  }

  // ---- PAUSE 1 ----
  console.log('\n========================================');
  console.log('PAUSE: Sign and execute BOTH Safe transactions:');
  proposals.forEach((p, i) => console.log(`  ${TOKENS[i].symbol}: ${p.safeUrl}`));
  console.log('========================================\n');

  await waitForEnter('Press Enter after both transactions are signed and executed...');

  // ---- PHASE 2: Finalize ----

  // 5. Wait for execution and extract results
  console.log('\n5. Checking execution status...');
  const executionResults: Array<{ orderHash: string; txHash: string }> = [];

  for (let i = 0; i < TOKENS.length; i++) {
    console.log(`  Polling ${TOKENS[i].symbol}...`);
    const execResult = await waitForExecution(proposals[i].safeTxHash);
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
    const v = validations[i];
    const metadataPath = v.metadataPath;
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

  // ---- PAUSE 2 ----
  console.log('\n========================================');
  console.log('PAUSE: Sign and execute the metadata Safe transaction:');
  console.log(`  ${metadataProposal.safeUrl}`);
  console.log('========================================\n');

  await waitForEnter('Press Enter after the metadata transaction is signed and executed...');

  // 9. Verify metadata tx executed
  console.log('\n9. Checking metadata tx execution...');
  await waitForExecution(metadataProposal.safeTxHash);
  console.log('  Metadata tx executed.');

  // 10. Update issuance-site network.ts and create PR
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

  const prUrl = await updateIssuanceSiteAndPR(r1Update, r2Update, month);
  console.log(`  PR created: ${prUrl}`);

  // Done!
  console.log('\n========================================');
  console.log('Distribution complete!');
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
