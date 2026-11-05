// WalletConnect (T-046, DEC-062): lets a phone wallet that speaks WalletConnect (Freighter mobile, LOBSTR) connect to the app
// open on another screen, through Stellar Wallets Kit's WalletConnect module (v2.7.1). It needs a Reown project id (a public
// client id, not a secret) from the build's env, and it asks only for Stellar testnet: the kit defaults to the public
// network, so the chain is always set here (INV-07).

/** WalletConnect's chain id for Stellar testnet, as the kit's `WalletConnectTargetChain.TESTNET`. */
export const WC_TESTNET = "stellar:testnet" as const;

export interface WalletConnectParams {
  projectId: string;
  metadata: { name: string; description: string; url: string; icons: string[] };
  allowedChains: (typeof WC_TESTNET)[];
}

/** The module's parameters, or null when WalletConnect is off (no id, or not a Reown project id: 32 hex characters). */
export function walletConnectParams(projectId: string | undefined, origin: string): WalletConnectParams | null {
  const id = projectId?.trim() ?? "";
  if (!/^[0-9a-f]{32}$/i.test(id)) return null;
  return {
    projectId: id,
    metadata: {
      name: "Vants",
      description: "Pague qualquer Pix com a sua carteira Stellar.",
      url: origin,
      icons: [`${origin}/icon-192.png`],
    },
    allowedChains: [WC_TESTNET],
  };
}
