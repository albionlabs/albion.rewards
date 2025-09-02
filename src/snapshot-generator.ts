import { writeFile, mkdir } from "fs/promises";
import { config } from "dotenv";
import { SnapshotInfo } from "./types";
import { ethers } from "ethers";
import axios from "axios";

config();

const HYPERSYNC_URL = "https://8453.hypersync.xyz/query";
const BASE_RPC="https://mainnet.base.org";
const BASE_BLOCK_TIME = 2;

async function getBlockNumberForTimestampByHyperSync(
	targetTimestamp: number
): Promise<number> {

	try {
		// Get the latest block number
		const provider = new ethers.JsonRpcProvider(BASE_RPC);
		const latestBlock = await provider.getBlock('latest');
		const latestBlockNumber = latestBlock?.number;

		let left = 0;
		let right = latestBlockNumber || 0;

		let closestBlock = null;    
		let smallestDiff = Infinity;

		// Binary search loop
		while (left <= right) {
			const mid = Math.floor((left + right) / 2);

			// Create Hypersync query for the mid block
			const query = {
				from_block: mid,
				to_block: mid + 1, // Exclusive upper bound
				logs: [{}], // Empty log selection for block data
				field_selection: {
					block: ['number', 'timestamp']
				}
			};

			try {
				// Fetch block data from Hypersync
				const response = await axios.post(HYPERSYNC_URL, query);
				//eslint-disable-next-line @typescript-eslint/no-explicit-any
				const blocks = response.data.data.flatMap((item: any) => item.blocks);

				if (blocks.length === 0) {
					right = mid - 1;
					continue;
				}

				const block = blocks[0];
				const blockTimestamp = parseInt(block.timestamp, 16); // Convert hex to integer

				// Calculate the difference from the target timestamp
				const diff = Math.abs(blockTimestamp - targetTimestamp);

				// Update closest block if this is a better match
				if (diff < smallestDiff) {
					smallestDiff = diff;
					closestBlock = block.number;
				}

				// Adjust binary search range
				if (blockTimestamp < targetTimestamp) {
					left = mid + 1;
				} else {
					right = mid - 1;
				}
			} catch {
				// Skip this block range and move backward
				right = mid - 1;
			}
		}

		if (closestBlock !== null) {
			return closestBlock;
		} else {
			return 0;
		}
	} catch {
		return 0;
	}
}

async function generateRandomBlocks(startBlock: number, endBlock: number, year: number, month: number, tokenAddress: string) {
    const blocksPerDay = 86400 / BASE_BLOCK_TIME;
    const totalBlocks = endBlock - startBlock + 1;
    const totalDays = Math.ceil(totalBlocks / blocksPerDay);
    
    const snapshots: any[] = [];
    
    for (let day = 0; day < totalDays; day++) {
        const dayStartBlock = startBlock + (day * blocksPerDay);
        const dayEndBlock = Math.min(dayStartBlock + blocksPerDay - 1, endBlock);
        
        const randomBlock1 = Math.floor(Math.random() * (dayEndBlock - dayStartBlock + 1)) + dayStartBlock;
        let randomBlock2 = Math.floor(Math.random() * (dayEndBlock - dayStartBlock + 1)) + dayStartBlock;
        
        while (randomBlock2 === randomBlock1 && (dayEndBlock - dayStartBlock) > 0) {
            randomBlock2 = Math.floor(Math.random() * (dayEndBlock - dayStartBlock + 1)) + dayStartBlock;
        }
        
        snapshots.push(
            {
                blockNumber: randomBlock1,
                timestamp: 0, // Will be filled when we fetch actual block data
                day: day + 1
            },
            {
                blockNumber: randomBlock2,
                timestamp: 0, // Will be filled when we fetch actual block data
                day: day + 1
            }
        );
        
    }
    
    // Create the snapshot file structure
    const snapshotData = {
        generatedAt: new Date().toISOString(),
        totalSnapshots: snapshots.length,
        network: "Base",
        dataSource: "Hypersync",
        snapshots: snapshots
    };
    
    // Create output directory and write to file
    const outputDir = `output/${year}-${String(month).padStart(2, '0')}/${tokenAddress}`;
    await mkdir(outputDir, { recursive: true });
    
    const filename = `${outputDir}/snapshot.json`;
    await writeFile(filename, JSON.stringify(snapshotData, null, 2));
    
    console.log(`Generated ${snapshots.length} random blocks total`);
    console.log(`Snapshot file saved as: ${filename}`);
    
    return snapshotData;
}

async function getBlocksForMonth(year: number, month: number, tokenAddress: string) {
    const startTimestamp = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) / 1000;
    const endTimestamp = Date.UTC(year, month, 0, 23, 59, 59, 0) / 1000;
    const startBlock = await getBlockNumberForTimestampByHyperSync(startTimestamp);
    const endBlock = await getBlockNumberForTimestampByHyperSync(endTimestamp);
    await generateRandomBlocks(startBlock, endBlock, year, month, tokenAddress);

}

async function main() {
    // Get command line arguments
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.error("Usage: npm run generate-snapshots <year> <month> <tokenAddress>");
        console.error("Example: npm run generate-snapshots 2025 8 0xd5316ca888491575befc0273a00de2186c53f760");
        process.exit(1);
    }
    
    const year = parseInt(args[0]);
    const month = parseInt(args[1]);
    const tokenAddress = args[2];
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        console.error("Invalid year or month. Year must be a number, month must be 1-12");
        process.exit(1);
    }
    
    if (!tokenAddress || !tokenAddress.startsWith('0x')) {
        console.error("Invalid token address. Must be a valid Ethereum address starting with 0x");
        process.exit(1);
    }
    
    console.log(`Generating snapshots for ${year}-${String(month).padStart(2, '0')} for token ${tokenAddress}...`);
    await getBlocksForMonth(year, month, tokenAddress);
}

main();