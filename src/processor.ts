import { Transfer } from "./types";

interface TokenBalances {
  snapshot1: bigint;
  snapshot2: bigint;
  current: bigint;
}

interface AccountBalances {
  [tokenAddress: string]: TokenBalances;
}

interface TokenProportions {
  [address: string]: {
    balance: bigint;
    proportion: number;
  };
}

export class Processor {
  private accountBalances = new Map<string, AccountBalances>();
  private snapshotBlock1: number;
  private snapshotBlock2: number;

  constructor(snapshotBlock1: number, snapshotBlock2: number) {
    this.snapshotBlock1 = snapshotBlock1;
    this.snapshotBlock2 = snapshotBlock2;
  }

  /**
   * Process all transfers and calculate balances at snapshot blocks
   */
  processTransfers(transfers: Transfer[]): void {
    console.log("Processing transfers and calculating balances...");
    
    // Initialize balances for all accounts and tokens
    for (const transfer of transfers) {
      const { from, to, tokenAddress, value, blockNumber } = transfer;
      const valueBigInt = BigInt(value);
      
      // Initialize account balances if they don't exist
      if (!this.accountBalances.has(from)) {
        this.accountBalances.set(from, {});
      }
      if (!this.accountBalances.has(to)) {
        this.accountBalances.set(to, {});
      }
      
      // Initialize token balances if they don't exist
      if (!this.accountBalances.get(from)![tokenAddress]) {
        this.accountBalances.get(from)![tokenAddress] = {
          snapshot1: 0n,
          snapshot2: 0n,
          current: 0n
        };
      }
      if (!this.accountBalances.get(to)![tokenAddress]) {
        this.accountBalances.get(to)![tokenAddress] = {
          snapshot1: 0n,
          snapshot2: 0n,
          current: 0n
        };
      }
      
      // Update balances
      const fromBalances = this.accountBalances.get(from)![tokenAddress];
      const toBalances = this.accountBalances.get(to)![tokenAddress];
      
      // Handle transfers (subtract from sender, add to receiver)
      if (from !== "0x0000000000000000000000000000000000000000") {
        // Regular transfer
        fromBalances.current -= valueBigInt;
        toBalances.current += valueBigInt;
      } else {
        // Mint (deposit) - only add to receiver
        toBalances.current += valueBigInt;
      }
      
      // Update snapshot balances
      if (blockNumber <= this.snapshotBlock1) {
        if (from !== "0x0000000000000000000000000000000000000000") {
          fromBalances.snapshot1 -= valueBigInt;
          toBalances.snapshot1 += valueBigInt;
        } else {
          toBalances.snapshot1 += valueBigInt;
        }
      }
      
      if (blockNumber <= this.snapshotBlock2) {
        if (from !== "0x0000000000000000000000000000000000000000") {
          fromBalances.snapshot2 -= valueBigInt;
          toBalances.snapshot2 += valueBigInt;
        } else {
          toBalances.snapshot2 += valueBigInt;
        }
      }
    }
  }

  /**
   * Calculate proportions for each token based on snapshot balances
   */
  calculateProportions(): Map<string, TokenProportions> {
    console.log("Calculating proportions...");
    const tokenProportions = new Map<string, TokenProportions>();
    
    // Get all unique token addresses
    const uniqueTokens = new Set<string>();
    for (const [_, accountBal] of this.accountBalances) {
      for (const tokenAddress in accountBal) {
        uniqueTokens.add(tokenAddress);
      }
    }
    
    for (const tokenAddress of uniqueTokens) {
      const proportions: TokenProportions = {};
      let totalBalanceSnapshot1 = 0n;
      let totalBalanceSnapshot2 = 0n;
      
      // Calculate total balances for this token at each snapshot
      for (const [address, accountBal] of this.accountBalances) {
        const tokenBalances = accountBal[tokenAddress];
        if (tokenBalances) {
          totalBalanceSnapshot1 += tokenBalances.snapshot1 > 0n ? tokenBalances.snapshot1 : 0n;
          totalBalanceSnapshot2 += tokenBalances.snapshot2 > 0n ? tokenBalances.snapshot2 : 0n;
        }
      }
      
      // Calculate proportions for each account
      for (const [address, accountBal] of this.accountBalances) {
        const tokenBalances = accountBal[tokenAddress];
        if (tokenBalances) {
          const balanceSnapshot1 = tokenBalances.snapshot1 > 0n ? tokenBalances.snapshot1 : 0n;
          const balanceSnapshot2 = tokenBalances.snapshot2 > 0n ? tokenBalances.snapshot2 : 0n;
          const averageBalance = (balanceSnapshot1 + balanceSnapshot2) / 2n;
          
          if (averageBalance > 0n) {
            const proportion = totalBalanceSnapshot1 > 0n && totalBalanceSnapshot2 > 0n 
              ? Number(averageBalance) / Number((totalBalanceSnapshot1 + totalBalanceSnapshot2) / 2n)
              : 0;
            
            proportions[address] = {
              balance: averageBalance,
              proportion: proportion
            };
          }
        }
      }
      
      tokenProportions.set(tokenAddress, proportions);
    }
    
    return tokenProportions;
  }

  /**
   * Get all account balances for debugging or analysis
   */
  getAccountBalances(): Map<string, AccountBalances> {
    return this.accountBalances;
  }

  /**
   * Get unique token addresses
   */
  getUniqueTokens(): Set<string> {
    const uniqueTokens = new Set<string>();
    for (const [_, accountBal] of this.accountBalances) {
      for (const tokenAddress in accountBal) {
        uniqueTokens.add(tokenAddress);
      }
    }
    return uniqueTokens;
  }

  /**
   * Print balance summary to console
   */
  printBalanceSummary(tokenProportions: Map<string, TokenProportions>): void {
    console.log("\n=== BALANCE SUMMARY ===");
    for (const [tokenAddress, proportions] of tokenProportions) {
      console.log(`\nToken: ${tokenAddress}`);
      console.log("Address | Balance | Proportion");
      console.log("--------|---------|------------");
      
      // Sort by balance (descending)
      const sortedEntries = Object.entries(proportions)
        .sort(([,a], [,b]) => Number(b.balance - a.balance));
      
      for (const [address, data] of sortedEntries) {
        console.log(`${address} | ${data.balance.toString()} | ${(data.proportion * 100).toFixed(4)}%`);
      }
    }
  }

  /**
   * Generate output data for saving to file
   * Converts BigInt values to strings for JSON serialization
   */
  generateOutputData(tokenProportions: Map<string, TokenProportions>) {
    // Convert BigInt values to strings for JSON serialization
    const serializableProportions: any = {};
    
    for (const [tokenAddress, proportions] of tokenProportions) {
      serializableProportions[tokenAddress] = {};
      
      for (const [address, data] of Object.entries(proportions)) {
        serializableProportions[tokenAddress][address] = {
          balance: data.balance.toString(), // Convert BigInt to string
          proportion: data.proportion
        };
      }
    }
    
    return {
      snapshotBlock1: this.snapshotBlock1,
      snapshotBlock2: this.snapshotBlock2,
      tokenProportions: serializableProportions
    };
  }
}
