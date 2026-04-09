import { CLAIMS_STRATEGY_URL, USDC_BASE, WETH_BASE } from '../constants';

export interface DeploymentArgs {
  approvals: Array<{ token: string; calldata: string; symbol: string }>;
  deploymentCalldata: string;
  orderbookAddress: string;
  chainId: number;
}

/**
 * Fetch the claims .rain dotrain file from the pinned URL.
 */
async function fetchDotrain(): Promise<string> {
  const response = await fetch(CLAIMS_STRATEGY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch claims strategy: ${response.status}`);
  }
  return response.text();
}

/**
 * Build deployment transaction args for a claims order using the Rain SDK.
 *
 * Uses DotrainOrderGui (same pattern as raindex v4 webapp).
 * The SDK bundles addOrder2 + deposit2 into a single deploymentCalldata via TaskV1 post-action.
 */
export async function buildOrderCalldata(
  merkleRoot: string,
  depositAmountHuman: string,
  safeAddress: string,
): Promise<DeploymentArgs> {
  // Dynamic import since @rainlanguage/orderbook uses WASM
  const { DotrainOrderGui } = await import('@rainlanguage/orderbook');

  const dotrain = await fetchDotrain();

  // The deployment key for claims orders — needs to match what the .rain file exports.
  // Check the dotrain for available deployment keys.
  const deploymentKey = 'base-claims';

  const guiResult = await DotrainOrderGui.newWithDeployment(
    dotrain,
    null,               // settings — no additional YAML overrides
    deploymentKey,
    () => {},           // state_update_callback — no-op for CLI usage
  );

  if (guiResult.error) {
    throw new Error(`Failed to initialise DotrainOrderGui: ${guiResult.error.readableMsg ?? JSON.stringify(guiResult.error)}`);
  }
  const gui = guiResult.value;

  // Configure tokens
  const outputResult = await gui.setSelectToken('output', USDC_BASE);
  if (outputResult.error) {
    throw new Error(`Failed to set output token: ${outputResult.error.readableMsg ?? JSON.stringify(outputResult.error)}`);
  }

  const inputResult = await gui.setSelectToken('input', WETH_BASE);
  if (inputResult.error) {
    throw new Error(`Failed to set input token: ${inputResult.error.readableMsg ?? JSON.stringify(inputResult.error)}`);
  }

  // Set the merkle root field
  const fieldResult = gui.setFieldValue('root', merkleRoot);
  if (fieldResult.error) {
    throw new Error(`Failed to set merkle root field: ${fieldResult.error.readableMsg ?? JSON.stringify(fieldResult.error)}`);
  }

  // Set deposit amount (human-readable, e.g. "1000.50")
  const depositResult = await gui.setDeposit('output', depositAmountHuman);
  if (depositResult.error) {
    throw new Error(`Failed to set deposit: ${depositResult.error.readableMsg ?? JSON.stringify(depositResult.error)}`);
  }

  // Build the deployment transaction
  const result = await gui.getDeploymentTransactionArgs(safeAddress);

  if (result.error) {
    throw new Error(`Failed to build deployment args: ${result.error.readableMsg ?? JSON.stringify(result.error)}`);
  }

  return result.value;
}
