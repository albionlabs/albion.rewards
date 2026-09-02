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
- **Claims strategy + settings** are pinned to a specific commit on `rainlanguage/rain.strategies` (`CLAIMS_STRATEGY_URL` + `SETTINGS_YAML_URL` in `constants.ts`) — do not move them without knowing why. As of the v6 migration the pin is `3c8b935b…` (the last YAML `version: 5` commit; `main` is YAML v6, which SDK `alpha.229` rejects). The settings resolve the Base orderbook to `0xe522…7C9D` (a stand-in; eventual target `0xb05D…e3cE`). April 2026 is the first v6 month. **Orderbook override:** `ORDERBOOK_ADDRESS` in `constants.ts` selects which orderbook the deploy targets; `order.ts:fetchSettings()` rewrites `orderbooks.base.address` in the fetched settings.yaml in-memory (the upstream pinned file is never touched). It defaults to the stand-in. To deploy against the real `0xb05D…e3cE`, set `ORDERBOOK_ADDRESS = ORDERBOOK_V6_ADDRESS` and **validate on the phase-1 Anvil fork first** — the override changes only the address, so it relies on the new orderbook sharing the same Base deployer/interpreter/store as the stand-in. The stale `subgraph`/`deployment-block` fields in those settings are unused by this repo's deploy/simulate/finalize path.

## Monthly playbook

Run from repo root, on a clean working tree.

### 1. Prepare per-token metadata.json

Before phase 1, each token's `output/<dateRange>/<tokenAddress>/metadata.json` must exist with a **pending** `payoutData` entry (empty `date`, `txHash`, `orderHash`). This is your responsibility to author.

Easiest pattern: copy the previous month's `metadata.json` for that token, then update:
- **`payoutData`**: append a new entry for the current month with `date: ""`, `txHash: ""`, `orderHash: ""`, and the agreed `totalPayout` / `payoutPerToken` (these are decided by the team — ask if not provided). Phase 2 fills in date/txHash/orderHash.
  - **`totalPayout` formula**: `totalPayout = (post_fees_USDC × sharePercentage / 100) + fixed_addon`.
    - **Variable component**: `post_fees_USDC × sharePercentage / 100`. `sharePercentage` is an **absolute** percentage of the post-fees royalty pool, not a ratio between R1 and R2. R1 = 2.5 → 2.5% of the pool. R2 = 7.5 → 7.5%. The remaining 90% is retained off-chain. Example: pool = $41,332 → R1 variable = $1,033.30, R2 variable = $3,099.90 (NOT $10,333 / $30,999 — that would be a 10× over-payment). Never infer the split from prior months' R1/R2 ratio; always derive from `sharePercentage`.
    - **Fixed addon (`+ 1/12 pending distributions`)**: each token has a pending-pool payout split into 12 monthly installments. Add the per-token addon to the variable component **only while the token is still inside its 12-month window**.
      - **R1 — DONE. The addon has ended.** Window was **Aug 2025 (#1) → Jul 2026 (#12)** at **$163.60**/month. Installment **#12 was paid in the July 2026 run**, so from **Aug 2026 onward R1 is variable-only: `totalPayout = pool × 2.5%`, no addon**. Its note should also drop the `+ 1/12 pending distributions` suffix. The R1 Safe's pending reserve is now spent — any residual balance there is leftover, not reserve, so the reserve cross-check below no longer applies to R1.
      - **R2**: addon = **$935.704** per month. Window: Nov 2025 (#1) → Oct 2026 (#12). Jun 2026 = #8.
      - After installment #12 for a token, **stop adding the addon** for that token; the variable component stands alone.
      - **Counting installments — R1 has an off-by-one trap.** The Aug-2025 R1 entry `This is just the pending distribution portion of August - special circumstances` (totalPayout exactly **163.60**) **IS installment #1**, even though its note doesn't end `+ 1/12 pending distributions`. So for R1: `installment = 1 + (count of prior entries whose note contains "+ 1/12 pending distributions") + 1`. (The sibling Aug-2025 entry `This is the monthly payment portion of August` is the *variable* half of August and is **not** an installment.) For R2 the plain note-count rule works, since it has no special-circumstances entry.
      - **Cross-check against the Safe balance**, which is the pre-funded pending reserve: expected reserve *before* this month's deposit = `addon × (13 − installment_number)`. Verified Jun 2026: R2 held 4,678.525283 vs 5 × 935.704 = 4,678.52 ✓; R1 held 324.336152 vs 2 × 163.60 = 327.20 (−2.86 drift, see below). If this check is off by a whole installment, the installment number is wrong.
      - **Known R1 drift (resolved):** the R1 reserve ran ~**$2.86** light. Covered in the July 2026 run by transferring 600.57 instead of the bare 579.70 variable; no longer an open item.
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
- **Merkle leaves are Rain Float–encoded for the v6 claims contract.** The amount word is `Float.fromFixedDecimal(amount, 18).asHex()` (Rain Float `bytes32`); the index and address words and the commutative `SimpleMerkleTree` pairing are unchanged. Both `src/merkle.ts` and `src/lib/validation.ts` build leaves via the shared `src/lib/leaf.ts` — keep them on that one encoder; never route the Float through `BigInt()` (it would reframe the packed value and break on-chain verification). (The old `keccak256(abi.encodePacked(index, address, uint256 amount))` packing applied only to the retired v4 contract.)
- **`@rainlanguage/orderbook` is pinned to `0.0.1-alpha.229`** (the v6-capable SDK, matching `albion.dex`). Don't bump it without testing — the SDK is pre-release and breaking changes happen (e.g. `setDeposit` became async; `newWithDeployment` takes a settings `string[]`; this version rejects YAML `version: 6`).
- **v6 deploy event is `AddOrderV3`** (was `AddOrderV2`) — `safe.ts` and `simulation.ts` decode it; the `OrderV4` IO tuple is `(address token, bytes32 vaultId)` (no `decimals`).
- **Claim side must match.** `Albion-issuance-site` reconstructs leaves to build proofs; it must use the identical Float leaf encoding (port `leaf.ts`) or v6 claims won't verify.
- **Never edit `metadata.json` by hand between phase 1 and phase 2.** Phase 2 finds the pending entry by empty fields; manual edits will either corrupt the entry or hide the pending one.
- **Always run phase 1 with a clean git tree** — `assertCleanGitState()` enforces it because phase 2 commits to that tree.
- **Stale state file**: if you re-run phase 1 for the same month, the proposals in `distribute-state.json` are overwritten but old Safe transactions still exist in the Safe Transaction Service. Reject the old ones in the Safe UI to avoid double-execution.

## Required env (see `.env.example` and `readme.md`)

`PROPOSER_PRIVATE_KEY`, `BASE_RPC_URL`, `PINATA_JWT`, `SAFE_API_KEY`, `GITHUB_TOKEN`, optional `ISSUANCE_SITE_PATH`. Foundry's `anvil` must be on PATH for the phase 1 simulation. Generate the proposer key with `npm run generate-key`.

## Known cosmetic oddities

- `package.json` is named `cyclo-rewards` (legacy fork). Harmless.
- `data/transfers.dat` is committed and gets overwritten by `npm run scrape`.
- `schema.json` at repo root is unrelated to this project (leftover from another template). Ignore.
