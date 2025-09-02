import { Transfer, MultiSnapshotTokenBalances, TokenProportions, SnapshotInfo } from "./types";

interface AccountBalances {
  [tokenAddress: string]: MultiSnapshotTokenBalances;
}

export class Processor {
  private accountBalances = new Map<string, AccountBalances>();
  private snapshots: SnapshotInfo[];

  constructor(snapshots: SnapshotInfo[]) {
    this.snapshots = snapshots;
  }

  /**
   * Process all transfers and calculate balances at snapshot blocks
   */
  processTransfers(transfers: Transfer[]): void {
    console.log("Processing transfers and calculating balances...");
    console.log(`Using ${this.snapshots.length} snapshots`);
    
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
          snapshots: new Array(this.snapshots.length).fill(0n),
          current: 0n
        };
      }
      if (!this.accountBalances.get(to)![tokenAddress]) {
        this.accountBalances.get(to)![tokenAddress] = {
          snapshots: new Array(this.snapshots.length).fill(0n),
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
      
      // Update snapshot balances for all snapshots
      for (let i = 0; i < this.snapshots.length; i++) {
        if (blockNumber <= this.snapshots[i].blockNumber) {
          if (from !== "0x0000000000000000000000000000000000000000") {
            fromBalances.snapshots[i] -= valueBigInt;
            toBalances.snapshots[i] += valueBigInt;
          } else {
            toBalances.snapshots[i] += valueBigInt;
          }
        }
      }
    }
  }

  /**
   * Calculate proportions for each token based on snapshot balances
   */
  calculateProportions(distributionAmount?: number): Map<string, TokenProportions> {
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
      let totalBalanceSum = 0n;
      
      // Calculate total average balances for this token across all snapshots
      for (const [address, accountBal] of this.accountBalances) {
        const tokenBalances = accountBal[tokenAddress];
        if (tokenBalances) {
          // Calculate average balance across all snapshots for this account
          const accountBalanceSum = tokenBalances.snapshots.reduce((sum, balance) => sum + (balance > 0n ? balance : 0n), 0n);
          const accountAverageBalance = accountBalanceSum / BigInt(this.snapshots.length);
          totalBalanceSum += accountAverageBalance;
        }
      }
      
      // Calculate proportions for each account
      for (const [address, accountBal] of this.accountBalances) {
        const tokenBalances = accountBal[tokenAddress];
        if (tokenBalances) {
          // Calculate average balance across all snapshots for this account
          const accountBalanceSum = tokenBalances.snapshots.reduce((sum, balance) => sum + (balance > 0n ? balance : 0n), 0n);
          const accountAverageBalance = accountBalanceSum / BigInt(this.snapshots.length);
          
          if (accountAverageBalance > 0n) {
            const proportion = totalBalanceSum > 0n 
              ? Number(accountAverageBalance) / Number(totalBalanceSum)
              : 0;
            
            // Calculate reward if distribution amount is provided
            let reward: bigint | undefined;
            if (distributionAmount && distributionAmount > 0) {
              // Convert distribution amount to BigInt with 18 decimals
              const distributionAmountBigInt = BigInt(Math.floor(distributionAmount * 1e18));
              // Calculate reward: proportion * distributionAmount (in 18 decimals)
              reward = BigInt(Math.floor(proportion * Number(distributionAmountBigInt)));
            }
            
            proportions[address] = {
              balance: accountAverageBalance,
              proportion: proportion,
              reward: reward
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
      console.log("Address | Balance | Proportion | Reward");
      console.log("--------|---------|------------|-------");
      
      // Sort by balance (descending)
      const sortedEntries = Object.entries(proportions)
        .sort(([,a], [,b]) => Number(b.balance - a.balance));
      
      for (const [address, data] of sortedEntries) {
        const rewardStr = data.reward ? ` | ${data.reward.toString()}` : '';
        console.log(`${address} | ${data.balance.toString()} | ${(data.proportion * 100).toFixed(4)}%${rewardStr}`);
      }
    }
  }

  /**
   * Generate CSV output for rewards
   */
  generateRewardsCSV(tokenProportions: Map<string, TokenProportions>): string {
    const csvLines: string[] = [];
    csvLines.push("index,address,reward"); // CSV header
    
    let index = 0;
    for (const [tokenAddress, proportions] of tokenProportions) {
      for (const [address, data] of Object.entries(proportions)) {
        if (data.reward && data.reward > 0n) {
          csvLines.push(`${index},${address},${data.reward.toString()}`);
          index++;
        }
      }
    }
    
    return csvLines.join('\n');
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
          proportion: data.proportion,
          reward: data.reward ? data.reward.toString() : undefined // Convert BigInt to string
        };
      }
    }
    
    return {
      snapshots: this.snapshots,
      tokenProportions: serializableProportions
    };
  }
}
