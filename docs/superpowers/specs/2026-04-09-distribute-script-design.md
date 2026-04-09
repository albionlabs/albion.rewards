# Distribute Script Design

**Date:** 2026-04-09
**Status:** Draft
**Scope:** End-to-end automation of monthly USDC rewards distribution for Albion SFT tokens

## Problem

Each month the Albion team distributes USDC rewards to holders of two SFT tokens (ALB-WR1-R1 and ALB-WR1-R2) on Base. The current process involves ~40 manual actions across multiple UIs: raindex.finance for order deployment, Safe UI for signing, albion.h20.market for metadata pinning, Pinata web UI for CSV uploads, and GitHub for repo updates. This is error-prone and time-consuming.

## Solution

A single interactive TypeScript CLI script (`tsx src/distribute.ts`) that automates all 5 steps of the current gist workflow, pausing twice for Safe multisig signing.

## Gist Steps Mapped to Script

The script automates the 5-step manual workflow documented in the [distribution gist](https://gist.github.com/Siddharth2207/958063f2676225f44bd48b955377d9d0):

| Gist step | Manual action | Script automation |
|---|---|---|
| 1. Deploy claims order + deposit | Connect Safe wallet to raindex.finance, fill form, deploy, deposit USDC | SDK builds calldata, script proposes bundled Safe tx |
| 2. Update metadata.json | Edit file on GitHub with orderHash, txHash, date, amount | Script patches JSON, commits + pushes to branch |
| 3. Pin metadata on SFTs | Visit albion.h20.market, upload metadata per token | Script CBOR-encodes metadata, proposes MetaBoard emitMeta via Safe |
| 4. Upload CSVs to Pinata | Login to Pinata web UI, upload CSVs, copy CIDs | Script calls Pinata v3 API directly |
| 5. Update network.ts + PR | Edit file in Albion-issuance-site, open PR | Script patches file, opens PR via gh CLI |

## Architecture

### CLI Interface

```
tsx src/distribute.ts \
  --month 2026-03 \
  --r1-amount 1234.56 \
  --r2-amount 789.01
```

Single interactive script with two pause points for Safe multisig signing. State lives in memory (no intermediate files).

### Script Flow

```
PHASE 1: Prepare
  1. Validate inputs
     - CSV exists for both tokens in output/<month>/
     - Merkle tree builds, root matches tree JSON
     - Pending metadata entry exists with empty date/txHash/orderHash
     - Amounts match CSV totals
     - Safe delegate is registered
     - USDC balance sufficient in each Safe

  2. Simulate on anvil fork
     - Fork Base mainnet
     - Impersonate each Safe, execute approve + addOrder2 calldata
     - Verify AddOrderV2 event emitted
     - Verify USDC deposited into vault
     - Kill fork

  3. Propose R1 + R2 Safe transactions
     - DotrainOrderGui.getDeploymentTransactionArgs(safeAddress)
     - Bundle approve + deploy into MultiSend
     - proposeTransaction to R1 Safe
     - proposeTransaction to R2 Safe
     - Print Safe TX URLs

  PAUSE: "Sign and execute both Safe txs, then press Enter..."

PHASE 2: Finalize
  4. Read execution results
     - Fetch R1 + R2 tx receipts from Base RPC
     - Extract orderHash from AddOrderV2 event logs
     - Extract txHash from executed Safe transactions

  5. Update metadata.json (gist step 2)
     - Patch pending payoutData entries with orderHash, txHash, date
     - git commit + push to current branch

  6. Upload CSVs to Pinata (gist step 4)
     - POST both reward CSVs to Pinata v3 API
     - Capture CIDs

  7. Pin metadata on SFTs (gist step 3)
     - Upload updated metadata JSON to Pinata, get CID
     - CBOR-encode: deflate JSON, encode structure with OA_STRUCTURE + schema hash,
       encode hash list with OA_HASH_LIST, prefix with RAIN_META_DOCUMENT magic
     - Build emitMeta(subject, metadata) calls for both tokens
     - Batch both calls into single MultiSend
     - Propose to Metadata Safe
     - Print Safe TX URL

  PAUSE: "Sign and execute metadata Safe tx, then press Enter..."

  8. Update network.ts (gist step 5)
     - Patch DEV_ENERGY_FIELDS with orderHash, csvLink, merkleRoot, contentHash
     - Open PR to Albion-issuance-site via gh CLI

  DONE
```

Step ordering differs from the gist because: metadata.json needs orderHash/txHash (from step 4), and the CBOR-encoded metadata (step 7) needs both the updated JSON content and the Pinata CID (from step 6).

### Safe Integration

Uses the traditional Safe SDK (not the ERC-4337/Pimlico approach used by operator.portal):

- `@safe-global/protocol-kit` — build + sign transactions locally
- `@safe-global/api-kit` — submit proposals to Safe Transaction Service

**Proposer wallet:** A dedicated EOA added as a delegate on all 3 Safes. Signs off-chain only (no ETH needed). Private key stored in `.env`.

**Flow per Safe proposal:**

```ts
// Init protocol kit with proposer wallet
const protocolKit = await Safe.init({
  provider: BASE_RPC_URL,
  signer: PROPOSER_PRIVATE_KEY,
  safeAddress: SAFE_ADDRESS
});

// Bundle approve + deploy into MultiSend
const safeTransaction = await protocolKit.createTransaction({
  transactions: [
    { to: USDC_ADDRESS, data: approvalCalldata, value: '0' },
    { to: orderbookAddress, data: deploymentCalldata, value: '0' }
  ]
});

// Sign off-chain
const signedTx = await protocolKit.signTransaction(safeTransaction);

// Submit to Safe Transaction Service
const apiKit = new SafeApiKit({ chainId: 8453n });
await apiKit.proposeTransaction({
  safeAddress: SAFE_ADDRESS,
  safeTransactionData: signedTx.data,
  safeTxHash: await protocolKit.getTransactionHash(signedTx),
  senderAddress: PROPOSER_ADDRESS,
  senderSignature: signedTx.encodedSignatures()
});
```

**After user signs+executes in Safe UI:**

```ts
const tx = await apiKit.getTransaction(safeTxHash);
// tx.isExecuted === true, tx.transactionHash has the on-chain hash
const receipt = await provider.getTransactionReceipt(tx.transactionHash);
const orderHash = extractOrderHashFromReceipt(receipt);
```

**Safe addresses:**
- R1 Safe: `0xA51fd23D6E2442805130eac0712F590691e91517`
- R2 Safe: `0x1c56Fc57BBc18879D8059562A371722b682CA984`
- Metadata Safe: `0x4E5Bd3Cf829010280F76754B49921d4e1448B8Cf`

**Total signing sessions:** 2 (R1+R2 together, then Metadata Safe).

### Order Deployment via SDK

Uses the same `@rainlanguage/orderbook` SDK as the raindex v4 webapp. The SDK abstracts away the `addOrder2`/`deposit2` contract calls entirely:

```ts
// Same pattern as raindex v4 webapp's handleGuiInitialization + handleAddOrder
const gui = await DotrainOrderGui.newWithDeployment(dotrain, deploymentKey, noop);
gui.setSelectToken('output', USDC_ADDRESS);
gui.setSelectToken('input', WETH_ADDRESS);
gui.setFieldValue('root', merkleRoot);
gui.setDeposit('output', humanReadableAmount);

const result = await gui.getDeploymentTransactionArgs(safeAddress);
// result.value = { approvals, deploymentCalldata, orderbookAddress, chainId }
```

`deploymentCalldata` contains the `addOrder2(OrderConfigV3, TaskV1[])` call with the deposit bundled via `TaskV1` post-action. The SDK version must be pinned to match raindex v4 to ensure `addOrder2` (not `addOrder3`).

The claims `.rain` strategy file is fetched from a pinned URL/commit.

### Metadata Encoding

Lifted from operator.portal. The encoding pipeline:

```
JSON string
  → pako.deflate() → hex bytes
  → CBOR map { 0: deflated, 1: OA_STRUCTURE, 2: "application/json", 3: "deflate", OA_SCHEMA: schemaHash }
  → encodedStructure (hex)

IPFS CID (from Pinata upload)
  → CBOR map { 0: cidString, 1: OA_HASH_LIST }
  → encodedHashList (hex)

Final metadata = "0x" + RAIN_META_DOCUMENT (hex) + encodedStructure + encodedHashList
```

Contract call: `metaboard.emitMeta(subject, metadata)` where `subject = 0x000000000000000000000000<tokenAddress>`.

**Magic numbers** (from operator.portal `consts.ts`):
- `RAIN_META_DOCUMENT`: `0xff0a89c674ee7874`
- `OA_STRUCTURE`: `0xffc47a6299e8a911`
- `OA_HASH_LIST`: `0xff9fae3cc645f463`
- `OA_SCHEMA`: `0xffa8e8a9b9cf4a31`

### Pinata Upload

Direct API call (no server route needed since this is a CLI):

```ts
const formData = new FormData();
formData.append('file', new Blob([csvContent], { type: 'text/csv' }), filename);
formData.append('network', 'public');
formData.append('name', filename);

const response = await fetch('https://uploads.pinata.cloud/v3/files', {
  method: 'POST',
  headers: { Authorization: `Bearer ${PINATA_JWT}` },
  body: formData
});
// response.data.cid is the content hash
```

Used for both CSV uploads (step 6) and metadata JSON uploads (step 7).

### OrderHash Extraction

After Safe tx execution, extract `orderHash` from the `AddOrderV2` event in the transaction receipt. The event topic and decoding approach is adapted from operator.portal's `contractCalls.ts:extractOrderHashFromReceipt`, adjusted for the v4 orderbook's `AddOrderV2` event signature instead of `AddOrderV3`.

### Git Operations

- **metadata.json update (step 5):** `git add` + `git commit` + `git push` to the current rewards branch (e.g., `2026-03-rewards`). No PR — direct push.
- **network.ts update (step 8):** Clone or use existing local checkout of `Albion-issuance-site`, patch `src/lib/network.ts`, push new branch, open PR via `gh pr create`.

## File Structure

```
src/
  distribute.ts          # Main script: CLI args, interactive flow, orchestration
  lib/
    safe.ts              # Safe SDK wrapper: propose, poll for execution, extract results
    order.ts             # DotrainOrderGui wrapper: build deployment calldata
    metadata.ts          # CBOR encoding, MetaBoard call builder, metadata JSON patching
    pinata.ts            # Pinata v3 API upload
    simulation.ts        # Anvil fork simulation
    github.ts            # network.ts patching + PR creation (shells out to gh)
  constants.ts           # Existing + new addresses (USDC, WETH, MetaBoard, strategy URL)
  merkle.ts              # Existing (unchanged)
  # ... remaining existing files unchanged
```

## Dependencies

### New packages

| Package | Purpose |
|---|---|
| `@rainlanguage/orderbook` | `DotrainOrderGui` — same SDK the raindex v4 webapp uses |
| `@safe-global/protocol-kit` | Build + sign Safe transactions |
| `@safe-global/api-kit` | Propose to Safe Transaction Service |
| `pako` | Deflate JSON for CBOR metadata encoding |
| `cbor-web` | CBOR-encode Rain meta documents |

### Existing packages (already installed)

| Package | Used for |
|---|---|
| `ethers` | RPC provider, ABI encoding, tx receipt parsing |
| `@openzeppelin/merkle-tree` | Merkle tree (existing `src/merkle.ts`) |
| `dotenv` | Environment variables |

### Code vendored from operator.portal

Copied into `src/lib/metadata.ts`:
- `deflateJson()` — pako deflate to hex
- `cborEncode()` — CBOR map encoding with magic numbers
- `encodeCBORStructure()` — deflate + CBOR with OA_STRUCTURE
- `generateMetaboardSubject()` — left-pad token address to bytes32
- `MAGIC_NUMBERS` constant object
- MetaBoard ABI fragment (`emitMeta(bytes32, bytes)`)

## Configuration

### .env additions

```
# Proposer wallet (delegate on all 3 Safes)
PROPOSER_PRIVATE_KEY=0x...

# Pinata
PINATA_JWT=...
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs

# RPC
BASE_RPC_URL=https://mainnet.base.org

# GitHub token (for issuance-site PR, or use gh CLI auth)
GITHUB_TOKEN=ghp_...
```

### Constants additions (src/constants.ts)

```ts
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const WETH_BASE = '0x4200000000000000000000000000000000000006';
export const METABOARD_ADDRESS = '0x...';  // from operator.portal network config
export const CLAIMS_STRATEGY_URL = '...';  // pinned .rain strategy file

export const R1_SAFE = '0xA51fd23D6E2442805130eac0712F590691e91517';
export const R2_SAFE = '0x1c56Fc57BBc18879D8059562A371722b682CA984';
export const METADATA_SAFE = '0x4E5Bd3Cf829010280F76754B49921d4e1448B8Cf';

export const R1_TOKEN = '0xf836a500910453a397084ade41321ee20a5aade1';
export const R2_TOKEN = '0x1d57246fd0ba134d7cc78ddf3ed829379d95f4b7';
```

### One-time setup

1. Generate proposer EOA: `cast wallet new`
2. Add as delegate on all 3 Safes (Safe UI > Settings > Delegates)
3. Pin claims `.rain` strategy file URL
4. Populate `.env` with all required values
5. Ensure `anvil` is installed (part of Foundry toolchain)

## Pre-flight Checks

Before proposing any Safe transactions, the script runs these validations:

| Check | How | Abort if |
|---|---|---|
| CSV exists | Read `output/<month>/<token>/rewards_*.csv` | File missing |
| CSV format valid | Parse columns: index, address, amount; exactly 256 rows | Wrong columns or row count |
| Merkle root matches | Rebuild tree from CSV via `src/merkle.ts`, compare with `tree_*.json` | Root mismatch |
| Amounts match | Sum CSV `amount` column = CLI `--r1-amount` / `--r2-amount` (in USDC wei) | Mismatch |
| Pending metadata entry | Parse `metadata.json`, find entry with empty `date`/`txHash`/`orderHash` | No pending entry |
| Safe delegate registered | `apiKit.getSafeDelegates(safeAddress)` includes proposer | Not registered |
| USDC balance sufficient | `usdc.balanceOf(safeAddress)` >= distribution amount | Insufficient balance |

## Fork Simulation

After pre-flight checks pass, before proposing:

1. Start `anvil --fork-url $BASE_RPC_URL --port 8546`
2. For each token (R1, R2):
   - Impersonate the Safe: `anvil_impersonateAccount`
   - Send approval tx: `from: safe, to: USDC, data: approvalCalldata`
   - Send deploy tx: `from: safe, to: orderbookAddress, data: deploymentCalldata`
   - Verify `AddOrderV2` event in receipt
   - Verify USDC vault balance >= deposit amount
3. Kill anvil

If any simulation step fails, script aborts with error details. Nothing is proposed to any Safe.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| SDK version mismatch (addOrder3 instead of addOrder2) | Pin `@rainlanguage/orderbook` to exact version from raindex v4 branch |
| Merkle encoding mismatch | Existing keccak256 packed encoding in `src/merkle.ts` is retained; fork simulation verifies the order deploys correctly |
| Stale fork simulation | Fork is created fresh each run from latest Base block |
| Proposer key compromise | Key only has delegate permissions (cannot execute), no ETH balance |
| Partial execution (R1 signed but R2 not) | Phase 2 checks both txs are executed before proceeding; if only one executed, script tells you which is missing |
| MetaBoard address wrong | Pre-flight could verify the MetaBoard contract exists at the configured address |
