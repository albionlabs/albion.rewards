#!/bin/bash

# Check if all required arguments are provided
if [ $# -ne 4 ]; then
    echo "Usage: ./calculate_claims.sh <year> <month> <tokenAddress> <distributionAmount>"
    echo "Example: ./calculate_claims.sh 2025 8 0xd5316ca888491575befc0273a00de2186c53f760 1000000"
    exit 1
fi

# Parse command line arguments
YEAR=$1
MONTH=$2
TOKEN_ADDRESS=$3
DISTRIBUTION_AMOUNT=$4

echo "Starting Albion Rewards calculation pipeline..."
echo "Year: $YEAR"
echo "Month: $MONTH"
echo "Token Address: $TOKEN_ADDRESS"
echo "Distribution Amount: $DISTRIBUTION_AMOUNT"
echo ""

# Step 1: Run scrape
echo "Step 1: Running scrape..."
npm run scrape
if [ $? -ne 0 ]; then
    echo "Error: Scrape failed"
    exit 1
fi
echo "Scrape completed successfully"
echo ""

# Step 2: Generate snapshots
echo "Step 2: Generating snapshots for $YEAR-$MONTH for token $TOKEN_ADDRESS..."
npm run generate-snapshots $YEAR $MONTH $TOKEN_ADDRESS
if [ $? -ne 0 ]; then
    echo "Error: Generate snapshots failed"
    exit 1
fi
echo "Snapshots generated successfully"
echo ""

# Step 3: Process and calculate claims
echo "Step 3: Processing transfers and calculating claims..."
SNAPSHOT_FILE="output/$YEAR-$(printf "%02d" $MONTH)/$TOKEN_ADDRESS/snapshot.json"
npm run start "$SNAPSHOT_FILE" "$TOKEN_ADDRESS" "$DISTRIBUTION_AMOUNT"
if [ $? -ne 0 ]; then
    echo "Error: Processing failed"
    exit 1
fi
echo "Processing completed successfully"
echo ""

echo "Pipeline completed! Check the following files:"
echo "- $SNAPSHOT_FILE"
echo "- output/$YEAR-$(printf "%02d" $MONTH)/$TOKEN_ADDRESS/balances.json"
echo "- output/$YEAR-$(printf "%02d" $MONTH)/$TOKEN_ADDRESS/rewards.csv"
