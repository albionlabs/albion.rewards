import { readFile, writeFile, mkdir } from "fs/promises";
import { Processor } from "./processor";
import { config } from "dotenv";
import { SnapshotInfo } from "./types";

// Load environment variables
config();

async function main() {
    console.log("Starting multi-snapshot processor...");

    // Parse command line arguments
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log("Usage: tsx src/index.ts <snapshots-file> [token-address] [distribution-amount]");
        console.log("Example: tsx src/index.ts output/2025-08/snapshot.json 0xd5316ca888491575befc0273a00de2186c53f760 1000000");
        process.exit(1);
    }

    const snapshotsFile = args[0];
    const tokenAddress = args[1];
    const distributionAmount = args[2] ? parseFloat(args[2]) : undefined;

    console.log(`Snapshots file: ${snapshotsFile}`);
    
    // Extract timestamp range and token address from snapshots file path (e.g., output/2025-09-01_to_2025-09-30/0x.../snapshot.json -> 2025-09-01_to_2025-09-30/0x...)
    const pathParts = snapshotsFile.split('/');
    const tokenAddressFromPath = pathParts[pathParts.length - 2]; // Get the token address directory
    const timestampRange = pathParts[pathParts.length - 3]; // Get the timestamp range directory
    const outputDir = `output/${timestampRange}/${tokenAddressFromPath}`;
    
    console.log(`Output directory: ${outputDir}`);
    if (tokenAddress) {
        console.log(`Token address filter: ${tokenAddress}`);
    } else {
        console.log("Processing all tokens");
    }
    if (distributionAmount) {
        console.log(`Distribution amount: ${distributionAmount}`);
    } else {
        console.log("No distribution amount specified");
    }

    // Create output directory if it doesn't exist
    await mkdir(outputDir, { recursive: true });

    // Read snapshots file
    console.log("Reading snapshots file...");
    const snapshotsData = await readFile(snapshotsFile, "utf8");
    const snapshotsConfig = JSON.parse(snapshotsData);
    const snapshots: SnapshotInfo[] = snapshotsConfig.snapshots;

    console.log(`Found ${snapshots.length} snapshots`);

    // Read transfers file
    console.log("Reading transfers file...");
    const transfersData = await readFile("data/transfers.dat", "utf8");
    const transfers = transfersData
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((transfer) => transfer.tokenAddress.toLowerCase() === tokenAddress?.toLowerCase());
    console.log(`Found ${transfers.length} transfers`);

    // Create processor instance
    const processor = new Processor(snapshots);
    
    // Process transfers and calculate balances
    processor.processTransfers(transfers);
    
    // Calculate proportions
    const tokenProportions = processor.calculateProportions(distributionAmount);
    
    // Print results to console
    processor.printBalanceSummary(tokenProportions);
    
    // Save detailed results to file
    const outputData = processor.generateOutputData(tokenProportions);
    await writeFile(`${outputDir}/balances.json`, JSON.stringify(outputData, null, 2));
    console.log(`\nDetailed results saved to ${outputDir}/balances.json`);
    
    // Generate and save rewards CSV
    const rewardsCSV = processor.generateRewardsCSV(tokenProportions);
    await writeFile(`${outputDir}/rewards.csv`, rewardsCSV);
    console.log(`Rewards CSV saved to ${outputDir}/rewards.csv`);
}

main().catch((error) => {
    console.error("Error occurred:", error);
    process.exit(1);
});