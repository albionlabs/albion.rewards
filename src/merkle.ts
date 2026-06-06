import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import fs from "fs";
import { config } from "dotenv";
import { buildClaimLeaves } from "./lib/leaf";

// Load environment variables
config();

async function main() {
  console.log("Starting merkle tree generator...");

  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: tsx src/merkle.ts <csv-file>");
    console.log(
      "Example: tsx src/merkle.ts output/2025-08/0xd5316ca888491575befc0273a00de2186c53f760/rewards.csv",
    );
    process.exit(1);
  }

  const csvFile = args[0];
  console.log(`CSV file: ${csvFile}`);

  // Read CSV file
  const csvContent = fs.readFileSync(csvFile, "utf8");
  const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

  // Skip header line and parse CSV data
  const csvData = lines.slice(1).map((line) => {
    const [index, address, reward] = line.split(",").map((s) => s.trim());
    return [index, address, reward];
  });

  console.log(`Read ${csvData.length} entries from CSV`);

  // Check if CSV has exactly 256 entries
  if (csvData.length !== 256) {
    console.error(
      `Error: CSV must have exactly 256 entries, but found ${csvData.length}`,
    );
    console.error("Please ensure your CSV file contains exactly 256 entries");
    process.exit(1);
  }

  // Use the CSV data directly since it's exactly 256 entries
  const rawValues = csvData;
  console.log("=== CSV Content ===");
  console.log("index,address,amount");
  rawValues.forEach(([index, address, amount]) => {
    console.log(`${index},${address},${amount}`);
  });
  console.log("=== End CSV Content ===");

  console.log(`Padded to ${rawValues.length} entries`);

  // Hash each value to create the leaves via the shared Rain Float encoder
  const leaves = buildClaimLeaves(rawValues as Array<[string, string, string]>);

  console.log("Generated", leaves.length, "leaves");
  console.log("First few leaves:", leaves.slice(0, 3));
  console.log("Last few leaves:", leaves.slice(-3));

  // Create the Merkle tree with the hashed leaves
  const tree = SimpleMerkleTree.of(leaves);

  console.log("Merkle Root:", tree.root);

  // Extract directory from CSV file path and create tree output path
  const csvPathParts = csvFile.split("/");
  const tokenAddress = csvPathParts[csvPathParts.length - 2];
  const timestampRange = csvPathParts[csvPathParts.length - 3];
  const outputDir = `output/${timestampRange}/${tokenAddress}`;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const treeOutputPath = `${outputDir}/tree_${timestampRange}.json`;

  // Save the tree to a file
  fs.writeFileSync(treeOutputPath, JSON.stringify(tree.dump(), null, 2));
  console.log(`Tree saved to ${treeOutputPath}`);
}

main().catch((error) => {
  console.error("Error occurred:", error);
  process.exit(1);
});
