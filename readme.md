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
nix develop -c npm run merkle output/2025-09-01_to_2025-09-30/0xd5316ca888491575befc0273a00de2186c53f760/rewards.csv
```

## Output Structure

The pipeline generates files in the following structure:

```
output/
└── 2025-09-01_to_2025-09-30/                  # Date range directory
    └── 0xd5316ca888491575befc0273a00de2186c53f760/  # Token address directory
        ├── snapshot.json                       # Generated snapshots
        ├── balances.json                       # Detailed balance analysis
        ├── rewards.csv                         # CSV format rewards
        └── tree.json                          # Merkle tree for smart contract
```

### File Descriptions

- **`snapshot.json`**: Contains randomly generated block numbers for daily snapshots
- **`balances.json`**: Detailed balance analysis with proportions and rewards
- **`rewards.csv`**: Simple CSV format with `index,address,amount` for distribution
- **`tree.json`**: Merkle tree data for on-chain reward claiming

## Configuration

### Parameters

- **Start Timestamp**: Unix timestamp in seconds for the start of the reward period
- **End Timestamp**: Unix timestamp in seconds for the end of the reward period
- **Token Address**: Albion Energy Token Address
- **Distribution Amount**: Total reward amount in USD. Eg: 1000 for $1000 worth of rewards.

**Timestamp Examples:**
- `1725148800` = September 1, 2025 00:00:00 UTC
- `1727740799` = September 30, 2025 23:59:59 UTC

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