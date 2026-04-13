import { spawn, type ChildProcess } from 'node:child_process';
import { ethers } from 'ethers';

const ANVIL_PORT = 8546;

export function startAnvilFork(): ChildProcess {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error('BASE_RPC_URL not set');

  const anvil = spawn('anvil', [
    '--fork-url', rpcUrl,
    '--port', String(ANVIL_PORT),
    '--silent',
  ], { stdio: 'pipe' });

  return anvil;
}

export async function waitForAnvil(timeoutMs = 15000): Promise<ethers.JsonRpcProvider> {
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      await provider.getBlockNumber();
      return provider;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Anvil did not start within ${timeoutMs / 1000}s`);
}

export async function simulateDeployment(
  provider: ethers.JsonRpcProvider,
  safeAddress: string,
  approvals: Array<{ to: string; calldata: string }>,
  deploymentCalldata: string,
  orderbookAddress: string,
): Promise<void> {
  await provider.send('anvil_impersonateAccount', [safeAddress]);
  await provider.send('anvil_setBalance', [
    safeAddress,
    ethers.toQuantity(ethers.parseEther('10')),
  ]);

  const signer = await provider.getSigner(safeAddress);

  for (const approval of approvals) {
    const tx = await signer.sendTransaction({
      to: approval.to,
      data: approval.calldata,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Simulation: approval tx failed for ${approval.to}`);
    }
  }

  const deployTx = await signer.sendTransaction({
    to: orderbookAddress,
    data: deploymentCalldata,
  });
  const deployReceipt = await deployTx.wait();
  if (!deployReceipt || deployReceipt.status !== 1) {
    throw new Error('Simulation: deployment tx reverted');
  }

  const iface = new ethers.Interface([
    'event AddOrderV2(address sender, bytes32 orderHash, (address, (address, address, bytes), (address, uint8, uint256)[], (address, uint8, uint256)[], bytes32) order)',
  ]);

  let foundEvent = false;
  for (const log of deployReceipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'AddOrderV2') {
        foundEvent = true;
        console.log(`  Simulation: AddOrderV2 emitted, orderHash=${parsed.args.orderHash}`);
        break;
      }
    } catch {
      // Not this event
    }
  }

  if (!foundEvent) {
    throw new Error('Simulation: AddOrderV2 event not found in deployment receipt');
  }

  await provider.send('anvil_stopImpersonatingAccount', [safeAddress]);
}

export async function runSimulation(
  tokenDeployments: Array<{
    safeAddress: string;
    symbol: string;
    approvals: Array<{ to: string; calldata: string }>;
    deploymentCalldata: string;
    orderbookAddress: string;
  }>
): Promise<void> {
  console.log('Starting Anvil fork simulation...');
  const anvil = startAnvilFork();

  try {
    const provider = await waitForAnvil();
    console.log('Anvil fork ready.');

    for (const deployment of tokenDeployments) {
      console.log(`Simulating ${deployment.symbol} deployment...`);
      await simulateDeployment(
        provider,
        deployment.safeAddress,
        deployment.approvals,
        deployment.deploymentCalldata,
        deployment.orderbookAddress,
      );
      console.log(`  ${deployment.symbol} simulation passed.`);
    }

    console.log('All simulations passed.');
  } finally {
    anvil.kill('SIGTERM');
  }
}
