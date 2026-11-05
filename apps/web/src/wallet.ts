// Wallet connection and signing through Stellar Wallets Kit v2 (DEC-011), testnet only. The kit only connects and signs;
// Vants never sees a key (INV-09). The kit remembers the chosen wallet and address in localStorage, so a returning user
// signs with the same wallet without picking it again (T-023). WalletConnect (T-046, DEC-062) joins the list when the build
// has a Reown project id; its module (and Reown's AppKit behind it) loads in its own chunk, only then.
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { BitgetModule } from "@creit.tech/stellar-wallets-kit/modules/bitget";
import { CactusLinkModule } from "@creit.tech/stellar-wallets-kit/modules/cactuslink";
import { DcentModule } from "@creit.tech/stellar-wallets-kit/modules/dcent";
import { FordefiModule } from "@creit.tech/stellar-wallets-kit/modules/fordefi";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { GhostsigModule } from "@creit.tech/stellar-wallets-kit/modules/ghostsig";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { KleverModule } from "@creit.tech/stellar-wallets-kit/modules/klever";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { OneKeyModule } from "@creit.tech/stellar-wallets-kit/modules/onekey";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { ScopulyModule } from "@creit.tech/stellar-wallets-kit/modules/scopuly";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { KitEventType, type ModuleInterface, Networks } from "@creit.tech/stellar-wallets-kit/types";
import { walletConnectParams } from "./walletconnect.ts";

export const NETWORK_PASSPHRASE = Networks.TESTNET;

/** The build's Reown project id, when WalletConnect is on (set VITE_WALLETCONNECT_PROJECT_ID at build time). */
const WC = walletConnectParams(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID, location.origin);

/** True when the wallet picker offers WalletConnect. */
export const walletConnectOn = WC !== null;

/** WalletConnect's module, built once from its own chunk (T-046). */
async function walletConnectModule(): Promise<ModuleInterface[]> {
  if (!WC) return [];
  const { WalletConnectModule, WalletConnectTargetChain } = await import(
    "@creit.tech/stellar-wallets-kit/modules/wallet-connect"
  );
  return [
    new WalletConnectModule({
      projectId: WC.projectId,
      metadata: WC.metadata,
      // Testnet only (INV-07): the module asks for the public network unless told otherwise.
      allowedChains: [WalletConnectTargetChain.TESTNET],
      // Its QR modal in Vants' colours. The module adds the network and features the Stellar wallets (Freighter, LOBSTR,
      // Scopuly) first; Reown's directory also lists EVM wallets after them, which can't sign for Stellar.
      appKitOptions: {
        themeMode: "light",
        themeVariables: {
          "--w3m-accent": "oklch(47% 0.215 266)",
          "--w3m-border-radius-master": "1px",
          "--w3m-font-family": "Archivo, system-ui, sans-serif",
        },
      } as unknown as NonNullable<ConstructorParameters<typeof WalletConnectModule>[0]["appKitOptions"]>,
    }),
  ];
}

let starting: Promise<void> | null = null;
function start(): Promise<void> {
  starting ??= walletConnectModule().then((extra) => {
    StellarWalletsKit.init({
      // The kit's default wallets minus MetaMask's Stellar Snap. Its constructor starts restoring a session on page load and
      // warns "Transport request timed out" when there is none, so filtering it after construction (defaultModules'
      // filterBy) is too late: it is never built.
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new LobstrModule(),
        new AlbedoModule(),
        new RabetModule(),
        new HanaModule(),
        new KleverModule(),
        new OneKeyModule(),
        new BitgetModule(),
        new FordefiModule(),
        new CactusLinkModule(),
        new DcentModule(),
        new ScopulyModule(),
        new GhostsigModule(),
        ...extra,
      ],
      network: Networks.TESTNET,
      // The kit's modal in the Vants design system: its tokens.
      theme: {
        background: "var(--bg-raised)",
        "background-secondary": "var(--bg-sunken)",
        "foreground-strong": "var(--text)",
        foreground: "var(--text-secondary)",
        "foreground-secondary": "var(--text-muted)",
        primary: "var(--accent)",
        "primary-foreground": "var(--on-accent)",
        transparent: "rgba(0, 0, 0, 0)",
        lighter: "var(--bg-sunken)",
        light: "var(--line)",
        "light-gray": "var(--line)",
        gray: "var(--text-muted)",
        danger: "var(--danger)",
        border: "var(--line)",
        shadow: "var(--shadow-float)",
        "border-radius": "var(--radius-lg)",
        "font-family": "var(--font-sans)",
      },
    });
  });
  return starting;
}

const WC_ID = "wallet_connect";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * WalletConnect's client starts asynchronously after the page loads; a signature asked for right after a reload waits for it
 * (up to 10 s) instead of failing with the module's "has not been started yet".
 */
async function walletReady(): Promise<void> {
  const m = StellarWalletsKit.selectedModule;
  if (m.productId !== WC_ID) return;
  for (let i = 0; i < 40 && !(await m.isAvailable()); i++) await sleep(250);
}

/** The module's English errors about a lost WalletConnect session, as the app says them. */
function walletError(err: unknown): unknown {
  const msg =
    err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : "";
  if (/No WalletConnect session|session.*expired|has not been started|not running yet/i.test(msg))
    return new Error("A conexão com a sua carteira caiu. Desconecte em Conta e conecte de novo pelo WalletConnect.");
  return err;
}

/** Opens the kit's wallet picker and returns the connected account (G…). */
export async function connect(): Promise<string> {
  await start();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

/** The wallet and address remembered from an earlier visit, if any. */
export async function remembered(): Promise<{ address: string; wallet: string } | null> {
  await start();
  try {
    const { address } = await StellarWalletsKit.getAddress();
    return address ? { address, wallet: walletName() ?? "Carteira" } : null;
  } catch {
    return null;
  }
}

export function walletName(): string | null {
  try {
    return StellarWalletsKit.selectedModule.productName;
  } catch {
    return null;
  }
}

export async function sign(xdr: string, address: string): Promise<string> {
  // Dev preview only (T-035): the preview "signs" so flows can be followed to their end; stripped from production builds.
  const previewSign = import.meta.env.DEV
    ? (window as Window & { __vantsPreviewSign?: (x: string) => Promise<string> }).__vantsPreviewSign
    : undefined;
  if (previewSign) return previewSign(xdr);
  await start();
  await walletReady();
  try {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address,
    });
    return signedTxXdr;
  } catch (err) {
    throw walletError(err);
  }
}

export async function disconnect(): Promise<void> {
  await start();
  await StellarWalletsKit.disconnect().catch(() => undefined);
}

/** Calls back when the wallet disconnects on its side. */
export function onWalletDisconnect(fn: () => void): () => void {
  let off: (() => void) | null = null;
  let gone = false;
  void start().then(() => {
    if (!gone) off = StellarWalletsKit.on(KitEventType.DISCONNECT, fn);
  });
  return () => {
    gone = true;
    off?.();
  };
}
