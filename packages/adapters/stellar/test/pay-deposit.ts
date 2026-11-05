// Pays a Vants deposit like a wallet would: a classic payment from the test payer to the deposit's M… address (testnet).
//   node --env-file=../../../.env test/pay-deposit.ts <M… address> <CODE:ISSUER> <amount>   (from packages/adapters/stellar)
import { BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { classicAsset } from "../src/treasury.ts";

const [address = "", assetName = "", amount = ""] = process.argv.slice(2);
if (!address.startsWith("M") || !assetName || !/^\d+(\.\d{1,7})?$/.test(amount))
  throw new Error("usage: pay-deposit.ts <M… address> <CODE:ISSUER> <amount>");
const secret = process.env.TEST_PAYER_SECRET ?? "";
if (!secret) throw new Error("TEST_PAYER_SECRET is not set (run setup-testnet-funds.ts)");
const horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
if (!new URL(horizonUrl).hostname.includes("testnet")) throw new Error("testnet Horizon only (INV-07)");

const horizon = new Horizon.Server(horizonUrl);
const payer = Keypair.fromSecret(secret);
const tx = new TransactionBuilder(await horizon.loadAccount(payer.publicKey()), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({ destination: address, asset: classicAsset(assetName), amount }))
  .setTimeout(60)
  .build();
tx.sign(payer);
const r = await horizon.submitTransaction(tx);
console.log(`paid ${amount} ${assetName.split(":")[0]} from ${payer.publicKey()} → ${address.slice(0, 8)}…: ${r.hash}`);
