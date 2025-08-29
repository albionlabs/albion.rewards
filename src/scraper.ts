import { request, gql } from "graphql-request";
import { writeFile } from "fs/promises";
import { Transfer } from "./types";
import { config } from "dotenv";
import assert from "assert";
import { ENERGY_FEILDS } from "./constants";

config();

const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cm153vmqi5gke01vy66p4ftzf/subgraphs/sft-offchainassetvaulttest-base/1.0.4/gn";
const BATCH_SIZE = 1000;

// ensure SNAPSHOT_BLOCK_2 env is set for deterministic transfers.dat,
// as we will fetch transfers up until the end of the snapshot block numbers
assert(process.env.SNAPSHOT_BLOCK_2, "undefined SNAPSHOT_BLOCK_2 env variable")
const UNTIL_SNAPSHOT = parseInt(process.env.SNAPSHOT_BLOCK_2) + 1; // +1 to make sure every transfer is gathered

interface SubgraphTransfer {
  id: string;
  timestamp: string;
  transaction: {
    id: string;
    blockNumber: string;
    timestamp: string;
  };
  from: {
    address: string;
  };
  to: {
    address: string;
  };
  value: string;
  valueExact: string;
  offchainAssetReceiptVault: {
    id: string;
  };
}

interface SubgraphDeposit {
  id: string;
  emitter: {
    address: string;
  };
  amount: string;
  transaction: {
    id: string;
    timestamp: string;
    blockNumber: string;
  };
  offchainAssetReceiptVault: {
    id: string;
  };
}

async function fetchTransfers(skip: number): Promise<SubgraphTransfer[]> {
  const query = gql`
    query getTransfers(
      $skip: Int!
      $first: Int!
      $untilSnapshot: BigInt!
      $vaultAddresses: [String!]!
    ) {
      sharesTransfers(
        skip: $skip
        first: $first
        orderBy: transaction__blockNumber
        orderDirection: asc
        where: {
          offchainAssetReceiptVault_in: $vaultAddresses,
          transaction_: {blockNumber_lte: $untilSnapshot}
        }
      ) {
        id
        timestamp
        transaction {
          id
          blockNumber
          timestamp
        }
        from {
          address
        }
        to {
          address
        }
        value
        valueExact
        offchainAssetReceiptVault {
          id
        }
      }
    }
  `;

  // The Graph expects BigInt variables as strings
  const untilSnapshotStr = BigInt(UNTIL_SNAPSHOT).toString();

  const response = await request<{ sharesTransfers: any[] }>(
    SUBGRAPH_URL,
    query,
    {
      skip,
      first: BATCH_SIZE,
      untilSnapshot: untilSnapshotStr,
      vaultAddresses: ENERGY_FEILDS, // array of vault IDs (addresses as strings)
    }
  );

  return response.sharesTransfers;
}


async function fetchDeposits(skip: number): Promise<SubgraphDeposit[]> {
  const query = gql`
    query getDeposits($skip: Int!, $first: Int!, $untilSnapshot: Int!, $vaultAddresses: [String!]!) {
      depositWithReceipts(
        skip: $skip
        first: $first
        orderBy: transaction__blockNumber
        orderDirection: asc
        where: {
          offchainAssetReceiptVault_in: $vaultAddresses,
          transaction_: {blockNumber_lte: $untilSnapshot}
        }
      ) {
        id
        emitter {
          address
        }
        amount
        offchainAssetReceiptVault {
          id
        }
        transaction {
          id
          timestamp
          blockNumber
        }
      }
    }
  `;

  const response = await request<{ depositWithReceipts: SubgraphDeposit[] }>(
    SUBGRAPH_URL,
    query,
    {
      skip,
      first: BATCH_SIZE,
      untilSnapshot: UNTIL_SNAPSHOT,
      vaultAddresses: ENERGY_FEILDS,
    }
  );

  return response.depositWithReceipts;
}

async function main() {
  let transfersSkip = 0;
  let depositsSkip = 0;
  let transfersHasMore = true;
  let depositsHasMore = true;
  let totalProcessed = 0;
  const allTransfers: Transfer[] = [];

  // Fetch transfers and deposits in parallel batches
  while (transfersHasMore || depositsHasMore) {
    console.log(`Fetching transfers batch starting at ${transfersSkip}`);
    console.log(`Fetching deposits batch starting at ${depositsSkip}`);

    const transfersBatch: SubgraphTransfer[] = transfersHasMore ? await fetchTransfers(transfersSkip) : [];
    const depositsBatch: SubgraphDeposit[] = depositsHasMore ? await fetchDeposits(depositsSkip) : [];

    // Process transfers
    const processedTransfers = transfersBatch.map((t: SubgraphTransfer) => ({
      tokenAddress: t.offchainAssetReceiptVault.id,
      from: t.from.address,
      to: t.to.address,
      value: t.valueExact,
      blockNumber: parseInt(t.transaction.blockNumber),
      timestamp: parseInt(t.transaction.timestamp),
    }));

    // Process deposits as mints (from address = 0x0000000000000000000000000000000000000000)
    const processedDeposits = depositsBatch.map((d: SubgraphDeposit) => ({
      tokenAddress: d.offchainAssetReceiptVault.id, // Use the actual vault address from the response
      from: "0x0000000000000000000000000000000000000000", // Mint from zero address
      to: d.emitter.address,
      value: d.amount,
      blockNumber: parseInt(d.transaction.blockNumber),
      timestamp: parseInt(d.transaction.timestamp),
    }));

    // Combine and sort by block number and timestamp
    const combinedBatch = [...processedTransfers, ...processedDeposits].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      return a.timestamp - b.timestamp;
    });

    allTransfers.push(...combinedBatch);

    console.log(`Found ${transfersBatch.length} transfers and ${depositsBatch.length} deposits in batch`);
    totalProcessed += combinedBatch.length;

    // Update pagination state
    transfersHasMore = transfersBatch.length === BATCH_SIZE;
    depositsHasMore = depositsBatch.length === BATCH_SIZE;
    
    if (transfersHasMore) transfersSkip += transfersBatch.length;
    if (depositsHasMore) depositsSkip += depositsBatch.length;

    // Save progress after each batch
    await writeFile(
      "data/transfers.dat",
      allTransfers.map((t) => JSON.stringify(t)).join("\n")
    );

    // Log progress
    console.log(`Total transfers and deposits processed: ${totalProcessed}`);
  }

  console.log(`\nFinished!`);
  console.log(`Total transfers and deposits fetched: ${totalProcessed}`);
}

main().catch(console.error);
