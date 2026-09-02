/**
 * Re-pin a month's metadata.json on the SFTs without re-running phase 2.
 *
 * Usage: npx tsx scripts/repin-metadata.ts --month YYYY-MM
 *
 * Phase 2 cannot be re-run once its payoutData entry is filled in
 * (validateToken requires a *pending* entry), but metadata sometimes needs
 * republishing after the distribution — e.g. adding tokenTerms. This performs
 * only phase 2's step 8: upload the current metadata.json to Pinata, build the
 * Rain-encoded metadata, and propose one emitMeta call per token via the
 * Metadata Safe. It does not touch payoutData, CSVs, or git.
 */
import { config } from "dotenv";
config();

import fs from "fs";
import { ethers } from "ethers";
import {
  TOKENS,
  METABOARD_ADDRESS,
  METADATA_SAFE,
  METABOARD_ABI,
} from "../src/constants";
import { resolveOutputDir } from "../src/lib/validation";
import { proposeSafeTransaction } from "../src/lib/safe";
import { uploadToPinata } from "../src/lib/pinata";
import {
  fetchSchemaHash,
  buildMetadataHex,
  generateMetaboardSubject,
} from "../src/lib/metadata";

function parseMonth(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--month" && args[i + 1]) return args[i + 1];
  }
  console.error("Usage: npx tsx scripts/repin-metadata.ts --month YYYY-MM");
  process.exit(1);
}

async function main() {
  const month = parseMonth();
  const dateRange = resolveOutputDir(month);
  const outputBase = "output";

  console.log(`\n=== Re-pin metadata (${month}) ===\n`);

  const schemaHash = await fetchSchemaHash(TOKENS[0].address);
  console.log(`Schema hash: ${schemaHash}`);

  const calls: Array<{ to: string; data: string; value: string }> = [];

  for (const token of TOKENS) {
    const metadataPath = `${outputBase}/${dateRange}/${token.address}/metadata.json`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`metadata.json not found: ${metadataPath}`);
    }
    const metadataJson = fs.readFileSync(metadataPath, "utf8");

    const upload = await uploadToPinata(
      metadataJson,
      `metadata_${token.symbol}_${month}.json`,
      "application/json",
    );
    console.log(`  ${token.symbol}: metadata CID=${upload.cid}`);

    const metadataHex = buildMetadataHex(metadataJson, schemaHash, upload.cid);
    const subject = generateMetaboardSubject(token.address);
    const iface = new ethers.Interface(METABOARD_ABI);
    calls.push({
      to: METABOARD_ADDRESS,
      data: iface.encodeFunctionData("emitMeta", [subject, metadataHex]),
      value: "0",
    });
  }

  const proposal = await proposeSafeTransaction(METADATA_SAFE, calls);

  console.log("\n========================================");
  console.log("Sign and execute the metadata Safe transaction:");
  console.log(`  ${proposal.safeUrl}`);
  console.log("========================================\n");
}

main().catch((error) => {
  console.error("\nFATAL:", error.message || error);
  process.exit(1);
});
