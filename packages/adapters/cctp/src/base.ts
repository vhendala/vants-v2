// The Base Sepolia half (ported from the spike's `mintOnBase`): receiveMessage on MessageTransmitterV2. CCTP nonces make the
// mint idempotent on chain (a used nonce can't mint again), and `nonceUsed` lets a retry see that before spending gas.
import { createPublicClient, createWalletClient, erc20Abi, http, parseAbi, parseEventLogs, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA } from "./addresses.ts";
import { nonceFromMessage } from "./units.ts";

const messageTransmitterV2 = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "function usedNonces(bytes32 nonce) view returns (uint256)",
]);

export class BaseMinter {
  readonly recipient: `0x${string}`;
  readonly #public;
  readonly #wallet;

  constructor(opts: { rpcUrl: string; privateKey: `0x${string}` }) {
    const account = privateKeyToAccount(opts.privateKey);
    this.recipient = account.address;
    this.#public = createPublicClient({ chain: baseSepolia, transport: http(opts.rpcUrl) });
    this.#wallet = createWalletClient({ account, chain: baseSepolia, transport: http(opts.rpcUrl) });
  }

  /** INV-07: the RPC must be Base Sepolia. */
  async assertTestnet(): Promise<void> {
    if ((await this.#public.getChainId()) !== BASE_SEPOLIA.chainId)
      throw new Error("Base RPC is not Base Sepolia (INV-07)");
  }

  async nonceUsed(message: `0x${string}`): Promise<boolean> {
    const used = await this.#public.readContract({
      address: BASE_SEPOLIA.messageTransmitterV2,
      abi: messageTransmitterV2,
      functionName: "usedNonces",
      args: [nonceFromMessage(message)],
    });
    return used !== 0n;
  }

  /** Submits the mint and waits for it; returns the USDC minted to `recipient` (6 decimals). */
  async mint(message: `0x${string}`, attestation: `0x${string}`): Promise<{ txHash: string; minted6: bigint }> {
    const txHash = await this.#wallet.writeContract({
      address: BASE_SEPOLIA.messageTransmitterV2,
      abi: messageTransmitterV2,
      functionName: "receiveMessage",
      args: [message, attestation],
    });
    const receipt = await this.#public.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1000 });
    if (receipt.status !== "success") throw new Error(`receiveMessage ${txHash} reverted`);
    const minted6 = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: "Transfer" })
      .filter(
        (l) =>
          l.address.toLowerCase() === BASE_SEPOLIA.usdc.toLowerCase() &&
          l.args.from === zeroAddress &&
          l.args.to.toLowerCase() === this.recipient.toLowerCase(),
      )
      .reduce((sum, l) => sum + l.args.value, 0n);
    return { txHash, minted6 };
  }

  async usdcBalance(): Promise<bigint> {
    return this.#public.readContract({
      address: BASE_SEPOLIA.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.recipient],
    });
  }
}
