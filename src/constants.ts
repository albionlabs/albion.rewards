export const ENERGY_FEILDS = [
  "0xf836a500910453a397084ade41321ee20a5aade1",
  "0x1d57246fd0ba134d7cc78ddf3ed829379d95f4b7",
];

// Token addresses (lowercase for consistent comparison)
export const R1_TOKEN = "0xf836a500910453a397084ade41321ee20a5aade1";
export const R2_TOKEN = "0x1d57246fd0ba134d7cc78ddf3ed829379d95f4b7";

// Safe addresses
export const R1_SAFE = "0xa51fd23d6e2442805130eac0712f590691e91517";
export const R2_SAFE = "0x1c56fc57bbc18879d8059562a371722b682ca984";
export const METADATA_SAFE = "0x4e5bd3cf829010280f76754b49921d4e1448b8cf";

// Token config: maps token address to its Safe
export const TOKENS = [
  { address: R1_TOKEN, safe: R1_SAFE, symbol: "ALB-WR1-R1" },
  { address: R2_TOKEN, safe: R2_SAFE, symbol: "ALB-WR1-R2" },
] as const;

// Base chain
export const BASE_CHAIN_ID = 8453n;
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const USDC_DECIMALS = 6;
// CSV amounts use 18 decimals (SFT token decimals), not USDC 6 decimals
export const CSV_AMOUNT_DECIMALS = 18;

// Rain / MetaBoard
export const METABOARD_ADDRESS = "0x59401c9302e79eb8ac6aea659b8b3ae475715e86";

// Orderbook (Raindex v6) addresses on Base. The pinned settings.yaml below
// resolves the base orderbook to the stand-in; order.ts:fetchSettings() rewrites
// that address in-memory to ORDERBOOK_ADDRESS before handing the YAML to the SDK.
// The upstream pinned file is never mutated, and only the orderbook *address* is
// changed — the stale subgraph / deployment-block fields are unused by this
// repo's deploy/simulate/finalize path. Casing must match the settings.yaml
// (checksummed) for the in-memory rewrite to find it.
export const ORDERBOOK_STANDIN_ADDRESS = "0xe522cB4a5fCb2eb31a52Ff41a4653d85A4fd7C9D";
export const ORDERBOOK_V6_ADDRESS = "0xb05D73E6BCc26AEB5b67Ff68C6E9C6151073e3cE";
// Which orderbook the claims deployment targets. Now points at the real v6
// orderbook (0xb05D…e3cE); set back to ORDERBOOK_STANDIN_ADDRESS to fall back to
// the stand-in. Always validate via the phase-1 Anvil fork simulation before a
// live Safe proposal — that confirms the orderbook shares the same Base
// deployer/interpreter/store the SDK expects.
export const ORDERBOOK_ADDRESS: string = ORDERBOOK_V6_ADDRESS;

// Pinned to rain.strategies @ 3c8b935ba2b00ef4623eb1e74507c490c33d4dcc
// (last commit with YAML version: 5, compatible with alpha.229 SDK).
export const CLAIMS_STRATEGY_URL =
  "https://raw.githubusercontent.com/rainlanguage/rain.strategies/3c8b935ba2b00ef4623eb1e74507c490c33d4dcc/src/claims.rain";
export const SETTINGS_YAML_URL =
  "https://raw.githubusercontent.com/rainlanguage/rain.strategies/3c8b935ba2b00ef4623eb1e74507c490c33d4dcc/settings.yaml";

// Metadata subgraph
export const METADATA_SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_clv14x04y9kzi01saerx7bxpg/subgraphs/metadata-base/2025-07-06-594f/gn";

// CBOR magic numbers (from operator.portal consts.ts)
export const MAGIC_NUMBERS = {
  RAIN_META_DOCUMENT: BigInt("0xff0a89c674ee7874"),
  OA_SCHEMA: BigInt("0xffa8e8a9b9cf4a31"),
  OA_HASH_LIST: BigInt("0xff9fae3cc645f463"),
  OA_STRUCTURE: BigInt("0xffc47a6299e8a911"),
} as const;

// MetaBoard ABI fragment
export const METABOARD_ABI = [
  {
    type: "function",
    name: "emitMeta",
    inputs: [
      { name: "subject", type: "bytes32", internalType: "bytes32" },
      { name: "meta", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
