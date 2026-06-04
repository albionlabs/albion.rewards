import {
  CLAIMS_STRATEGY_URL,
  SETTINGS_YAML_URL,
  ORDERBOOK_STANDIN_ADDRESS,
  ORDERBOOK_ADDRESS,
} from "../constants";

export interface DeploymentArgs {
  approvals: Array<{ token: string; calldata: string; symbol: string }>;
  deploymentCalldata: string;
  orderbookAddress: string;
  chainId: number;
  // alpha.229 adds this; we ignore it (we keep the existing MetaBoard phase-2 step).
  emitMetaCall?: { to: string; calldata: string };
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
 * Rewrite the base orderbook address in the pinned settings.yaml to `targetAddress`.
 *
 * Pure string substitution on the raw YAML — no parse/round-trip — so the SDK
 * receives the file in its original format with only the orderbook address
 * changed (avoids any YAML re-emit coercing the mixed-case `0x…` address).
 * The settings.yaml is pinned to a fixed commit, where the base orderbook
 * address appears exactly once; we assert that and fail loudly otherwise rather
 * than silently deploy to the wrong orderbook.
 */
export function applyOrderbookOverride(
  rawYaml: string,
  standinAddress: string,
  targetAddress: string,
): string {
  if (standinAddress.toLowerCase() === targetAddress.toLowerCase()) {
    return rawYaml; // default: no override requested
  }
  const occurrences = rawYaml.split(standinAddress).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Orderbook override: expected exactly one occurrence of the stand-in ` +
        `orderbook address ${standinAddress} in settings.yaml, found ${occurrences}. ` +
        `Refusing to override (settings.yaml shape may have changed).`,
    );
  }
  return rawYaml.replace(standinAddress, targetAddress);
}

/**
 * Fetch the settings YAML from the pinned URL, applying the in-memory orderbook
 * address override (see ORDERBOOK_ADDRESS in constants.ts).
 */
async function fetchSettings(): Promise<string> {
  const response = await fetch(SETTINGS_YAML_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch settings YAML: ${response.status}`);
  }
  const raw = await response.text();
  return applyOrderbookOverride(raw, ORDERBOOK_STANDIN_ADDRESS, ORDERBOOK_ADDRESS);
}

/**
 * Build deployment transaction args for a claims order using the Rain SDK.
 *
 * Uses DotrainOrderGui (same pattern as raindex v6 webapp).
 * The SDK bundles addOrder4 + deposit4 into a single deploymentCalldata via the
 * new v6 settings YAML (which supplies the orderbook address / network config).
 */
export async function buildOrderCalldata(
  merkleRoot: string,
  depositAmountHuman: string,
  safeAddress: string,
  outputToken: string,
  inputToken: string,
): Promise<DeploymentArgs> {
  // Dynamic import since @rainlanguage/orderbook uses WASM
  const { DotrainOrderGui } = await import("@rainlanguage/orderbook");

  const [dotrain, settings] = await Promise.all([fetchDotrain(), fetchSettings()]);

  // The deployment key for claims orders — needs to match what the .rain file exports.
  const deploymentKey = "base";

  const guiResult = await DotrainOrderGui.newWithDeployment(
    dotrain,
    [settings], // alpha.229: settings is string[] | null
    deploymentKey,
    null, // state_update_callback — no-op for CLI usage
  );

  if (guiResult.error) {
    throw new Error(
      `Failed to initialise DotrainOrderGui: ${guiResult.error.readableMsg ?? JSON.stringify(guiResult.error)}`,
    );
  }
  const gui = guiResult.value;

  // Configure tokens
  const outputResult = await gui.setSelectToken("output", outputToken);
  if (outputResult.error) {
    throw new Error(
      `Failed to set output token: ${outputResult.error.readableMsg ?? JSON.stringify(outputResult.error)}`,
    );
  }

  const inputResult = await gui.setSelectToken("input", inputToken);
  if (inputResult.error) {
    throw new Error(
      `Failed to set input token: ${inputResult.error.readableMsg ?? JSON.stringify(inputResult.error)}`,
    );
  }

  // Set the merkle root field (sync in alpha.229; await is a harmless no-op, kept for uniformity)
  const fieldResult = await gui.setFieldValue("root", merkleRoot);
  if (fieldResult.error) {
    throw new Error(
      `Failed to set merkle root field: ${fieldResult.error.readableMsg ?? JSON.stringify(fieldResult.error)}`,
    );
  }

  // Set deposit amount — human-readable, e.g. "1000.50" (must be awaited in alpha.229)
  const depositResult = await gui.setDeposit("output", depositAmountHuman);
  if (depositResult.error) {
    throw new Error(
      `Failed to set deposit: ${depositResult.error.readableMsg ?? JSON.stringify(depositResult.error)}`,
    );
  }

  // Build the deployment transaction
  const result = await gui.getDeploymentTransactionArgs(safeAddress);

  if (result.error) {
    throw new Error(
      `Failed to build deployment args: ${result.error.readableMsg ?? JSON.stringify(result.error)}`,
    );
  }

  return result.value;
}
