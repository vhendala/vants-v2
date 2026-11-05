// Dev-only preview (`vite` → /preview.html): the real app over testnet-shaped fixtures, with a signed-in session and the
// API mocked in the page, so every screen can be seen and screenshotted without a wallet. `?signedout` shows the welcome
// screen; `?empty` an account with nothing in it. Never part of the build (index.html is the only entry).
import type { ExitView, Portfolio, Priced } from "./api.ts";

const params = new URLSearchParams(location.search);
const ACCOUNT = "GCYGHQHGHVQALH4TFUA4EZKQXZQAJ2PFSOXOVVH7UTT6ZNM4BQMVPLOP";
const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BLEND = "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
const exitStep = { steps: 1, slippageBps: 0, estimated: false };

const portfolio: Portfolio = {
  account: ACCOUNT,
  funded: true,
  rate: "5.4",
  totalUsd: params.has("empty") ? "0" : "587.61",
  positions: params.has("empty")
    ? []
    : [
        {
          id: `defindex:${VAULT}`,
          kind: "defindex",
          asset: BLEND,
          vault: VAULT,
          shares: "96.2962962",
          amount: "96.2962962",
          valueUsd: "96.30",
          pricing: "par",
          payable: true,
          exit: { ...exitStep, steps: 2 },
        },
        {
          id: `classic:${BLEND}`,
          kind: "classic",
          asset: BLEND,
          amount: "20",
          valueUsd: "20.00",
          pricing: "par",
          payable: true,
          exit: exitStep,
        },
        {
          id: `classic:${CIRCLE}`,
          kind: "classic",
          asset: CIRCLE,
          amount: "50",
          valueUsd: "50.00",
          pricing: "par",
          payable: true,
          exit: exitStep,
        },
        {
          id: "defindex:CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ",
          kind: "defindex",
          asset: "native",
          vault: "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ",
          shares: "180",
          amount: "198",
          valueUsd: "49.50",
          payableUsd: "48.01",
          unyield: true,
          pricing: "estimated",
          payable: true,
          exit: { steps: 3, slippageBps: 100, estimated: true },
        },
        {
          id: "classic:TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4",
          kind: "classic",
          asset: "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4",
          amount: "256.98",
          valueUsd: "59.31",
          pricing: "estimated",
          payable: true,
          exit: { steps: 2, slippageBps: 100, estimated: true },
        },
        {
          id: "classic:native",
          kind: "classic",
          asset: "native",
          amount: "1250",
          valueUsd: "312.50",
          pricing: "estimated",
          payable: true,
          exit: { steps: 2, slippageBps: 100, estimated: true },
        },
        {
          id: "classic:USDC:GCLSQU55",
          kind: "classic",
          asset: "USDC:GCLSQU55UGBZQITOD4JFGEMIFAA",
          amount: "1000.09",
          valueUsd: null,
          pricing: "unpriced",
          payable: false,
          exit: exitStep,
        },
      ],
};

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const view = (
  id: string,
  minutesAgo: number,
  amountBrl: string,
  status: ExitView["payment"]["status"],
  name: string,
): ExitView => ({
  id,
  route: "router",
  status: "submitted",
  createdAt: iso(minutesAgo),
  picks: [
    { id: `defindex:${VAULT}`, amount: "74.0740741" },
    { id: "classic:native", amount: "37.0370371" },
  ],
  transaction: {
    hash: "e22bf4c6c51dda9cff8aa1f8836b865a2481d36c35e6750715c2a8d324c35c83",
    maxTime: 0,
    summary: [
      "Resgatar 96,2962962 dólares digitais do seu Dólar que rende",
      "Trocar até 70,1234567 lumens por 14,814815 dólares digitais",
      "Enviar 111,1111112 dólares digitais para a Vants pagar o Pix",
    ],
  },
  payment: {
    id: `pay_${id.slice(4)}`,
    status,
    quote: {
      destination: { type: "br_code", payee: { name, city: "SAO PAULO" } },
      amountBrl,
      feeBrl: "0.00",
      asset: BLEND,
      assetAmount: "111.1111112",
      rate: "5.4",
    },
    funding: {
      txHash: "e22bf4c6c51dda9cff8aa1f8836b865a2481d36c35e6750715c2a8d324c35c83",
      ledgerClosedAt: iso(minutesAgo),
      amount: "111.1111112",
    },
    payout: status === "completed" ? { endToEndId: "SANDBOXB0612B240DE644BDB0264F02F", txHash: "0x2552" } : null,
    refunds:
      status === "refunded"
        ? [{ amount: "3.7037038", reason: "payout_failed", status: "sent", txHash: "7c8f8cf7a1b2" }]
        : [],
    timeline: [
      { status: "awaiting_deposit", at: iso(minutesAgo) },
      { status: "funded", at: iso(minutesAgo - 0.1) },
      { status: "paying", at: iso(minutesAgo - 0.12) },
      ...(status === "completed" ? [{ status: "completed", at: iso(minutesAgo - 0.2) }] : []),
    ],
  },
});
const keyExit: ExitView = {
  ...view("ext_aaaaaaaaaaaaaaaaaaa5", 60 * 3, "150.00", "completed", ""),
  picks: [{ id: `classic:${CIRCLE}`, amount: "27.7777778" }],
};
keyExit.payment = {
  ...keyExit.payment,
  quote: {
    ...keyExit.payment.quote,
    destination: { type: "pix_key", key: "maria.souza@exemplo.com.br", keyType: "EMAIL" },
    amountBrl: "150.00",
    assetAmount: "27.7777778",
    asset: CIRCLE,
  },
};
const exits: ExitView[] = [
  view("ext_aaaaaaaaaaaaaaaaaaa1", 2, "600.00", "paying", "PADARIA SAO JORGE"),
  view("ext_aaaaaaaaaaaaaaaaaaa2", 40, "20.00", "completed", "VANTS TESTE"),
  keyExit,
  view("ext_aaaaaaaaaaaaaaaaaaa3", 60 * 26, "45.90", "completed", "MERCADO BOM PRECO"),
  view("ext_aaaaaaaaaaaaaaaaaaa4", 60 * 50, "12.50", "refunded", "CAFE DO PONTO"),
];

const priced: Priced = {
  amountBrl: "600.00",
  feeBrl: "0.00",
  rate: "5.4",
  payee: { name: "PADARIA SAO JORGE", city: "SAO PAULO" },
  assets: [
    { asset: CIRCLE, assetAmount: "111.1111112" },
    { asset: BLEND, assetAmount: "111.1111112" },
  ],
  portfolio,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const XLM_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
const soon = () => Math.floor(Date.now() / 1000) + 290;
const vaults = [
  {
    id: VAULT,
    name: "Dólar que rende",
    asset: BLEND,
    unit: "USDC",
    apyPercent: 8,
    invested: params.has("empty") ? "0" : "96.2962962",
    canInvest: params.has("empty") ? "0" : "20",
  },
  {
    id: XLM_VAULT,
    name: "Lumens que rendem",
    asset: "native",
    unit: "XLM",
    apyPercent: 10.66,
    invested: "0",
    canInvest: params.has("empty") ? "0" : "1248",
  },
];
const rampOrder = (status: string, minutesAgo: number) => ({
  id: `ord-${status}`,
  target: "USDC",
  amountBrl: "100.00",
  receive: "19.7500000",
  feeBrl: "0.20",
  status,
  pixCode:
    "00020101021226870014br.gov.bcb.pix2565pix.example.com/qr/v2/cobv/9d36b84f-c70b-478f-b95c-12729b90ca255204000053039865406100.005802BR5909ETHERFUSE6009SAO PAULO62070503***6304B8E1",
  deliveredTx: null,
  createdAt: iso(minutesAgo),
  updatedAt: iso(minutesAgo),
});

/** Atividade's other movements (T-033): investing, Tesouro, accepting an asset, money added by Pix. */
const action = (
  id: string,
  minutesAgo: number,
  kind: "invest" | "redeem" | "trade" | "trustline",
  status: "submitted" | "done" | "failed",
  detail: Record<string, string>,
  vault: { id: string; asset: string; name: string } | null,
) => ({ id, kind, status, detail, vault, createdAt: iso(minutesAgo), transaction: { hash: "ab12", summary: [] } });
const USDC_VAULT_V = { id: VAULT, asset: BLEND, name: "Dólar que rende" };
const XLM_VAULT_V = {
  id: "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ",
  asset: "native",
  name: "Lumens que rendem",
};
const activity = () => {
  const items = [
    ...exits.map((e) => ({ type: "payment", id: e.id, createdAt: e.createdAt, exit: e })),
    ...[
      action("act_1", 5, "invest", "submitted", { vault: VAULT, amount: "25" }, USDC_VAULT_V),
      action("act_2", 30, "invest", "done", { vault: VAULT, amount: "12.5" }, USDC_VAULT_V),
      action("act_3", 60 * 3, "trade", "done", { side: "buy", amountBrl: "50.00" }, null),
      action("act_4", 60 * 3 + 2, "trustline", "done", { asset: "TESOURO:GC3CW7" }, null),
      action("act_5", 60 * 27, "redeem", "done", { vault: XLM_VAULT_V.id, amount: "30" }, XLM_VAULT_V),
      action("act_6", 60 * 49, "trade", "failed", { side: "sell" }, null),
    ].map((a) => ({ type: "action", id: a.id, createdAt: a.createdAt, action: a })),
    ...[{ ...rampOrder("funded", 10), id: "ord-funded" }, rampOrder("completed", 60 * 20)].map((o) => ({
      type: "deposit",
      id: o.id,
      createdAt: o.createdAt,
      order: o,
    })),
  ];
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

// Flows can be followed to their end (T-035): the wallet "signs" by returning the transaction as it is.
// `?slow` (T-042): the wallet takes 3 s to come back, as when a person reads before confirming.
(window as Window & { __vantsPreviewSign?: (x: string) => Promise<string> }).__vantsPreviewSign = async (x) => {
  if (params.has("slow")) await new Promise((r) => setTimeout(r, 3000));
  return x;
};
/** `?completes`: the payment in flight is paid 2.5 s after the receipt first asks, so the success moment can be seen. */
const firstLook = new Map<string, number>();

const real = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const method = init?.method ?? "GET";
  // `?slow`: every call takes 4 s (or `?slow=8`: 8 s), like testnet on a bad day (T-040, T-042); following an action's status stays quick, and
  // the action is recorded 12 s after it is first followed, so every wait can be seen.
  const following = url.pathname.startsWith("/app/actions/") && method === "GET";
  const slow = params.has("slow") && !following;
  // `?slow=8` makes it 8 s, long enough to see the "still working" words.
  await new Promise((r) => setTimeout(r, slow ? (Number(params.get("slow")) || 4) * 1000 : 250));
  if (url.pathname === "/app/portfolio") return json(portfolio);
  if (url.pathname === "/app/limits") return json({ maxBrl: "970.00" });
  if (url.pathname === "/app/exits/quote") {
    const d = JSON.parse(String(init?.body ?? "{}")).destination;
    return json(
      d?.type === "pix_key"
        ? {
            ...priced,
            payee: undefined,
            pixKey: d.key,
            pixKeyType: d.keyType,
            amountBrl: d.amountBrl,
            assets: priced.assets.map((a) => ({ ...a, assetAmount: (Number(d.amountBrl) / 5.4).toFixed(7) })),
          }
        : priced,
    );
  }
  if (url.pathname === "/app/activity")
    return json({ items: params.has("empty") ? [] : activity(), next: null, month: { paidBrl: "665.90", count: 3 } });
  if (url.pathname === "/app/exits" && method === "GET")
    return json({
      items: params.has("empty") ? [] : exits.slice(0, Number(url.searchParams.get("limit") ?? 20)),
      next: null,
      month: { paidBrl: "665.90", count: 3 },
    });
  if (url.pathname === "/app/exits" && method === "POST")
    return json(
      {
        id: "ext_aaaaaaaaaaaaaaaaaaa1",
        paymentId: "pay_aaaaaaaaaaaaaaaaaaa1",
        route: "router",
        amountBrl: "600.00",
        asset: BLEND,
        assetAmount: "111.1111112",
        transaction: {
          xdr: "AAAA",
          hash: "e22b",
          maxTime: Math.floor(Date.now() / 1000) + 290,
          summary: exits[0]?.transaction.summary,
        },
      },
      201,
    );
  if (url.pathname === "/app/invest" && method === "GET")
    return json({
      vaults,
      rate: "5.4",
      tesouro: {
        asset: "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4",
        held: params.has("empty") ? "0" : "256.98",
        valueUsd: params.has("empty") ? "0" : "59.31",
        trusted: !params.has("empty"),
        canBuyUsd: "312.50",
      },
    });
  if (url.pathname === "/app/tesouro" && method === "POST") {
    const b = JSON.parse(String(init?.body ?? "{}"));
    return json(
      {
        id: "act_preview",
        kind: "trade",
        transaction: {
          xdr: "AAAA",
          hash: "ab13",
          maxTime: soon(),
          summary:
            b.side === "buy"
              ? ["Comprar 80,2 unidades de Tesouro com até 74,6 lumens", "O Tesouro rende em reais, todo dia"]
              : [
                  "Vender 80,2 unidades de Tesouro por pelo menos 18,3 dólares digitais",
                  "O valor volta para o seu saldo",
                ],
        },
      },
      201,
    );
  }
  if ((url.pathname === "/app/invest" || url.pathname === "/app/redeem") && method === "POST") {
    const b = JSON.parse(String(init?.body ?? "{}"));
    const v = vaults.find((x) => x.id === b.vault);
    const word = v?.unit === "XLM" ? "lumens" : "dólares digitais";
    return json(
      {
        id: "act_preview",
        kind: url.pathname.endsWith("invest") ? "invest" : "redeem",
        transaction: {
          xdr: "AAAA",
          hash: "ab12",
          maxTime: soon(),
          summary: url.pathname.endsWith("invest")
            ? [`Investir ${String(b.amount).replace(".", ",")} ${word} em ${v?.name}`, "O rendimento começa na hora"]
            : [
                `Resgatar ${String(b.amount).replace(".", ",")} ${word} de ${v?.name}`,
                "O valor volta para o seu saldo",
              ],
        },
      },
      201,
    );
  }
  if (url.pathname.startsWith("/app/actions/")) {
    if (following && params.has("slow")) {
      if (!firstLook.has(url.pathname)) firstLook.set(url.pathname, Date.now());
      if (Date.now() - (firstLook.get(url.pathname) ?? 0) < 12_000) return json({ status: "submitted" });
    }
    return json({ status: "done" });
  }
  if (url.pathname === "/app/ramp")
    return json({
      available: true,
      sandbox: true,
      profile: params.has("profile") ? { displayName: "Ana Teste", email: "ana.teste@exemplo.com.br" } : null,
      targets: ["USDC", "TESOURO"],
      orders: params.has("empty") ? [] : [rampOrder("completed", 60 * 20)],
    });
  if (url.pathname === "/app/ramp/quote") {
    if (!params.has("profile")) return json({ error: { code: "PROFILE_REQUIRED", message: "profile" } }, 409);
    const b = JSON.parse(String(init?.body ?? "{}"));
    return json({
      quoteId: "4f9a0d8e-0000-4000-8000-000000000001",
      target: b.target,
      amountBrl: b.amountBrl,
      receive: (Number(b.amountBrl) * (b.target === "TESOURO" ? 0.8566 : 0.1975)).toFixed(7),
      feeBrl: (Number(b.amountBrl) * 0.002).toFixed(2),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      needsTrustline: b.target === "TESOURO",
    });
  }
  if (url.pathname === "/app/ramp/profile")
    return json({ displayName: "Ana Teste", email: "ana.teste@exemplo.com.br" });
  if (url.pathname === "/app/ramp/trustline")
    return json(
      {
        id: "act_trust",
        kind: "trustline",
        transaction: {
          xdr: "AAAA",
          hash: "cd34",
          maxTime: soon(),
          summary: ["Permitir que sua carteira receba Tesouro", "Uma vez só: meio lumen fica reservado na carteira"],
        },
      },
      201,
    );
  if (url.pathname === "/app/ramp/orders") return json(rampOrder("created", 0), 201);
  if (url.pathname.endsWith("/simulate-payment")) return json({ status: "paid" }, 202);
  if (url.pathname.startsWith("/app/ramp/orders/")) {
    // `?completes`: the money lands 2.5 s after the order is first followed (T-035).
    if (!firstLook.has(url.pathname)) firstLook.set(url.pathname, Date.now());
    if (params.has("completes") && Date.now() - (firstLook.get(url.pathname) ?? 0) > 2500)
      return json(rampOrder("completed", 0));
    return json(rampOrder(params.has("funded") || params.has("completes") ? "funded" : "created", 0));
  }
  if (/^\/app\/exits\/ext_\w+\/submit$/.test(url.pathname)) return json({ status: "submitted", txHash: "ab12" }, 202);
  const one = /^\/app\/exits\/(ext_\w+)$/.exec(url.pathname)?.[1];
  if (one) {
    if (!firstLook.has(one)) firstLook.set(one, Date.now());
    if (params.has("completes") && one === "ext_aaaaaaaaaaaaaaaaaaa1" && Date.now() - (firstLook.get(one) ?? 0) > 2500)
      return json(view(one, 2, "600.00", "completed", "PADARIA SAO JORGE"));
    return json(exits.find((e) => e.id === one) ?? exits[1]);
  }
  return real(input, init);
};

// Every scenario shares one account: start each load without the balances the last one saved (T-040), unless ?cached asks
// to see the device's copy shown first.
if (!params.has("cached"))
  for (const k of Object.keys(localStorage)) if (k.startsWith("vants.cache.")) localStorage.removeItem(k);

const claims = btoa(JSON.stringify({ sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }));
if (params.has("signedout")) localStorage.removeItem("vants.session");
else
  localStorage.setItem(
    "vants.session",
    JSON.stringify({ account: ACCOUNT, token: `h.${claims}.s`, expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400 }),
  );

await import("./main.tsx");
