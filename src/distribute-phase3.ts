/**
 * Phase 3: Verify metadata tx, update issuance-site, create PR.
 *
 * Usage: npx tsx src/distribute-phase3.ts --month YYYY-MM
 *
 * Reads state from phase 2. Creates issuance-site PR.
 */
import { config } from 'dotenv';
config();

import fs from 'fs';
import { TOKENS } from './constants';
import { resolveOutputDir } from './lib/validation';
import { waitForExecution } from './lib/safe';
import { updateIssuanceSiteAndPR, type IssuanceSiteUpdate } from './lib/github';

function parseMonth(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--month' && args[i + 1]) return args[i + 1];
  }
  console.error('Usage: npx tsx src/distribute-phase3.ts --month YYYY-MM');
  process.exit(1);
}

interface Phase2State {
  month: string;
  dateRange: string;
  merkleRoots: string[];
  executionResults: Array<{ orderHash: string; txHash: string }>;
  csvUploads: Array<{ cid: string; gatewayUrl: string }>;
  metadataProposal: { safeTxHash: string; safeUrl: string };
}

function loadState(dateRange: string): Phase2State {
  const statePath = `output/${dateRange}/distribute-state.json`;
  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found: ${statePath}. Run phases 1 and 2 first.`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state.metadataProposal) {
    throw new Error('State missing metadataProposal. Run phase 2 first.');
  }
  return state;
}

async function main() {
  const month = parseMonth();
  const dateRange = resolveOutputDir(month);
  const state = loadState(dateRange);

  console.log(`\n=== Phase 3: Verify Metadata & Update Issuance Site (${month}) ===\n`);

  // 9. Verify metadata tx executed
  console.log('9. Checking metadata tx execution...');
  await waitForExecution(state.metadataProposal.safeTxHash);
  console.log('  Metadata tx executed.');

  // 10. Update issuance-site network.ts and create PR
  console.log('\n10. Updating issuance-site...');

  const r1Update: IssuanceSiteUpdate = {
    orderHash: state.executionResults[0].orderHash,
    csvCid: state.csvUploads[0].cid,
    merkleRoot: state.merkleRoots[0],
    csvGatewayUrl: state.csvUploads[0].gatewayUrl,
  };

  const r2Update: IssuanceSiteUpdate = {
    orderHash: state.executionResults[1].orderHash,
    csvCid: state.csvUploads[1].cid,
    merkleRoot: state.merkleRoots[1],
    csvGatewayUrl: state.csvUploads[1].gatewayUrl,
  };

  const prUrl = await updateIssuanceSiteAndPR(r1Update, r2Update, month);
  console.log(`  PR created: ${prUrl}`);

  // Done!
  console.log('\n========================================');
  console.log('Distribution complete!');
  console.log(`  R1 orderHash: ${state.executionResults[0].orderHash}`);
  console.log(`  R2 orderHash: ${state.executionResults[1].orderHash}`);
  console.log(`  R1 txHash: ${state.executionResults[0].txHash}`);
  console.log(`  R2 txHash: ${state.executionResults[1].txHash}`);
  console.log(`  R1 CSV CID: ${state.csvUploads[0].cid}`);
  console.log(`  R2 CSV CID: ${state.csvUploads[1].cid}`);
  console.log(`  Issuance-site PR: ${prUrl}`);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nFATAL:', error.message || error);
  process.exit(1);
});
