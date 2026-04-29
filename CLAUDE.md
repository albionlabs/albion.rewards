# CLAUDE.md

Context for Claude when administering monthly Albion rewards in this repo. Audience: future Claude instances doing the admin work.

## What this repo does

Two halves, both serving one monthly job: distribute USDC rewards to Albion SFT holders on Base.

1. **Rewards calculation** — `calculate_claims.sh` + `src/{scraper,snapshot-generator,processor,merkle,index}.ts`. Pulls Base transfer history, samples 2 random blocks/day across the month, computes each holder's average proportional balance, and emits a 256-row CSV plus a merkle tree per token.
2. **On-chain distribution** — `src/distribute-phase{1,2,3}.ts` + `src/lib/*`. Deploys a Raindex claim order per SFT via Safe multisigs, pins Rain-encoded metadata to the SFTs via the MetaBoard, uploads CSVs to Pinata, and PRs the issuance site.

Output for each month lives under `output/YYYY-MM-DD_to_YYYY-MM-DD/<tokenAddress>/`.

## Fixed entities (see `src/constants.ts`)

- **Tokens** (Base): R1 = `0xf836…ade1` (ALB-WR1-R1), R2 = `0x1d57…f4b7` (ALB-WR1-R2). There is no R3 in this repo.
- **Safes**: R1 Safe, R2 Safe, Metadata Safe — each holds USDC and signs its own transactions.
- **Output token** = USDC (Base, 6 decimals). **Input token** = WETH. CSV amounts are 18 decimals (SFT decimals), not USDC decimals — `validation.ts` handles this.
- **Claims strategy** is pinned to a specific commit on `rainlanguage/rain.strategies` — do not move it without knowing why.

## Monthly playbook

Run from repo root, on a clean working tree.

### 1. Prepare per-token metadata.json

Before phase 1, each token's `output/<dateRange>/<tokenAddress>/metadata.json` must exist with a **pending** `payoutData` entry (empty `date`, `txHash`, `orderHash`). This is your responsibility to author.

Easiest pattern: copy the previous month's `metadata.json` for that token, then update:
- **`payoutData`**: append a new entry for the current month with `date: ""`, `txHash: ""`, `orderHash: ""`, and the agreed `totalPayout` / `payoutPerToken` (these are decided by the team — ask if not provided). Phase 2 fills in date/txHash/orderHash.
  - **`totalPayout` formula**: `totalPayout = (post_fees_USDC × sharePercentage / 100) + fixed_addon`.
    - **Variable component**: `post_fees_USDC × sharePercentage / 100`. `sharePercentage` is an **absolute** percentage of the post-fees royalty pool, not a ratio between R1 and R2. R1 = 2.5 → 2.5% of the pool. R2 = 7.5 → 7.5%. The remaining 90% is retained off-chain. Example: pool = $41,332 → R1 variable = $1,033.30, R2 variable = $3,099.90 (NOT $10,333 / $30,999 — that would be a 10× over-payment). Never infer the split from prior months' R1/R2 ratio; always derive from `sharePercentage`.
    - **Fixed addon (`+ 1/12 pending distributions`)**: each token has a pending-pool payout split into 12 monthly installments. Add the per-token addon to the variable component **only while the token is still inside its 12-month window**.
      - **R1**: addon = **$163.60** per month. Window: Sep 2025 (#1) → Aug 2026 (#12). Verify by counting prior `payoutData` entries whose note contains "+ 1/12 pending distributions"; that count + 1 = the current installment number.
      - **R2**: addon = **$935.704** per month. Window: Nov 2025 (#1) → Oct 2026 (#12).
      - After installment #12 for a token, **stop adding the addon** for that token; the variable component stands alone.
      - The Aug-2025 R1 entries (`This is just the pending distribution portion of August - special circumstances` and `This is the monthly payment portion of August - special circumstances`) are pre-plan one-offs and are **not** counted as installment #1. Installment #1 is the first entry whose note ends `+ 1/12 pending distributions`.
    - Use `revenue` in the new `receiptsData` entry as the same post-fees pool figure (so `share% × receiptsData.revenue + addon = totalPayout` holds). Past months follow this convention.
- **`receiptsData`**: append last month's actuals (`production`, `revenue`, `expenses`, `netIncome`, `realisedPrice.{oilPrice,gasPrice}`).
- **`asset.historicalProduction`**: append last month's production figure.
- **`asset.operationalMetrics.hseMetrics.incidentFreeDays`** (and `uptime` if relevant): bump per the latest HSE report.

`example.json` shows the full shape. The schema lives implicitly in `findPendingPayoutEntry` / `patchPendingPayout` (`src/lib/{validation,metadata}.ts`) — phase 1 will reject the run if no pending entry is found.

If you don't have the HSE / receipts numbers, ask the user — do not invent them.

### 2. Run the rewards calculation

```bash
./calculate_claims.sh <startTs> <endTs> <tokenAddress> <distributionAmount>
```

Run once per token. Produces `rewards_<dateRange>.csv` (256 rows) and `tree_<dateRange>.json`. CSV total ≤ deposit amount is enforced by phase 1.

### 3. Phase 1 — propose orders (see `readme.md` for full flag list)

```bash
npm run distribute:phase1 -- --month YYYY-MM --r1-amount <USDC> --r2-amount <USDC>
```

Validates CSV/merkle/metadata/delegate/balance, builds Raindex calldata, **simulates on an Anvil fork** (foundry required), then proposes one Safe tx per token. Outputs Safe URLs to sign.

User signs both Safe txs in the Safe UI before continuing.

### 4. Phase 2 — finalize orders + propose metadata

```bash
npm run distribute:phase2 -- --month YYYY-MM
```

Polls Safe execution, extracts `orderHash` from the `AddOrderV2` event, **patches metadata.json's pending entry with date/txHash/orderHash, commits and pushes**, uploads CSVs and metadata to Pinata, then proposes the MetaBoard `emitMeta` transaction via the Metadata Safe.

User signs the metadata Safe tx.

### 5. Phase 3 — issuance-site PR

```bash
npm run distribute:phase3 -- --month YYYY-MM
```

Verifies metadata tx executed, then patches `Albion-issuance-site/src/lib/network.ts` (`PROD_ENERGY_FIELDS` claim arrays for both R1 and R2) and opens a PR via `gh`.

### State handoff

Phases communicate via `output/<dateRange>/distribute-state.json`. Phase 1 writes, phase 2 updates, phase 3 reads. If a phase fails partway, inspect this file before re-running — re-running phase 1 will overwrite proposals.

## Hard rules

- **Proposer is a Safe delegate, not an owner.** All three Safes are nested (a parent Safe owns them). Sign proposals via `eth_sign`: `signMessage(safeTxHash)` then bump `v += 4`. Never use `protocolKit.signTransaction()` (owner-only). Never suggest making the proposer an owner.
- **Plain keccak256 merkle packing in `src/merkle.ts` and `lib/validation.ts` is intentional** — this repo targets the older claims contract that uses raw `keccak256(abi.encodePacked(index, address, amount))`. Do not "fix" it to Float-encoded leaves; that's for newer contracts and would break verification here.
- **Do not bump `@rainlanguage/orderbook`** past the pinned `0.0.1-alpha.154` without testing — the SDK is pre-release and breaking changes have happened.
- **Never edit `metadata.json` by hand between phase 1 and phase 2.** Phase 2 finds the pending entry by empty fields; manual edits will either corrupt the entry or hide the pending one.
- **Always run phase 1 with a clean git tree** — `assertCleanGitState()` enforces it because phase 2 commits to that tree.
- **Stale state file**: if you re-run phase 1 for the same month, the proposals in `distribute-state.json` are overwritten but old Safe transactions still exist in the Safe Transaction Service. Reject the old ones in the Safe UI to avoid double-execution.

## Required env (see `.env.example` and `readme.md`)

`PROPOSER_PRIVATE_KEY`, `BASE_RPC_URL`, `PINATA_JWT`, `SAFE_API_KEY`, `GITHUB_TOKEN`, optional `ISSUANCE_SITE_PATH`. Foundry's `anvil` must be on PATH for the phase 1 simulation. Generate the proposer key with `npm run generate-key`.

## Known cosmetic oddities

- `package.json` is named `cyclo-rewards` (legacy fork). Harmless.
- `data/transfers.dat` is committed and gets overwritten by `npm run scrape`.
- `schema.json` at repo root is unrelated to this project (leftover from another template). Ignore.
