import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const PROPOSER_FILE = path.join(ROOT, 'proposer-address.json');

function main() {
  // Check if key already exists in .env
  if (fs.existsSync(ENV_PATH)) {
    const env = fs.readFileSync(ENV_PATH, 'utf-8');
    if (env.includes('PROPOSER_PRIVATE_KEY=0x')) {
      console.log('PROPOSER_PRIVATE_KEY already set in .env — aborting.');
      console.log('Delete the line from .env first if you want to regenerate.');
      process.exit(1);
    }
  }

  const wallet = ethers.Wallet.createRandom();
  const privateKey = wallet.privateKey;   // 0x-prefixed hex
  const address = wallet.address;          // checksummed

  // Append to .env (create if missing)
  const envLine = `PROPOSER_PRIVATE_KEY=${privateKey}\n`;
  fs.appendFileSync(ENV_PATH, envLine);
  console.log(`Private key written to .env`);

  // Write public address to a committed file
  const info = {
    address,
    generatedAt: new Date().toISOString(),
    note: 'This is the proposer address. The private key lives in .env (gitignored). Import into Rabby for safekeeping.',
  };
  fs.writeFileSync(PROPOSER_FILE, JSON.stringify(info, null, 2) + '\n');
  console.log(`Proposer address written to proposer-address.json`);

  console.log(`\n  Address: ${address}`);
  console.log(`\n  Next steps:`);
  console.log(`  1. Import the private key from .env into Rabby`);
  console.log(`  2. Add this address as a delegate on your Safe(s)`);
}

main();
