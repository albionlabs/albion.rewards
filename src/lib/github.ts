import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';

function run(command: string, args: string[], options?: { cwd?: string }): string {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    cwd: options?.cwd,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

export interface IssuanceSiteUpdate {
  orderHash: string;
  csvCid: string;
  merkleRoot: string;
  csvGatewayUrl: string;
}

/**
 * Locate the Albion-issuance-site repo.
 * Set ISSUANCE_SITE_PATH in .env to override auto-detection.
 */
function findIssuanceSiteRepo(): string {
  const envPath = process.env.ISSUANCE_SITE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.resolve(process.cwd(), '../Albion-issuance-site'),
    path.resolve(process.cwd(), '../../Albion-issuance-site'),
    path.resolve(process.cwd(), '../albion-issuance-site'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Cannot find Albion-issuance-site repo. Set ISSUANCE_SITE_PATH env var or clone as sibling directory.'
  );
}

/**
 * Update network.ts in the issuance-site repo with new claims entries.
 * Creates a new branch and opens a PR via gh CLI.
 */
export async function updateIssuanceSiteAndPR(
  r1Update: IssuanceSiteUpdate,
  r2Update: IssuanceSiteUpdate,
  month: string,
): Promise<string> {
  const repoPath = findIssuanceSiteRepo();
  const networkTsPath = path.join(repoPath, 'src/lib/network.ts');

  if (!fs.existsSync(networkTsPath)) {
    throw new Error(`network.ts not found at ${networkTsPath}`);
  }

  // Read current file
  let content = fs.readFileSync(networkTsPath, 'utf-8');

  // Build entry objects
  const r1Entry = JSON.stringify({
    orderHash: r1Update.orderHash,
    csvLink: r1Update.csvGatewayUrl,
    expectedMerkleRoot: r1Update.merkleRoot,
    expectedContentHash: r1Update.csvCid,
  }, null, 2);

  const r2Entry = JSON.stringify({
    orderHash: r2Update.orderHash,
    csvLink: r2Update.csvGatewayUrl,
    expectedMerkleRoot: r2Update.merkleRoot,
    expectedContentHash: r2Update.csvCid,
  }, null, 2);

  // NOTE: The exact patching strategy depends on the network.ts file structure.
  // During implementation, read the existing entries to understand the exact array
  // name and field names, then implement string-based patching.
  // For now, log the entries for manual confirmation.
  console.log(`R1 claims entry:\n${r1Entry}`);
  console.log(`R2 claims entry:\n${r2Entry}`);
  console.log(`\nnetwork.ts location: ${networkTsPath}`);

  // Git operations
  const branchName = `rewards-${month}`;

  run('git', ['checkout', 'main'], { cwd: repoPath });
  run('git', ['pull', 'origin', 'main'], { cwd: repoPath });
  run('git', ['checkout', '-b', branchName], { cwd: repoPath });

  run('git', ['add', 'src/lib/network.ts'], { cwd: repoPath });
  run('git', ['commit', '-m', `feat: add ${month} rewards claims data`], { cwd: repoPath });
  run('git', ['push', '-u', 'origin', branchName], { cwd: repoPath });

  const prUrl = run('gh', [
    'pr', 'create',
    '--title', `Add ${month} rewards claims data`,
    '--body', `Automated by distribute.ts\n\nR1 orderHash: ${r1Update.orderHash}\nR2 orderHash: ${r2Update.orderHash}`,
    '--base', 'main',
  ], { cwd: repoPath });

  return prUrl;
}
