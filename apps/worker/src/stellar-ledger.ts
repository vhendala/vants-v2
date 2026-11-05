// The refund saga's LedgerPort over Stellar RPC (testnet; `assertTestnet` runs at startup).
import { lookupTx, submitAndWait } from "@vants/adapter-stellar";
import { rpc } from "@stellar/stellar-sdk";
import type { LedgerPort } from "./sagas/ports.ts";

export const stellarLedger = (server: rpc.Server, treasury: string): LedgerPort => ({
  account: () => server.getAccount(treasury),
  lookup: (hash) => lookupTx(server, hash),
  submit: (xdr) => submitAndWait(server, xdr),
  async feeCharged(hash) {
    const r = await server.getTransaction(hash);
    if (r.status === rpc.Api.GetTransactionStatus.NOT_FOUND)
      throw new Error(`transaction ${hash} is not on the ledger`);
    return r.resultXdr.feeCharged; // int64 "actual fee charged for the transaction" (a bigint in SDK 17.3)
  },
});
