import { readFile, writeFile, mkdir } from "fs/promises";
import { Transfer } from "./types";
import { Processor } from "./processor";
import { config } from "dotenv";

// Load environment variables
config();

const SNAPSHOT_BLOCK_1 = parseInt(process.env.SNAPSHOT_BLOCK_1 || "0");
const SNAPSHOT_BLOCK_2 = parseInt(process.env.SNAPSHOT_BLOCK_2 || "0");

async function main() {
    console.log("Starting processor...");
    console.log(`Snapshot blocks: ${SNAPSHOT_BLOCK_1}, ${SNAPSHOT_BLOCK_2}`);

    // Create output directory if it doesn't exist
    await mkdir("output", { recursive: true });

    // Read transfers file
    console.log("Reading transfers file...");
    const transfersData = await readFile("data/transfers.dat", "utf8");
    const transfers = transfersData
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    console.log(`Found ${transfers.length} transfers`);

    // Create processor instance
    const processor = new Processor(SNAPSHOT_BLOCK_1, SNAPSHOT_BLOCK_2);
    
    // Process transfers and calculate balances
    processor.processTransfers(transfers);
    
    // Calculate proportions
    const tokenProportions = processor.calculateProportions();

    // console.log(tokenProportions);
    
    // Print results to console
    processor.printBalanceSummary(tokenProportions);
    
    // Save detailed results to file
    const outputData = processor.generateOutputData(tokenProportions);
    await writeFile("output/balance_analysis.json", JSON.stringify(outputData, null, 2));
    console.log("\nDetailed results saved to output/balance_analysis.json");
}

main().catch((error) => {
    console.error("Error occurred:", error);
    process.exit(1);
  }); 