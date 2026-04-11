/**
 * Resume from step 9 — verify metadata tx and update issuance site.
 */
import { config } from 'dotenv';
config();

import fs from 'fs';
import { TOKENS } from '../src/constants';
import { resolveOutputDir } from '../src/lib/validation';
import { waitForExecution } from '../src/lib/safe';
import { updateIssuanceSiteAndPR, type IssuanceSiteUpdate } from '../src/lib/github';

const MONTH = '2026-02';
const METADATA_SAFE_TX_HASH = '0x9dcdfb7ab4ee350328e0214b647b6418c39795399bdf69cd62208878d31d14fd';

const executionResults = [
  { orderHash: '0x3b976cdb37e00c214fd7212abd052e5da0760e39f0c8d9631ac122a13c3b4b44', txHash: '0xd047459e82ffce76ba43312465a33a21406ef7ba6cc4d2fc124f5ae0d97f0959' },
  { orderHash: '0xc0b5da036283d08ff457b4146198e66ed1e81a3f7da67d638b3a3c40a9a92f5e', txHash: '0x01c689234fa3912d22a64f2f0e5bb2e1b0020db0ac469adaff099c1d429e83a0' },
];

const csvUploads = [
  { cid: 'bafkreia2ebr2wyuga3d4t6yqwcbbs65hqtqyyycnuo24wj5zo4ikurly7m', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreia2ebr2wyuga3d4t6yqwcbbs65hqtqyyycnuo24wj5zo4ikurly7m' },
  { cid: 'bafkreibnu7oa7rbcm5jzpbxzndobgxzj4pvhx6eptcdl6lhgbw7rredd6e', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreibnu7oa7rbcm5jzpbxzndobgxzj4pvhx6eptcdl6lhgbw7rredd6e' },
];

async function main() {
  const dateRange = resolveOutputDir(MONTH);
  const outputBase = 'output';

  // Read merkle roots from saved trees
  const { SimpleMerkleTree } = await import('@openzeppelin/merkle-tree');
  const actualMerkleRoots = TOKENS.map((token) => {
    const treePath = `${outputBase}/${dateRange}/${token.address}/tree_${dateRange}.json`;
    const tree = SimpleMerkleTree.load(JSON.parse(fs.readFileSync(treePath, 'utf8')));
    return tree.root as string;
  });

  // 9. Verify metadata tx executed
  console.log('9. Checking metadata tx execution...');
  await waitForExecution(METADATA_SAFE_TX_HASH);
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
