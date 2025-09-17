#!/bin/bash

# Check if all required arguments are provided
if [ $# -ne 4 ]; then
    echo "Usage: ./calculate_claims.sh <startTimestamp> <endTimestamp> <tokenAddress> <distributionAmount>"
    echo "Example: ./calculate_claims.sh 1725148800 1727740799 0xd5316ca888491575befc0273a00de2186c53f760 1000000"
    echo "Timestamps should be Unix timestamps in seconds"
    exit 1
fi

# Parse command line arguments
START_TIMESTAMP=$1
END_TIMESTAMP=$2
TOKEN_ADDRESS=$3
DISTRIBUTION_AMOUNT=$4

# Convert timestamps to readable dates using Node.js for consistency
START_DATE=$(node -e "console.log(new Date($START_TIMESTAMP * 1000).toISOString().split('T')[0])")
END_DATE=$(node -e "console.log(new Date($END_TIMESTAMP * 1000).toISOString().split('T')[0])")
TIMESTAMP_RANGE="${START_DATE}_to_${END_DATE}"

echo "Starting Albion Rewards calculation pipeline..."
echo "Start Timestamp: $START_TIMESTAMP ($START_DATE)"
echo "End Timestamp: $END_TIMESTAMP ($END_DATE)"
echo "Token Address: $TOKEN_ADDRESS"
echo "Distribution Amount: $DISTRIBUTION_AMOUNT"
echo ""

# Step 1: Run scrape
echo "Step 1: Running scrape..."
nix develop -c npm run scrape
if [ $? -ne 0 ]; then
    echo "Error: Scrape failed"
    exit 1
fi
echo "Scrape completed successfully"
echo ""

# Step 2: Generate snapshots
echo "Step 2: Generating snapshots from $START_DATE to $END_DATE for token $TOKEN_ADDRESS..."
nix develop -c npm run generate-snapshots $START_TIMESTAMP $END_TIMESTAMP $TOKEN_ADDRESS
if [ $? -ne 0 ]; then
    echo "Error: Generate snapshots failed"
    exit 1
fi
echo "Snapshots generated successfully"
echo ""

# Step 3: Process and calculate claims
echo "Step 3: Processing transfers and calculating claims..."
SNAPSHOT_FILE="output/$TIMESTAMP_RANGE/$TOKEN_ADDRESS/snapshot.json"
nix develop -c npm run start "$SNAPSHOT_FILE" "$TOKEN_ADDRESS" "$DISTRIBUTION_AMOUNT"
if [ $? -ne 0 ]; then
    echo "Error: Processing failed"
    exit 1
fi
echo "Processing completed successfully"
echo ""

# Step 4: Generate merkle tree
echo "Step 4: Generating merkle tree..."
REWARDS_CSV="output/$TIMESTAMP_RANGE/$TOKEN_ADDRESS/rewards.csv"
nix develop -c npm run merkle "$REWARDS_CSV"
if [ $? -ne 0 ]; then
    echo "Error: Merkle tree generation failed"
    exit 1
fi
echo "Merkle tree generated successfully"
echo ""

echo "Pipeline completed! Check the following files:"
echo "- $SNAPSHOT_FILE"
echo "- output/$TIMESTAMP_RANGE/$TOKEN_ADDRESS/balances.json"
echo "- $REWARDS_CSV"
echo "- output/$TIMESTAMP_RANGE/$TOKEN_ADDRESS/tree.json"
