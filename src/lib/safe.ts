import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { ethers } from 'ethers';
import { BASE_CHAIN_ID } from '../constants';

export interface ProposalResult {
  safeTxHash: string;
  safeUrl: string;
}

export interface ExecutionResult {
  transactionHash: string;
  safeTxHash: string;
}

/**
 * Propose a multisend Safe transaction.
 */
export async function proposeSafeTransaction(
  safeAddress: string,
  transactions: Array<{ to: string; data: string; value: string }>,
): Promise<ProposalResult> {
  const rpcUrl = process.env.BASE_RPC_URL;
  const signerKey = process.env.PROPOSER_PRIVATE_KEY;
  if (!rpcUrl) throw new Error('BASE_RPC_URL not set');
  if (!signerKey) throw new Error('PROPOSER_PRIVATE_KEY not set');

  // Safe SDK requires checksummed addresses
  const checksummedSafe = ethers.getAddress(safeAddress);

  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: signerKey,
    safeAddress: checksummedSafe,
  });

  const safeTransaction = await protocolKit.createTransaction({ transactions });
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);

  // Sign the hash directly — delegates can't use protocolKit.signTransaction()
  const signer = new ethers.Wallet(signerKey);
  const proposerAddress = signer.address;
  // eth_sign: sign with message prefix, then adjust v += 4 (27→31, 28→32)
  const rawSig = await signer.signMessage(ethers.getBytes(safeTxHash));
  const sigBytes = ethers.getBytes(rawSig);
  sigBytes[64] += 4;
  const signature = ethers.hexlify(sigBytes);

  const apiKit = new SafeApiKit({ chainId: BASE_CHAIN_ID, apiKey: process.env.SAFE_API_KEY });
  await apiKit.proposeTransaction({
    safeAddress: checksummedSafe,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: proposerAddress,
    senderSignature: signature,
  });

  const safeUrl = `https://app.safe.global/transactions/tx?safe=base:${checksummedSafe}&id=multisig_${checksummedSafe}_${safeTxHash}`;

  return { safeTxHash, safeUrl };
}

/**
 * Poll Safe Transaction Service until a tx is executed.
 */
export async function waitForExecution(
  safeTxHash: string,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<ExecutionResult> {
  const intervalMs = options?.intervalMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 120000;

  const apiKit = new SafeApiKit({ chainId: BASE_CHAIN_ID, apiKey: process.env.SAFE_API_KEY });
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tx = await apiKit.getTransaction(safeTxHash);
    if (tx.isExecuted && tx.transactionHash) {
      return { transactionHash: tx.transactionHash, safeTxHash };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout: Safe tx ${safeTxHash} not executed within ${timeoutMs / 1000}s`);
}

/**
 * Check that the proposer is registered as a delegate on a Safe.
 */
export async function checkDelegate(safeAddress: string): Promise<void> {
  const signerKey = process.env.PROPOSER_PRIVATE_KEY;
  if (!signerKey) throw new Error('PROPOSER_PRIVATE_KEY not set');

  const signer = new ethers.Wallet(signerKey);
  const proposerAddress = signer.address.toLowerCase();

  const apiKit = new SafeApiKit({ chainId: BASE_CHAIN_ID, apiKey: process.env.SAFE_API_KEY });
  const delegates = await apiKit.getSafeDelegates({ safeAddress: ethers.getAddress(safeAddress) });

  const isDelegate = delegates.results.some(
    (d: any) => d.delegate.toLowerCase() === proposerAddress
  );

  if (!isDelegate) {
    throw new Error(
      `Proposer ${proposerAddress} is not a delegate on Safe ${safeAddress}. Add via Safe UI > Settings > Delegates.`
    );
  }
}

/**
 * Extract orderHash from AddOrderV2 event in a transaction receipt.
 */
export function extractOrderHashFromReceipt(receipt: ethers.TransactionReceipt): string {
  const iface = new ethers.Interface([
    'event AddOrderV2(address sender, bytes32 orderHash, (address owner, (address interpreter, address store, bytes bytecode) evaluable, (address token, uint8 decimals, uint256 vaultId)[] validInputs, (address token, uint8 decimals, uint256 vaultId)[] validOutputs, bytes32 nonce) order)',
  ]);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'AddOrderV2') {
        return parsed.args.orderHash;
      }
    } catch {
      // Not this event, continue
    }
  }

  throw new Error('AddOrderV2 event not found in transaction receipt');
}
