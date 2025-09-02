export interface CyToken {
  name: string;
  address: string;
  underlyingAddress: string;
  underlyingSymbol: string;
  receiptAddress: string;
}

export interface Transfer {
  from: string;
  to: string;
  value: string;
  blockNumber: number;
  timestamp: number;
  tokenAddress: string;
}

export interface TransferDetail {
  value: string;
  fromIsApprovedSource: boolean;
}

export interface AccountBalance {
  transfersInFromApproved: bigint;
  transfersOut: bigint;
  netBalanceAtSnapshot1: bigint;
  netBalanceAtSnapshot2: bigint;
  currentNetBalance: bigint;
}

export interface Report {
  reporter: string;
  cheater: string;
}

export interface AccountSummary {
  address: string;
  balanceAtSnapshot1: string;
  balanceAtSnapshot2: string;
  averageBalance: string;
  penalty: string;
  bounty: string;
  finalBalance: string;
  reports: {
    asReporter: {
      cheater: string;
      penalizedAmount: string;
      bountyAwarded: string;
    }[];
    asCheater: {
      reporter: string;
      penalizedAmount: string;
      bountyAwarded: string;
    }[];
  };
  transfers: AccountTransfers;
}

export interface TokenBalances {
  snapshot1: bigint;
  snapshot2: bigint;
  average: bigint;
  penalty: bigint;
  bounty: bigint;
  final: bigint;
}

export type EligibleBalances = Map<string, Map<string, TokenBalances>>; // token address -> user address -> balances

export type RewardsPerToken = Map<string, Map<string, bigint>>; // token address -> user address -> reward

export interface TransferRecord {
  from: string;
  to: string;
  value: string;
  blockNumber: number;
  timestamp: number;
  fromIsApprovedSource?: boolean;
}

export interface AccountTransfers {
  transfersIn: TransferDetail[];
  transfersOut: { value: string }[];
}

// Types for multi-snapshot processing
export interface MultiSnapshotTokenBalances {
  snapshots: bigint[]; // Array of balances at each snapshot (up to 62)
  current: bigint;
}

export interface TokenProportions {
  [address: string]: {
    balance: bigint;
    proportion: number;
    claimAmount?: string; // USDC claim amount
    reward?: bigint; // Reward amount in BigInt (18 decimals)
  };
}

export interface SnapshotInfo {
  blockNumber: number;
  timestamp: number;
  day: number; // Day of month (1-31)
}
