// @vants/config: environment for `api` and `worker`, validated at startup. Testnet and sandbox only (INV-07, DEC-019).
// Every check reports the variable's name with a fixed message; values (often secrets) never appear in errors.
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

export interface ConfigIssue {
  key: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(`Invalid or missing configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Stellar mainnet hosts we know of (the spike's Abroad config). T-009 also checks the RPC's passphrase at startup. */
const STELLAR_MAINNET_HOSTS = new Set(["horizon.stellar.org"]);
const HODLE_SANDBOX_HOST = /^sandbox-api(-stg)?\.hodle\.com\.br$/;
const IRIS_SANDBOX_HOST = "iris-api-sandbox.circle.com";
/** Etherfuse's sandbox: the only Etherfuse host the PoC talks to (INV-07). */
export const ETHERFUSE_SANDBOX_HOST = "api.sand.etherfuse.com";

const hostOf = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
};

const url = z.url({ message: "must be an absolute URL" });
const schemas = {
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/, { message: "must be a postgres:// URL" }),
  STELLAR_RPC_URL: url.refine((v) => !STELLAR_MAINNET_HOSTS.has(hostOf(v)), {
    message: "is a Stellar mainnet endpoint (INV-07: testnet only)",
  }),
  STELLAR_HORIZON_URL: url.refine((v) => !STELLAR_MAINNET_HOSTS.has(hostOf(v)), {
    message: "is a Stellar mainnet endpoint (INV-07: testnet only)",
  }),
  STELLAR_NETWORK_PASSPHRASE: z.literal(Networks.TESTNET, {
    message: "must be the Stellar testnet passphrase (INV-07: testnet only)",
  }),
  TREASURY_SECRET: z
    .string()
    .refine((v) => StrKey.isValidEd25519SecretSeed(v), { message: "must be an S… secret seed" }),
  HODLE_SANDBOX_BASE_URL: url.refine((v) => HODLE_SANDBOX_HOST.test(hostOf(v)), {
    message: "must be the Hodle sandbox host only (INV-07: sandbox host only)",
  }),
  HODLE_SANDBOX_API_KEY: z.string().superRefine((v, ctx) => {
    if (v.startsWith("hodle_live_")) {
      ctx.addIssue({ code: "custom", message: "hodle_live_ keys are refused (INV-07: sandbox only)" });
    } else if (!/^hodle_test_[0-9a-f]{64}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "must be a hodle_test_ sandbox key" });
    }
  }),
  HODLE_WEBHOOK_SECRETS: z.string().transform((v, ctx) => {
    try {
      const parsed: unknown = JSON.parse(v);
      const map = z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)).safeParse(parsed);
      if (map.success) return map.data;
    } catch {
      // falls through to the issue below
    }
    ctx.addIssue({ code: "custom", message: "must be a JSON object mapping each Hodle event to its 64-hex secret" });
    return z.NEVER;
  }),
  PIER_API_URL: url,
  PIER_API_KEY: z.string().min(1, { message: "must not be empty" }),
  PIER_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9+/=]+$/, { message: "must be a whsec_… Standard Webhooks secret" }),
  PIER_NETWORK: z.literal("testnet", { message: "must be testnet (INV-07: testnet only)" }),
  PIER_SUBSCRIPTION_ID: z.uuid({ message: "must be a Pier subscription id (UUID)" }),
  BASE_SEPOLIA_RPC_URL: url,
  BASE_CHAIN_ID: z.literal(String(BASE_SEPOLIA_CHAIN_ID), {
    message: `must be ${BASE_SEPOLIA_CHAIN_ID} (Base Sepolia; INV-07)`,
  }),
  EVM_TEST_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, { message: "must be a 0x-prefixed 32-byte hex key" }),
  IRIS_API_URL: url.refine((v) => hostOf(v) === IRIS_SANDBOX_HOST, {
    message: `must be Circle's Iris sandbox (${IRIS_SANDBOX_HOST}; INV-07)`,
  }),
  PUBLIC_BASE_URL: url,
  TREASURY_ACCOUNT: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), { message: "must be a G… account" }),
  FUNDING_ASSETS: z
    .string()
    .transform((v) =>
      v
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().regex(/^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/), {
          message: "must be a comma list of CODE:ISSUER",
        })
        .min(1),
    ),
  QUOTE_RATE_BRL_PER_USD: z.string().regex(/^\d+(\.\d{1,6})?$/, { message: "must be a decimal rate (BRL per USD)" }),
  FEE_MODEL: z.enum(["sandbox", "hodle-default"], { message: "must be sandbox or hodle-default" }),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(30).max(3600, { message: "must be 30–3600 seconds" }),
  API_PORT: z.coerce.number().int().min(1).max(65535, { message: "must be a TCP port" }),
  FLOAT_MIN_USD: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, { message: "must be a USD amount like 10 or 2.5" }),
  EXIT_ROUTER_CONTRACT_ID: z.string().regex(/^C[A-Z2-7]{55}$/, { message: "must be a C… contract id" }),
  CCTP_CAP_USD: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, { message: "must be a USD amount like 1" }),
  FLOAT_TARGET_USD: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, { message: "must be a USD amount like 25" }),
  INTEGRATOR_KEY_PEPPER: z.string().min(32, { message: "must be at least 32 characters" }),
  WEB_AUTH_SIGNING_SECRET: z
    .string()
    .regex(/^S[A-Z2-7]{55}$/, { message: "must be an S… secret (the SEP-10 server key)" }),
  JWT_SECRET: z.string().regex(/^[0-9a-f]{64}$/, { message: "must be 64 hex characters" }),
  DEFINDEX_API_KEY: z.string().min(16, { message: "must be a DeFindex API key" }),
  DEFINDEX_BASE_URL: url,
  ETHERFUSE_API_KEY: z.string().min(16, { message: "must be an Etherfuse API key" }),
  ETHERFUSE_BASE_URL: url.refine((v) => hostOf(v) === ETHERFUSE_SANDBOX_HOST, {
    message: `must be Etherfuse's sandbox (${ETHERFUSE_SANDBOX_HOST}; INV-07)`,
  }),
} as const;

type Key = keyof typeof schemas;
type Out<K extends Key> = z.output<(typeof schemas)[K]>;
type Env = Record<string, string | undefined>;

/** Validates the listed keys; missing optional keys come back `undefined`. Collects every issue before throwing. */
function read<R extends Key, O extends Key>(env: Env, required: readonly R[], optional: readonly O[]) {
  const issues: ConfigIssue[] = [];
  const values: Record<string, unknown> = {};
  const check = (key: Key, isRequired: boolean) => {
    const raw = env[key]?.trim();
    if (!raw) {
      if (isRequired) issues.push({ key, message: "is required" });
      return;
    }
    const res = schemas[key].safeParse(raw);
    if (res.success) values[key] = res.data;
    else issues.push({ key, message: res.error.issues[0]?.message ?? "is invalid" });
  };
  for (const k of required) check(k, true);
  for (const k of optional) check(k, false);
  if (issues.length > 0) throw new ConfigError(issues);
  return values as { [K in R]: Out<K> } & { [K in O]?: Out<K> };
}

/** Testnet funding assets accepted by default (DEC-006): Circle's testnet USDC (CCTP) and Blend's (DeFindex vault). */
export const DEFAULT_FUNDING_ASSETS = [
  "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
];

export interface ApiConfig {
  databaseUrl: string;
  port: number;
  treasuryAccount: string;
  fundingAssets: string[];
  pricing: { rateBrlPerUsd: string; feeModel: "sandbox" | "hodle-default"; quoteTtlSeconds: number };
  stellar: { rpcUrl: string; horizonUrl: string; networkPassphrase: string };
  hodle: { webhookSecrets: Record<string, string> };
  pier: { network: "testnet"; webhookSecret?: string; subscriptionId?: string };
  publicBaseUrl?: string;
  integratorKeyPepper: string;
  /** The deployed exit router (DEC-031); without it the mini app offers only the classic route. */
  exitRouterId?: string;
  /** Mini-app login (SEP-10, DEC-011): present only when PUBLIC_BASE_URL, the signing key and the JWT secret are set. */
  webAuth?: { homeDomain: string; signingSecret: string; jwtSecret: string };
  /** DeFindex's API, for vault yields (T-026); without it yields show as unknown. */
  defindex?: { baseUrl: string; apiKey: string };
  /** Etherfuse's sandbox, for adding money by Pix (T-026); without it the app doesn't offer it. */
  etherfuse?: { baseUrl: string; apiKey: string };
}

export interface WorkerConfig {
  databaseUrl: string;
  stellar: { rpcUrl: string; horizonUrl: string; networkPassphrase: string; treasurySecret: string };
  hodle: { baseUrl: string; apiKey: string; webhookSecrets: Record<string, string> };
  pier: { apiUrl: string; apiKey: string; network: "testnet"; webhookSecret?: string; subscriptionId?: string };
  base: { rpcUrl: string; chainId: typeof BASE_SEPOLIA_CHAIN_ID; evmPrivateKey: `0x${string}` };
  iris: { apiUrl: string };
  /** The payout float's policy in USD micros (§3.7): FloatLow below `min`, refill up to `target` (T-015, T-016). */
  float: { minMicros: bigint; targetMicros: bigint };
  /** Each refill bridges at most `capMicros` USDC (T-016). */
  refill: { capMicros: bigint };
  /** The sandbox's BRL per USD rate; a refill only settles a deposit priced at it (T-016). */
  pricing: { rateBrlPerUsd: string };
  publicBaseUrl?: string;
}

const COMMON_OPTIONAL = [
  "STELLAR_NETWORK_PASSPHRASE",
  "PIER_NETWORK",
  "PIER_WEBHOOK_SECRET",
  "PIER_SUBSCRIPTION_ID",
  "PUBLIC_BASE_URL",
] as const;

export function loadApiConfig(env: Env = process.env): ApiConfig {
  const v = read(
    env,
    [
      "DATABASE_URL",
      "STELLAR_RPC_URL",
      "STELLAR_HORIZON_URL",
      "HODLE_WEBHOOK_SECRETS",
      "INTEGRATOR_KEY_PEPPER",
      "TREASURY_ACCOUNT",
    ],
    [
      ...COMMON_OPTIONAL,
      "FUNDING_ASSETS",
      "QUOTE_RATE_BRL_PER_USD",
      "FEE_MODEL",
      "QUOTE_TTL_SECONDS",
      "API_PORT",
      "EXIT_ROUTER_CONTRACT_ID",
      "WEB_AUTH_SIGNING_SECRET",
      "JWT_SECRET",
      "DEFINDEX_API_KEY",
      "DEFINDEX_BASE_URL",
      "ETHERFUSE_API_KEY",
      "ETHERFUSE_BASE_URL",
    ],
  );
  return {
    databaseUrl: v.DATABASE_URL,
    port: v.API_PORT ?? 3100,
    ...(v.DEFINDEX_API_KEY
      ? { defindex: { baseUrl: v.DEFINDEX_BASE_URL ?? "https://api.defindex.io", apiKey: v.DEFINDEX_API_KEY } }
      : {}),
    ...(v.ETHERFUSE_API_KEY
      ? {
          etherfuse: {
            baseUrl: v.ETHERFUSE_BASE_URL ?? `https://${ETHERFUSE_SANDBOX_HOST}`,
            apiKey: v.ETHERFUSE_API_KEY,
          },
        }
      : {}),
    treasuryAccount: v.TREASURY_ACCOUNT,
    fundingAssets: v.FUNDING_ASSETS ?? DEFAULT_FUNDING_ASSETS,
    pricing: {
      rateBrlPerUsd: v.QUOTE_RATE_BRL_PER_USD ?? "5.4",
      feeModel: v.FEE_MODEL ?? "sandbox",
      quoteTtlSeconds: v.QUOTE_TTL_SECONDS ?? 120,
    },
    stellar: { rpcUrl: v.STELLAR_RPC_URL, horizonUrl: v.STELLAR_HORIZON_URL, networkPassphrase: Networks.TESTNET },
    hodle: { webhookSecrets: v.HODLE_WEBHOOK_SECRETS },
    pier: {
      network: "testnet",
      ...(v.PIER_WEBHOOK_SECRET ? { webhookSecret: v.PIER_WEBHOOK_SECRET } : {}),
      ...(v.PIER_SUBSCRIPTION_ID ? { subscriptionId: v.PIER_SUBSCRIPTION_ID } : {}),
    },
    ...(v.PUBLIC_BASE_URL ? { publicBaseUrl: v.PUBLIC_BASE_URL } : {}),
    integratorKeyPepper: v.INTEGRATOR_KEY_PEPPER,
    ...(v.EXIT_ROUTER_CONTRACT_ID ? { exitRouterId: v.EXIT_ROUTER_CONTRACT_ID } : {}),
    ...(v.PUBLIC_BASE_URL && v.WEB_AUTH_SIGNING_SECRET && v.JWT_SECRET
      ? {
          webAuth: {
            homeDomain: new URL(v.PUBLIC_BASE_URL).host,
            signingSecret: v.WEB_AUTH_SIGNING_SECRET,
            jwtSecret: v.JWT_SECRET,
          },
        }
      : {}),
  };
}

export function loadWorkerConfig(env: Env = process.env): WorkerConfig {
  const v = read(
    env,
    [
      "DATABASE_URL",
      "STELLAR_RPC_URL",
      "STELLAR_HORIZON_URL",
      "TREASURY_SECRET",
      "HODLE_SANDBOX_BASE_URL",
      "HODLE_SANDBOX_API_KEY",
      "HODLE_WEBHOOK_SECRETS",
      "PIER_API_URL",
      "PIER_API_KEY",
      "BASE_SEPOLIA_RPC_URL",
      "EVM_TEST_PRIVATE_KEY",
      "IRIS_API_URL",
    ],
    [
      ...COMMON_OPTIONAL,
      "BASE_CHAIN_ID",
      "FLOAT_MIN_USD",
      "FLOAT_TARGET_USD",
      "CCTP_CAP_USD",
      "QUOTE_RATE_BRL_PER_USD",
    ],
  );
  const float = { minMicros: usdMicros(v.FLOAT_MIN_USD ?? "10"), targetMicros: usdMicros(v.FLOAT_TARGET_USD ?? "25") };
  if (float.targetMicros < float.minMicros) {
    throw new ConfigError([{ key: "FLOAT_TARGET_USD", message: "must be at least FLOAT_MIN_USD" }]);
  }
  return {
    databaseUrl: v.DATABASE_URL,
    stellar: {
      rpcUrl: v.STELLAR_RPC_URL,
      horizonUrl: v.STELLAR_HORIZON_URL,
      networkPassphrase: Networks.TESTNET,
      treasurySecret: v.TREASURY_SECRET,
    },
    hodle: {
      baseUrl: v.HODLE_SANDBOX_BASE_URL,
      apiKey: v.HODLE_SANDBOX_API_KEY,
      webhookSecrets: v.HODLE_WEBHOOK_SECRETS,
    },
    pier: {
      apiUrl: v.PIER_API_URL,
      apiKey: v.PIER_API_KEY,
      network: "testnet",
      ...(v.PIER_WEBHOOK_SECRET ? { webhookSecret: v.PIER_WEBHOOK_SECRET } : {}),
      ...(v.PIER_SUBSCRIPTION_ID ? { subscriptionId: v.PIER_SUBSCRIPTION_ID } : {}),
    },
    base: {
      rpcUrl: v.BASE_SEPOLIA_RPC_URL,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      evmPrivateKey: v.EVM_TEST_PRIVATE_KEY as `0x${string}`,
    },
    iris: { apiUrl: v.IRIS_API_URL },
    float,
    refill: { capMicros: usdMicros(v.CCTP_CAP_USD ?? "1") },
    pricing: { rateBrlPerUsd: v.QUOTE_RATE_BRL_PER_USD ?? "5.4" },
    ...(v.PUBLIC_BASE_URL ? { publicBaseUrl: v.PUBLIC_BASE_URL } : {}),
  };
}

/** "2.5" → 2_500_000n (validated by the schema first). */
function usdMicros(usd: string): bigint {
  const [whole = "0", frac = ""] = usd.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

export interface PierSetupConfig {
  treasurySecret: string;
  pier: { apiUrl: string; apiKey: string; subscriptionId?: string };
  publicBaseUrl?: string;
}

/** Just what `pnpm pier:setup` needs to create the treasury subscription (T-008). */
export function loadPierSetupConfig(env: Env = process.env): PierSetupConfig {
  const v = read(
    env,
    ["TREASURY_SECRET", "PIER_API_URL", "PIER_API_KEY"],
    ["PIER_SUBSCRIPTION_ID", "PIER_NETWORK", "PUBLIC_BASE_URL"],
  );
  return {
    treasurySecret: v.TREASURY_SECRET,
    pier: {
      apiUrl: v.PIER_API_URL,
      apiKey: v.PIER_API_KEY,
      ...(v.PIER_SUBSCRIPTION_ID ? { subscriptionId: v.PIER_SUBSCRIPTION_ID } : {}),
    },
    ...(v.PUBLIC_BASE_URL ? { publicBaseUrl: v.PUBLIC_BASE_URL } : {}),
  };
}

export interface PierPullConfig {
  databaseUrl: string;
  pier: { apiUrl: string; apiKey: string; subscriptionId: string };
}

/** Just what `pnpm pier:pull` needs to run one reconciliation pass (T-008). */
export function loadPierPullConfig(env: Env = process.env): PierPullConfig {
  const v = read(env, ["DATABASE_URL", "PIER_API_URL", "PIER_API_KEY", "PIER_SUBSCRIPTION_ID"], ["PIER_NETWORK"]);
  return {
    databaseUrl: v.DATABASE_URL,
    pier: { apiUrl: v.PIER_API_URL, apiKey: v.PIER_API_KEY, subscriptionId: v.PIER_SUBSCRIPTION_ID },
  };
}
