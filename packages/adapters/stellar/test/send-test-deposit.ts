// Sends a testnet XLM deposit to the treasury with a memo id, from a fresh Friendbot-funded sender (testnet only).
//   node --env-file=../../../.env test/send-test-deposit.ts <memoId> [amount]   (from packages/adapters/stellar)
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const [memoId = "", amount = "1"] = process.argv.slice(2);
if (!/^\d+$/.test(memoId)) throw new Error("usage: send-test-deposit.ts <memoId> [amount]");
const treasurySecret = process.env.TREASURY_SECRET ?? "";
if (!treasurySecret) throw new Error("TREASURY_SECRET is not set");

const horizon = new Horizon.Server(process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org");
const treasury = Keypair.fromSecret(treasurySecret).publicKey();
const sender = Keypair.random();
const fund = await fetch(`https://friendbot.stellar.org?addr=${sender.publicKey()}`);
if (!fund.ok) throw new Error(`friendbot: ${fund.status}`);

const tx = new TransactionBuilder(await horizon.loadAccount(sender.publicKey()), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({ destination: treasury, asset: Asset.native(), amount }))
  .addMemo(Memo.id(memoId))
  .setTimeout(60)
  .build();
tx.sign(sender);
const r = await horizon.submitTransaction(tx);
console.log(`sent ${amount} XLM memo ${memoId} from ${sender.publicKey()} → ${treasury}: ${r.hash}`);
