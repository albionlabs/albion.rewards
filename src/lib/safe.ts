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

/** OrderV4 tuple ABI (Raindex v6): IOs are (address token, bytes32 vaultId) — no decimals. */
const ORDER_V4_TUPLE =
  '(address owner, (address interpreter, address store, bytes bytecode) evaluable, (address token, bytes32 vaultId)[] validInputs, (address token, bytes32 vaultId)[] validOutputs, bytes32 nonce)';

export interface ExtractedOrder {
  orderHash: string;
  /**
   * ABI-encoded OrderV4 tuple. The issuance site reconstructs the order for
   * claim proofs via AbiCoder.decode([OrderV4], orderBytes) — it has no runtime
   * subgraph lookup — so this MUST be baked into the network.ts claim entry or
   * claims render as $0. Encoded from the same tuple that hashes to orderHash.
   */
  orderBytes: string;
  /** Block the add-order tx landed in; the issuance site's claim entry deployBlock. */
  deployBlock: number;
}

/**
 * Extract the order (hash + ABI-encoded bytes + deploy block) from the AddOrderV3
 * event in a transaction receipt (Raindex v6). AddOrderV3 uses OrderV4 IOs:
 * (address token, bytes32 vaultId) — no decimals field.
 */
export function extractOrderFromReceipt(receipt: ethers.TransactionReceipt): ExtractedOrder {
  const iface = new ethers.Interface([
    `event AddOrderV3(address sender, bytes32 orderHash, ${ORDER_V4_TUPLE} order)`,
  ]);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'AddOrderV3') {
        const orderBytes = ethers.AbiCoder.defaultAbiCoder().encode(
          [ORDER_V4_TUPLE],
          [parsed.args.order],
        );
        return {
          orderHash: parsed.args.orderHash,
          orderBytes,
          deployBlock: receipt.blockNumber,
        };
      }
    } catch {
      // Not this event, continue
    }
  }

  throw new Error('AddOrderV3 event not found in transaction receipt');
}

/**
 * Extract just the orderHash from an AddOrderV3 receipt. Thin wrapper over
 * {@link extractOrderFromReceipt} for callers that only need the hash.
 */
export function extractOrderHashFromReceipt(receipt: ethers.TransactionReceipt): string {
  return extractOrderFromReceipt(receipt).orderHash;
}
