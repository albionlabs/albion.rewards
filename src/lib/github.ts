import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { TOKENS } from '../constants';

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
 * Format a claim entry as TypeScript source matching network.ts style.
 */
function formatClaimEntry(update: IssuanceSiteUpdate, indent: string): string {
  return [
    `${indent}{`,
    `${indent}  orderHash:`,
    `${indent}    "${update.orderHash}",`,
    `${indent}  csvLink: \`\${PINATA_GATEWAY}/${update.csvCid}\`,`,
    `${indent}  expectedMerkleRoot:`,
    `${indent}    "${update.merkleRoot}",`,
    `${indent}  expectedContentHash:`,
    `${indent}    "${update.csvCid}",`,
    `${indent}}`,
  ].join('\n');
}

/**
 * Insert a new claim entry into a token's claims array in network.ts.
 *
 * Finds the token by address (case-insensitive) in PROD_ENERGY_FIELDS,
 * then appends after the last claim entry in its claims array.
 */
function insertClaim(content: string, tokenAddress: string, update: IssuanceSiteUpdate): string {
  // Find the token's address line in PROD_ENERGY_FIELDS
  const addrLower = tokenAddress.toLowerCase();
  const lines = content.split('\n');

  // Locate the line with this token address inside PROD_ENERGY_FIELDS
  let tokenLineIdx = -1;
  let inProd = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('PROD_ENERGY_FIELDS')) inProd = true;
    if (inProd && lines[i].toLowerCase().includes(addrLower)) {
      tokenLineIdx = i;
      break;
    }
  }

  if (tokenLineIdx === -1) {
    throw new Error(`Token ${tokenAddress} not found in PROD_ENERGY_FIELDS`);
  }

  // Find the claims array closing bracket `],` after this token address.
  // Walk forward from the token line, tracking brace/bracket depth to find
  // the end of the claims array.
  let claimsStart = -1;
  for (let i = tokenLineIdx; i < lines.length; i++) {
    if (lines[i].includes('claims:')) {
      claimsStart = i;
      break;
    }
  }

  if (claimsStart === -1) {
    throw new Error(`claims array not found for token ${tokenAddress}`);
  }

  // Find the closing `],` of the claims array by tracking bracket depth
  let depth = 0;
  let claimsEnd = -1;
  for (let i = claimsStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '[') depth++;
      if (ch === ']') {
        depth--;
        if (depth === 0) {
          claimsEnd = i;
          break;
        }
      }
    }
    if (claimsEnd !== -1) break;
  }

  if (claimsEnd === -1) {
    throw new Error(`Could not find end of claims array for token ${tokenAddress}`);
  }

  // The last claim entry ends with `}` or `},` before the `],` line.
  let lastEntryEnd = -1;
  for (let i = claimsEnd - 1; i > claimsStart; i--) {
    const trimmed = lines[i].trimEnd();
    if (trimmed.endsWith('}') || trimmed.endsWith('},')) {
      lastEntryEnd = i;
      break;
    }
  }

  if (lastEntryEnd === -1) {
    throw new Error(`Could not find last claim entry for token ${tokenAddress}`);
  }

  // Ensure trailing comma on last entry
  if (!lines[lastEntryEnd].trimEnd().endsWith(',')) {
    lines[lastEntryEnd] = lines[lastEntryEnd].replace(/}\s*$/, '},');
  }

  // Determine indentation from existing entries
  const indent = '          ';
  const newEntry = formatClaimEntry(update, indent);

  // Insert after lastEntryEnd
  lines.splice(lastEntryEnd + 1, 0, newEntry);

  return lines.join('\n');
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

  // Patch network.ts with new claims
  let content = fs.readFileSync(networkTsPath, 'utf-8');
  content = insertClaim(content, TOKENS[0].address, r1Update);
  content = insertClaim(content, TOKENS[1].address, r2Update);
  fs.writeFileSync(networkTsPath, content);

  console.log(`  Patched network.ts with R1 and R2 claims`);

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
