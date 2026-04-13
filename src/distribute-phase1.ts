/**
 * Phase 1: Pre-flight checks, build calldata, simulate, propose Safe transactions.
 *
 * Usage: npx tsx src/distribute-phase1.ts --month YYYY-MM --r1-amount <USDC> --r2-amount <USDC>
 * Optional: --output-token <address> --input-token <address>
 *
 * Outputs Safe transaction URLs to sign. Saves state for phase 2.
 */
import { config } from 'dotenv';
config();

import fs from 'fs';
import { ethers } from 'ethers';
import { TOKENS, METADATA_SAFE, USDC_BASE, WETH_BASE } from './constants';
import { resolveOutputDir, validateToken, checkUsdcBalance } from './lib/validation';
import { buildOrderCalldata } from './lib/order';
import { runSimulation } from './lib/simulation';
import { proposeSafeTransaction, checkDelegate } from './lib/safe';
import { assertCleanGitState } from './lib/git';

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
    console.error('Usage: npx tsx src/distribute-phase1.ts --month YYYY-MM --r1-amount <USDC> --r2-amount <USDC>');
    console.error('Optional: --output-token <address> --input-token <address>');
    process.exit(1);
  }

  return { month, r1Amount, r2Amount, outputToken, inputToken };
}

async function main() {
  const { month, r1Amount, r2Amount, outputToken, inputToken } = parseArgs();
  const amounts = [r1Amount, r2Amount];

  console.log(`\n=== Phase 1: Prepare & Propose (${month}) ===`);
  if (outputToken !== USDC_BASE || inputToken !== WETH_BASE) {
    console.log(`  Custom tokens: output=${outputToken}, input=${inputToken}`);
  }
  console.log();

  // 1. Pre-flight checks
  console.log('1. Running pre-flight checks...');
  assertCleanGitState();

  const dateRange = resolveOutputDir(month);
  const outputBase = 'output';

  const validations = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const v = validateToken(outputBase, dateRange, TOKENS[i], amounts[i]);
    validations.push(v);
    console.log(`  ${TOKENS[i].symbol}: CSV OK, merkle root ${v.merkleRoot.slice(0, 10)}...`);
  }

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
  const deployments = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const args = await buildOrderCalldata(
      validations[i].merkleRoot,
      String(amounts[i]),
      TOKENS[i].safe,
      outputToken,
      inputToken,
    );
    deployments.push(args);
    console.log(`  ${TOKENS[i].symbol}: calldata built, orderbook=${args.orderbookAddress}`);
  }

  // 3. Simulate on Anvil fork
  console.log('\n3. Running fork simulation...');
  await runSimulation(
    deployments.map((d, i) => ({
      safeAddress: TOKENS[i].safe,
      symbol: TOKENS[i].symbol,
      approvals: d.approvals.map((a) => ({ to: a.token, calldata: a.calldata })),
      deploymentCalldata: d.deploymentCalldata,
      orderbookAddress: d.orderbookAddress,
    }))
  );

  // 4. Propose Safe transactions
  console.log('\n4. Proposing Safe transactions...');
  const proposals = [];
  for (let i = 0; i < TOKENS.length; i++) {
    const d = deployments[i];
    const transactions = [
      ...d.approvals.map((a) => ({ to: a.token, data: a.calldata, value: '0' })),
      { to: d.orderbookAddress, data: d.deploymentCalldata, value: '0' },
    ];

    const proposal = await proposeSafeTransaction(TOKENS[i].safe, transactions);
    proposals.push(proposal);
    console.log(`  ${TOKENS[i].symbol}: proposed → ${proposal.safeUrl}`);
  }

  // Save state for phase 2
  const statePath = `${outputBase}/${dateRange}/distribute-state.json`;
  const state = {
    month,
    dateRange,
    r1Amount,
    r2Amount,
    outputToken,
    inputToken,
    proposals: proposals.map((p, i) => ({
      symbol: TOKENS[i].symbol,
      safeTxHash: p.safeTxHash,
      safeUrl: p.safeUrl,
    })),
    merkleRoots: validations.map((v) => v.merkleRoot),
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log(`\nState saved to ${statePath}`);
  console.log('\n========================================');
  console.log('Sign and execute BOTH Safe transactions:');
  proposals.forEach((p, i) => console.log(`  ${TOKENS[i].symbol}: ${p.safeUrl}`));
  console.log('\nThen run: npx tsx src/distribute-phase2.ts --month ' + month);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nFATAL:', error.message || error);
  process.exit(1);
});
