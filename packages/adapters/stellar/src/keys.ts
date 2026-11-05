// Treasury key helpers. The secret stays in the worker; only its public key leaves (e.g. as Pier's subscription filter).
import { Keypair } from "@stellar/stellar-sdk";

export const publicKeyOf = (secret: string): string => Keypair.fromSecret(secret).publicKey();
