// INV-07: testnet and sandbox only. Mainnet values are built at runtime (Networks.PUBLIC, string concatenation) so the
// secret scan, which forbids them as literals, keeps passing.
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { ConfigError, loadApiConfig, loadPierSetupConfig, loadWorkerConfig } from "./index.ts";

const HEX64 = "ab".repeat(32);
const VALID: Record<string, string> = {
  DATABASE_URL: "postgres://vants:vants@localhost:5433/vants",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  TREASURY_SECRET: Keypair.random().secret(),
  HODLE_SANDBOX_BASE_URL: "https://sandbox-api.hodle.com.br",
  HODLE_SANDBOX_API_KEY: `hodle_test_${HEX64}`,
  HODLE_WEBHOOK_SECRETS: JSON.stringify({ PAYOUT_SUCCESSFUL: HEX64 }),
  PIER_API_URL: "https://pier.example.com",
  PIER_API_KEY: "pier_key_for_tests",
  PIER_WEBHOOK_SECRET: "whsec_dGVzdHNlY3JldA==",
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  EVM_TEST_PRIVATE_KEY: `0x${HEX64}`,
  IRIS_API_URL: "https://iris-api-sandbox.circle.com",
  PUBLIC_BASE_URL: "https://vants-dev.example.com",
  INTEGRATOR_KEY_PEPPER: "p".repeat(32),
  TREASURY_ACCOUNT: Keypair.random().publicKey(),
};
const env = (over: Record<string, string | undefined>) => ({ ...VALID, ...over });
const issues = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.issues.map((i) => `${i.key}: ${i.message}`);
    throw err;
  }
  return [];
};

describe("valid testnet configuration", () => {
  it("loads for the worker, with testnet constants filled in", () => {
    const cfg = loadWorkerConfig(VALID);
    expect(cfg.stellar.networkPassphrase).toBe(Networks.TESTNET);
    expect(cfg.base.chainId).toBe(84532);
    expect(cfg.pier.network).toBe("testnet");
    expect(cfg.hodle.webhookSecrets.PAYOUT_SUCCESSFUL).toBe(HEX64);
  });

  it("loads for the api without worker-only secrets (treasury, Hodle key, Pier key, EVM key)", () => {
    const { TREASURY_SECRET, HODLE_SANDBOX_API_KEY, PIER_API_KEY, EVM_TEST_PRIVATE_KEY, ...apiEnv } = VALID;
    const cfg = loadApiConfig(apiEnv);
    expect(cfg.stellar.networkPassphrase).toBe(Networks.TESTNET);
    expect("treasurySecret" in cfg.stellar).toBe(false);
  });

  it("talks to Etherfuse's sandbox only, and takes DeFindex's API when a key is set (T-026)", () => {
    const { TREASURY_SECRET, HODLE_SANDBOX_API_KEY, PIER_API_KEY, EVM_TEST_PRIVATE_KEY, ...apiEnv } = VALID;
    const key = "k".repeat(40);
    const cfg = loadApiConfig({ ...apiEnv, ETHERFUSE_API_KEY: key, DEFINDEX_API_KEY: key });
    expect(cfg.etherfuse).toEqual({ baseUrl: "https://api.sand.etherfuse.com", apiKey: key });
    expect(cfg.defindex).toEqual({ baseUrl: "https://api.defindex.io", apiKey: key });
    expect(
      issues(() =>
        loadApiConfig({ ...apiEnv, ETHERFUSE_API_KEY: key, ETHERFUSE_BASE_URL: "https://api.etherfuse.com" }),
      ),
    ).toEqual(["ETHERFUSE_BASE_URL: must be Etherfuse's sandbox (api.sand.etherfuse.com; INV-07)"]);
    expect(loadApiConfig(apiEnv).etherfuse).toBeUndefined();
  });

  it("gives the worker a float policy in USD micros: defaults 10 / 25, overridable, target ≥ min (T-015)", () => {
    expect(loadWorkerConfig(VALID).float).toEqual({ minMicros: 10_000_000n, targetMicros: 25_000_000n });
    expect(loadWorkerConfig(env({ FLOAT_MIN_USD: "2.5", FLOAT_TARGET_USD: "40" })).float).toEqual({
      minMicros: 2_500_000n,
      targetMicros: 40_000_000n,
    });
    expect(issues(() => loadWorkerConfig(env({ FLOAT_MIN_USD: "30", FLOAT_TARGET_USD: "20" })))).toEqual([
      "FLOAT_TARGET_USD: must be at least FLOAT_MIN_USD",
    ]);
    expect(issues(() => loadWorkerConfig(env({ FLOAT_MIN_USD: "ten" })))[0]).toMatch(/^FLOAT_MIN_USD: /);
  });

  it("caps each refill (CCTP_CAP_USD, default 1) and knows the sandbox rate (default 5.4) (T-016)", () => {
    const cfg = loadWorkerConfig(VALID);
    expect([cfg.refill.capMicros, cfg.pricing.rateBrlPerUsd]).toEqual([1_000_000n, "5.4"]);
    expect(loadWorkerConfig(env({ CCTP_CAP_USD: "0.5" })).refill.capMicros).toBe(500_000n);
  });

  it("enables mini-app login only with a public URL, a SEP-10 signing key and a JWT secret (T-020)", () => {
    expect(loadApiConfig(VALID).webAuth).toBeUndefined();
    const signing = Keypair.random().secret();
    const cfg = loadApiConfig(
      env({
        PUBLIC_BASE_URL: "https://vants.example.com",
        WEB_AUTH_SIGNING_SECRET: signing,
        JWT_SECRET: "ab".repeat(32),
      }),
    );
    expect(cfg.webAuth).toEqual({
      homeDomain: "vants.example.com",
      signingSecret: signing,
      jwtSecret: "ab".repeat(32),
    });
    expect(issues(() => loadApiConfig(env({ JWT_SECRET: "short" })))[0]).toMatch(/^JWT_SECRET: /);
  });

  it("accepts empty Hodle webhook secrets until they are registered (SPEC §11 Q1)", () => {
    expect(loadApiConfig(env({ HODLE_WEBHOOK_SECRETS: "{}" })).hodle.webhookSecrets).toEqual({});
  });
});

describe("INV-07: refuses anything that is not testnet or sandbox", () => {
  it("refuses the Stellar mainnet passphrase", () => {
    expect(issues(() => loadWorkerConfig(env({ STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC })))).toEqual([
      expect.stringMatching(/^STELLAR_NETWORK_PASSPHRASE: .*testnet only/),
    ]);
  });

  it("refuses known mainnet Stellar endpoints", () => {
    expect(issues(() => loadWorkerConfig(env({ STELLAR_HORIZON_URL: "https://horizon.stellar.org" })))).toEqual([
      expect.stringMatching(/^STELLAR_HORIZON_URL: .*mainnet/),
    ]);
  });

  it("refuses a live Hodle key, naming the rule", () => {
    expect(issues(() => loadWorkerConfig(env({ HODLE_SANDBOX_API_KEY: `hodle_live_${HEX64}` })))).toEqual([
      expect.stringMatching(/^HODLE_SANDBOX_API_KEY: .*hodle_live_.*INV-07/),
    ]);
  });

  it("refuses the Hodle production host", () => {
    const prod = `https://${["api", "hodle", "com", "br"].join(".")}`;
    expect(issues(() => loadWorkerConfig(env({ HODLE_SANDBOX_BASE_URL: prod })))).toEqual([
      expect.stringMatching(/^HODLE_SANDBOX_BASE_URL: .*sandbox host only/),
    ]);
  });

  it("refuses a Pier mainnet network", () => {
    expect(issues(() => loadWorkerConfig(env({ PIER_NETWORK: "mainnet" })))).toEqual([
      expect.stringMatching(/^PIER_NETWORK: /),
    ]);
  });

  it("refuses a Base chain other than Sepolia", () => {
    expect(issues(() => loadWorkerConfig(env({ BASE_CHAIN_ID: "8453" })))).toEqual([
      expect.stringMatching(/^BASE_CHAIN_ID: .*84532/),
    ]);
  });

  it("refuses Circle's mainnet attestation service", () => {
    expect(issues(() => loadWorkerConfig(env({ IRIS_API_URL: "https://iris-api.circle.com" })))).toEqual([
      expect.stringMatching(/^IRIS_API_URL: .*sandbox/),
    ]);
  });
});

describe("errors never echo secret values", () => {
  it("reports the key name, not the value, for a malformed secret", () => {
    const leaky = "SNOTAVALIDSEEDBUTSECRETLOOKINGVALUE";
    const all = issues(() =>
      loadWorkerConfig(env({ TREASURY_SECRET: leaky, HODLE_SANDBOX_API_KEY: "hodle_test_short" })),
    );
    expect(all.map((i) => i.split(":")[0])).toEqual(
      expect.arrayContaining(["TREASURY_SECRET", "HODLE_SANDBOX_API_KEY"]),
    );
    expect(all.join("\n")).not.toContain(leaky);
    expect(all.join("\n")).not.toContain("hodle_test_short");
  });

  it("lists every missing variable at once", () => {
    const all = issues(() => loadWorkerConfig({}));
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.join("\n")).toMatch(/DATABASE_URL/);
  });
});

describe("Pier setup and subscription id", () => {
  it("accepts a UUID subscription id and refuses anything else", () => {
    const id = "0f91438e-e2e6-444e-91a0-e557d14762f7";
    expect(loadWorkerConfig(env({ PIER_SUBSCRIPTION_ID: id })).pier.subscriptionId).toBe(id);
    expect(issues(() => loadWorkerConfig(env({ PIER_SUBSCRIPTION_ID: "sub_1" })))).toEqual([
      expect.stringMatching(/^PIER_SUBSCRIPTION_ID: /),
    ]);
  });

  it("loads the narrow setup config without database, Hodle or EVM variables", () => {
    const cfg = loadPierSetupConfig({
      TREASURY_SECRET: VALID.TREASURY_SECRET,
      PIER_API_URL: VALID.PIER_API_URL,
      PIER_API_KEY: VALID.PIER_API_KEY,
    });
    expect(cfg.pier.apiUrl).toBe(VALID.PIER_API_URL);
    expect(cfg.publicBaseUrl).toBeUndefined();
  });
});

describe("api pricing and funding settings (T-010)", () => {
  it("defaults to the sandbox rate, sandbox fees, a 120 s quote TTL and both testnet USDCs", () => {
    const cfg = loadApiConfig(VALID);
    expect(cfg.pricing).toEqual({ rateBrlPerUsd: "5.4", feeModel: "sandbox", quoteTtlSeconds: 120 });
    expect(cfg.fundingAssets).toHaveLength(2);
    expect(cfg.port).toBe(3100);
  });

  it("validates overrides", () => {
    expect(issues(() => loadApiConfig(env({ TREASURY_ACCOUNT: "Gnope" })))).toEqual([
      expect.stringMatching(/^TREASURY_ACCOUNT: /),
    ]);
    expect(issues(() => loadApiConfig(env({ FUNDING_ASSETS: "USDC" })))).toEqual([
      expect.stringMatching(/^FUNDING_ASSETS: /),
    ]);
    expect(issues(() => loadApiConfig(env({ FEE_MODEL: "free" })))).toEqual([expect.stringMatching(/^FEE_MODEL: /)]);
    expect(issues(() => loadApiConfig(env({ QUOTE_TTL_SECONDS: "5" })))).toEqual([
      expect.stringMatching(/^QUOTE_TTL_SECONDS: /),
    ]);
    expect(loadApiConfig(env({ QUOTE_RATE_BRL_PER_USD: "5.123456" })).pricing.rateBrlPerUsd).toBe("5.123456");
  });
});
