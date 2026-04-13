# Albion Rewards

A pipeline for calculating token rewards based on historical balance snapshots using multi-snapshot analysis and merkle tree generation.

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd albion.rewards
```

2. Install dependencies:
```bash
nix develop -c npm install
```

## Usage

### Quick Start

**Snapshot Configuration:**
Update .env file with : 
- **SNAPSHOT_BLOCK_1**: Start block for the reward period
- **SNAPSHOT_BLOCK_2**: End block for the reward period

Run the complete pipeline with a single command:

```bash
./calculate_claims.sh <startTimestamp> <endTimestamp> <tokenAddress> <distributionAmount>
```

**Example:**
```bash
./calculate_claims.sh 1725148800 1727740799 0xd5316ca888491575befc0273a00de2186c53f760 1000000
```

**Note:** Timestamps should be Unix timestamps in seconds. You can convert dates to timestamps using online converters or command line tools.

### Pipeline Steps

The `calculate_claims.sh` script runs the following steps:

1. **Data Scraping**: Fetches transfer data from blockchain
2. **Snapshot Generation**: Creates random daily snapshots for the specified time range
3. **Balance Processing**: Calculates average balances and proportions
4. **Merkle Tree Generation**: Creates merkle tree for on-chain distribution

### Individual Commands

You can also run individual steps:

```bash
# Step 1: Scrape transfer data
nix develop -c npm run scrape

# Step 2: Generate snapshots
nix develop -c npm run generate-snapshots 1725148800 1727740799 0xd5316ca888491575befc0273a00de2186c53f760

# Step 3: Process transfers and calculate rewards
nix develop -c npm run start output/2025-09-01_to_2025-09-30/0xd5316ca888491575befc0273a00de2186c53f760/snapshot.json 0xd5316ca888491575befc0273a00de2186c53f760 1000000

# Step 4: Generate merkle tree
nix develop -c npm run merkle output/2025-09-01_to_2025-09-30/0xd5316ca888491575befc0273a00de2186c53f760/rewards_2025-09-01_to_2025-09-30.csv
```

## Output Structure

The pipeline generates files in the following structure:

```
output/
└── 2025-09-01_to_2025-09-30/                  # Date range directory
    └── 0xd5316ca888491575befc0273a00de2186c53f760/  # Token address directory
        ├── snapshot.json                       # Generated snapshots
        ├── balances.json                       # Detailed balance analysis
        ├── rewards_2025-09-01_to_2025-09-30.csv # CSV format rewards with date range
        └── tree_2025-09-01_to_2025-09-30.json # Merkle tree for smart contract with date range
```

### File Descriptions

- **`snapshot.json`**: Contains randomly generated block numbers for daily snapshots
- **`balances.json`**: Detailed balance analysis with proportions and rewards
- **`rewards_YYYY-MM-DD_to_YYYY-MM-DD.csv`**: Simple CSV format with `index,address,amount` for distribution (includes date range in filename)
- **`tree_YYYY-MM-DD_to_YYYY-MM-DD.json`**: Merkle tree data for on-chain reward claiming (includes date range in filename)

## Configuration

### Parameters

- **Start Timestamp**: Unix timestamp in seconds for the start of the reward period
- **End Timestamp**: Unix timestamp in seconds for the end of the reward period
- **Token Address**: Albion Energy Token Address
- **Distribution Amount**: Total reward amount in USD. Eg: 1000 for $1000 worth of rewards.

**Timestamp Examples:**
- `1725148800` = September 1, 2025 00:00:00 UTC
- `1727740799` = September 30, 2025 23:59:59 UTC

## Distribution

Automates the on-chain distribution workflow: Raindex order deployment, metadata updates, IPFS uploads, on-chain metadata pinning, and issuance-site PR creation.

Distribution runs in **3 phases**, separated by Safe multisig signing steps.

### Prerequisites

- **Foundry** (for `anvil` fork simulation):
  ```bash
  curl -L https://foundry.paradigm.xyz | bash && foundryup
  ```
- **GitHub CLI** authenticated (`gh auth status`)
- **Proposer EOA** registered as a delegate on all 3 Safes (R1, R2, Metadata) via Safe UI

### Environment Variables

Add the following to your `.env`:

| Variable | Description |
|----------|-------------|
| `PROPOSER_PRIVATE_KEY` | EOA private key registered as Safe delegate. Generate with `npm run generate-key` |
| `BASE_RPC_URL` | Base mainnet RPC (e.g. Alchemy) |
| `PINATA_JWT` | Pinata v3 API JWT for IPFS uploads |
| `SAFE_API_KEY` | Safe Transaction Service API key |
| `GITHUB_TOKEN` | Fine-grained PAT with Contents + Pull requests read/write on issuance-site repo |
| `ISSUANCE_SITE_PATH` | Optional. Path to `Albion-issuance-site` clone (auto-detected if sibling directory) |

### Proposer key

The proposer is a **delegate** (not an owner) on the Safe multisigs. Generate a key pair:

```bash
npm run generate-key
```

This writes the private key to `.env` and saves the public address to `proposer-address.json`. Register the address as a delegate on each Safe (R1, R2, and Metadata).

### Phase 1: Validate, simulate, and propose

```bash
npm run distribute:phase1 -- --month 2026-02 --r1-amount 728.46 --r2-amount 2630.26
```

1. Validates CSVs, merkle trees, metadata, delegate status, and Safe USDC balances
2. Builds Raindex order calldata via the Rain SDK
3. Simulates transactions on an Anvil fork
4. Proposes Safe transactions for both tokens

**Action required:** Sign and execute both Safe transactions in the Safe UI.

### Phase 2: Finalize orders and propose metadata

```bash
npm run distribute:phase2 -- --month 2026-02
```

5. Verifies both Safe transactions executed and extracts order hashes
6. Patches `metadata.json` with txHash, orderHash, and date, then commits and pushes
7. Uploads reward CSVs to Pinata (IPFS)
8. Proposes MetaBoard `emitMeta` transaction via the Metadata Safe

**Action required:** Sign and execute the metadata Safe transaction.

### Phase 3: Verify metadata and update issuance site

```bash
npm run distribute:phase3 -- --month 2026-02
```

9. Verifies the metadata transaction executed
10. Patches `network.ts` in `Albion-issuance-site` with new claim entries and creates a PR

### CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--month` | required | Target month (`YYYY-MM`) |
| `--r1-amount` | required (phase 1 only) | USDC deposit for R1 (must be >= CSV total) |
| `--r2-amount` | required (phase 1 only) | USDC deposit for R2 (must be >= CSV total) |
| `--output-token` | USDC (Base) | Override output token address |
| `--input-token` | WETH (Base) | Override input token address |

### State file

Phases communicate via `output/{dateRange}/distribute-state.json`. Phase 1 writes it, phase 2 updates it, phase 3 reads it.

### Module structure

```
src/
  distribute-phase1.ts   # Validate, simulate, propose orders
  distribute-phase2.ts   # Finalize orders, upload, propose metadata
  distribute-phase3.ts   # Verify metadata, update issuance site
  constants.ts           # Addresses, ABIs, magic numbers
  lib/
    validation.ts        # Pre-flight checks (CSV, merkle, balances)
    order.ts             # DotrainOrderGui wrapper (order calldata)
    simulation.ts        # Anvil fork simulation
    safe.ts              # Safe SDK (propose, poll, extract orderHash)
    metadata.ts          # CBOR encoding, MetaBoard calls, JSON patching
    pinata.ts            # Pinata v3 API upload
    git.ts               # Git operations (commit + push metadata)
    github.ts            # Issuance-site patching + PR creation
```

## Algorithm Details

### Reward Calculation

1. **Snapshot Generation**: Creates 2 random blocks per day for the specified time range
2. **Balance Tracking**: Processes all transfers to calculate balances at each snapshot
3. **Proportion Calculation**: Calculates each user's proportion at each snapshot, then averages those proportions
4. **Reward Distribution**: Allocates rewards based on average proportions across all snapshots

### Merkle Tree Generation

1. **Padding**: Ensures exactly 256 entries (pads with zero addresses if needed)
2. **Hashing**: Creates keccak256 hash of `[index, address, amount]` for each entry
3. **Tree Construction**: Builds merkle tree using OpenZeppelin's StandardMerkleTree
4. **Output**: Generates tree.json with merkle root and proof data