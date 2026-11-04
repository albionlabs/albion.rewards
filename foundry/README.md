# v6 claims fork tests

Foundry tests that fork Base and exercise a real Raindex v6 claims order
(`0xb05D73E6…` + claims.rain / merkle-words `0x22d83c…`).

They document current on-chain behaviour of the calculate-io / handle-io split:

- `testDoubleClaimInOneBatch` — the same leaf + proof listed twice in one
  `takeOrders4` batch is paid twice (200 USDC for a 100 USDC entitlement).
- `testSecondTxReverts` — a second *transaction* with the same proof reverts
  (`Claimed`). The flag works across txs; it only fails inside one batch.

These encode the **current vulnerable behaviour**. After a fix, the double-claim
test should flip (pay 100, or revert the second fill).

## Setup

```bash
# from repo root; forge-std is a submodule
cd foundry
forge install
```

Needs `BASE_RPC_URL` (same env as the rest of this repo) or `BASE_RPC`.

## Run

```bash
# from repo root
npm run test:fork

# or
cd foundry && BASE_RPC_URL=https://mainnet.base.org forge test -vv
```

Fixtures in `testdata/` are a 256-leaf SimpleMerkleTree whose root is spliced
into the bytecode of live claims order `0x41e3ca1f…`. Regenerate with:

```bash
# from repo root (needs the same npm deps used for merkle leaves)
node foundry/script/gen-fixtures.cjs
```
