// The Stellar half of a CCTP transfer (ported from the spike's `burnOnStellar` and `src/stellar/client.ts`): the SAC allowance
// for TokenMessengerMinter, and the approve and `deposit_for_burn` invocations, built, simulated (prepareTransaction) and
// signed, but NOT submitted. The caller persists each envelope before submitting it and resubmits it unchanged until its
// deadline (the treasury-envelope rule, DEC-023), so a burn lands at most once.
import {
  Address,
  BASE_FEE,
  Contract,
  type Keypair,
  Networks,
  nativeToScVal,
  rpc,
  scValToNative,
  type Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { DOMAIN, FINALITY_STANDARD, STELLAR_TESTNET } from "./addresses.ts";
import { evmAddressToBytes32 } from "./units.ts";

export interface Envelope {
  xdr: string;
  hash: string;
  /** Unix seconds after which the network refuses it. */
  maxTime: number;
}

const addr = (a: string) => new Address(a).toScVal();
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
/** ~1 day of ledgers at ~5 s: the allowance outlives any retrying burn. */
const ALLOWANCE_LEDGERS = 17_280;

export class StellarCctp {
  readonly #server: rpc.Server;
  readonly #signer: Keypair;
  readonly #timeoutSeconds: number;

  constructor(opts: { server: rpc.Server; signer: Keypair; timeoutSeconds?: number }) {
    this.#server = opts.server;
    this.#signer = opts.signer;
    this.#timeoutSeconds = opts.timeoutSeconds ?? 300;
  }

  get treasury(): string {
    return this.#signer.publicKey();
  }

  /** USDC the TokenMessengerMinter may still pull from the treasury (7 decimals). */
  async allowance(): Promise<bigint> {
    const tx = await this.#unsigned(
      STELLAR_TESTNET.usdcSac,
      "allowance",
      [addr(this.treasury), addr(STELLAR_TESTNET.tokenMessengerMinter)],
      0,
    );
    const sim = await this.#server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`allowance simulation failed: ${sim.error}`);
    if (!sim.result) throw new Error("allowance simulation returned no result");
    return BigInt(scValToNative(sim.result.retval) as bigint);
  }

  async buildApprove(amount7: bigint, nowSeconds: number): Promise<Envelope> {
    const liveUntil = (await this.#server.getLatestLedger()).sequence + ALLOWANCE_LEDGERS;
    return this.#signed(
      STELLAR_TESTNET.usdcSac,
      "approve",
      [addr(this.treasury), addr(STELLAR_TESTNET.tokenMessengerMinter), i128(amount7), u32(liveUntil)],
      nowSeconds,
    );
  }

  /** deposit_for_burn(caller, amount, destination_domain, mint_recipient, burn_token, destination_caller, max_fee, min_finality). */
  async buildBurn(input: {
    amount7: bigint;
    maxFee7: bigint;
    recipient: string;
    nowSeconds: number;
  }): Promise<Envelope> {
    if (input.amount7 % 10n !== 0n)
      throw new Error("burn amounts must sit on a 6-decimal boundary (no 7th-digit dust)");
    return this.#signed(
      STELLAR_TESTNET.tokenMessengerMinter,
      "deposit_for_burn",
      [
        addr(this.treasury),
        i128(input.amount7),
        u32(DOMAIN.base),
        xdr.ScVal.scvBytes(evmAddressToBytes32(input.recipient)),
        addr(STELLAR_TESTNET.usdcSac),
        xdr.ScVal.scvBytes(Buffer.alloc(32)), // zero destination_caller: anyone may submit the mint
        i128(input.maxFee7), // 7-decimal units on Stellar (measured in the spike: Iris decodes it ÷10)
        u32(FINALITY_STANDARD),
      ],
      input.nowSeconds,
    );
  }

  async #unsigned(contractId: string, method: string, args: xdr.ScVal[], maxTime: number): Promise<Transaction> {
    const source = await this.#server.getAccount(this.treasury);
    return new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime },
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .build();
  }

  async #signed(contractId: string, method: string, args: xdr.ScVal[], nowSeconds: number): Promise<Envelope> {
    const tx = await this.#unsigned(contractId, method, args, nowSeconds + this.#timeoutSeconds);
    const prepared = await this.#server.prepareTransaction(tx); // simulation: footprint, resources and fee
    prepared.sign(this.#signer);
    const maxTime = Number(prepared.timeBounds?.maxTime ?? 0);
    if (!maxTime) throw new Error("prepared transaction lost its deadline");
    return { xdr: prepared.toXDR(), hash: Buffer.from(prepared.hash()).toString("hex"), maxTime };
  }
}
