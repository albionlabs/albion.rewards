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
export const CLAIMS_STRATEGY_URL =
  "https://raw.githubusercontent.com/rainlanguage/rain.strategies/7c8d5f1e95f8e6c1c6c13de366b0cf0493b50758/src/claims.rain";

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
