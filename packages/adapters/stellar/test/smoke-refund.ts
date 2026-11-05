// Live smoke for T-009 (testnet): refund one deposit from a persisted envelope, resubmit the same envelope, and prove the
// recipient was paid exactly once.
//   node --env-file=../../../.env test/smoke-refund.ts <toAccount> <amount7> <muxId>   (from packages/adapters/stellar)
import { Asset, Horizon, Keypair, rpc } from "@stellar/stellar-sdk";
import { assertTestnet, buildRefundTx, refundMemo, submitAndWait, treasuryBalances } from "../src/treasury.ts";

const [to = "", amount7 = "", muxId = ""] = process.argv.slice(2);
const server = new rpc.Server(process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org");
const horizon = new Horizon.Server(process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org");
const treasury = Keypair.fromSecret(process.env.TREASURY_SECRET ?? "");

await assertTestnet(server);
console.log("RPC is testnet ✓");

const memo = refundMemo(muxId, 1);
const built = buildRefundTx({
  source: await server.getAccount(treasury.publicKey()),
  signer: treasury,
  to,
  asset: Asset.native(),
  amount7: BigInt(amount7),
  memo,
});
console.log(`refund envelope ${built.hash} (memo "${memo}", maxTime ${built.maxTime}) persisted in memory`);

const first = await submitAndWait(server, built.xdr);
const second = await submitAndWait(server, built.xdr);
console.log(`first submit: ${first} · resubmit of the same envelope: ${second}`);

const refunds = (await horizon.payments().forAccount(to).order("desc").limit(20).call()).records.filter(
  (p) => p.type === "payment" && p.transaction_hash === built.hash,
);
console.log(`payments to ${to.slice(0, 6)}… from this envelope on the ledger: ${refunds.length}`);

for (const b of await treasuryBalances(horizon, treasury.publicKey())) {
  console.log(`treasury balance ${b.assetName}: ${b.amount7} (SAC ${b.sacId.slice(0, 6)}…)`);
}
