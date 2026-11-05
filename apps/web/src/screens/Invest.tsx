// Investir (T-026, reworked in the review): what's invested and what each option pays, then each option's page. Two
// DeFindex vaults (dollars, lumens) with the rate DeFindex reports today, and Tesouro: bought with reais by Pix, or (T-029)
// with the wallet's dollars or lumens on the market, and sold back the same way. Since T-041 each option opens on an
// overview and investing or taking out runs as a flow like a Pix (screens/Move.tsx).
import { useCallback, useEffect, useMemo } from "react";
import { api, type Portfolio } from "../api.ts";
import { Icon } from "../design/ds.tsx";
import { reais, units } from "../format.ts";
import { hrefOf } from "../router.ts";
import { investCache, portfolioCache, useCached } from "../store.ts";
import { AssetAvatar, Loading as Shaped, Notice, SkeletonRows, TopBar } from "../ui.tsx";
import { type Investment, inUnit, OptionPage, OverviewShape, PAST, type Unit } from "./Move.tsx";

/** The mark for the wallet's dollars (an ink "$" disc): any USDC code draws it. */
const USDC_MARK = "USDC:wallet";

const pct = (apy: number) => `${apy.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const apyText = (apy: number | null) => (apy === null ? "taxa indisponível" : `${pct(apy)} ao ano`);

/**
 * Reais per unit of a vault's asset: dollars at today's rate; lumens at the portfolio's estimate, from the vault's own
 * position first (T-034: lumens in the wallet may be gone after investing all of them), then the wallet's.
 */
function priceBrl(unit: string, rate: number, portfolio: Portfolio | null, vaultId?: string): number | null {
  if (unit === "USDC") return rate;
  const positions = portfolio?.positions ?? [];
  const xlm =
    positions.find((p) => p.kind === "defindex" && p.vault === vaultId && p.valueUsd && Number(p.amount) > 0) ??
    positions.find((p) => p.kind === "classic" && p.asset === "native");
  return xlm?.valueUsd && Number(xlm.amount) > 0 ? (Number(xlm.valueUsd) / Number(xlm.amount)) * rate : null;
}

/** The vaults, Tesouro and the portfolio, from the device cache (T-040): shown at once, refreshed when the screen opens. */
function useInvestData() {
  const invest = useCached(investCache);
  const cached = useCached(portfolioCache);
  const load = useCallback(
    () => Promise.all([investCache.refresh(), portfolioCache.refresh()]).then(() => undefined),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return {
    vaults: invest.data?.vaults ?? null,
    tesouro: invest.data?.tesouro ?? null,
    rate: Number(invest.data?.rate ?? 0),
    portfolio: cached.data,
    error: invest.failed && !invest.data ? "Não foi possível carregar os investimentos agora." : null,
    reload: load,
  };
}

export function Invest() {
  const { vaults, tesouro, rate, portfolio, error } = useInvestData();
  const tesouroBrl = Number(tesouro?.valueUsd ?? 0) * rate;
  const total =
    (vaults ?? []).reduce((n, v) => n + Number(v.invested) * (priceBrl(v.unit, rate, portfolio, v.id) ?? 0), 0) +
    tesouroBrl;

  return (
    <>
      <TopBar title="Investir" />
      <main className="screen screen-tabs">
        <section className="slab invest-total" aria-label="Seus investimentos">
          <span className="t-label">Você tem investido</span>
          {vaults ? (
            <span className="money">{reais(total)}</span>
          ) : (
            <span className="bar" style={{ width: 200, height: 52, marginTop: 4 }} aria-hidden="true" />
          )}
          <span className="small muted">Rende todo dia. Você resgata quando quiser, inclusive para pagar um Pix.</span>
        </section>
        {error && <Notice tone="danger">{error}</Notice>}

        <section className="section" aria-labelledby="options">
          <h2 id="options" className="t-section">
            Opções
          </h2>
          {!vaults ? (
            <SkeletonRows lines={3} label="Carregando seus investimentos" />
          ) : (
            <ul className="rows">
              {vaults.map((v) => {
                const price = priceBrl(v.unit, rate, portfolio, v.id);
                const has = Number(v.invested);
                // Lumens in reais are an estimate: "≈", as on Início (T-034).
                const approx = v.unit === "XLM" ? "≈ " : "";
                return (
                  <li key={v.id}>
                    <a className="offer" href={hrefOf({ name: "vault", id: v.id })}>
                      <AssetAvatar position={{ kind: "defindex", asset: v.asset }} />
                      <span className="row-main">
                        <span className="row-title">{v.name}</span>
                        <span className="row-sub">
                          {has > 0
                            ? `Você tem ${price ? `${approx}${reais(has * price)}` : inUnit(v.unit === "XLM" ? "XLM" : "USDC", has)}`
                            : v.unit === "USDC"
                              ? "Em dólar digital"
                              : "Em lumens"}
                        </span>
                      </span>
                      <span className="offer-rate">
                        <span className="rate">{v.apyPercent === null ? "—" : pct(v.apyPercent)}</span>
                        <span className="rate-unit">ao ano</span>
                      </span>
                      <Icon name="chevronRight" size={18} className="go" />
                    </a>
                  </li>
                );
              })}
              <li>
                <a className="offer" href={hrefOf(tesouro ? { name: "tesouro" } : { name: "add" })}>
                  <AssetAvatar position={{ kind: "classic", asset: "TESOURO:GC3CW7" }} />
                  <span className="row-main">
                    <span className="row-title">Tesouro</span>
                    <span className="row-sub">
                      {tesouroBrl > 0 ? `Você tem ${reais(tesouroBrl)}` : "Rende em reais"}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} className="go" />
                </a>
              </li>
            </ul>
          )}
        </section>
        <p className="fine">{PAST}</p>
      </main>
    </>
  );
}

const NOT_HERE = "Esse investimento não existe por aqui.";

/** Loading an option's page: rows where the overview lands, or the reason it can't. */
const Loading = ({ error }: { error: string | null }) =>
  error ? (
    <Notice tone="danger">{error}</Notice>
  ) : (
    <Shaped label="Carregando o investimento">
      <OverviewShape />
    </Shaped>
  );

/** A DeFindex vault (dollars or lumens): its overview, then investing or taking out (T-041). */
export function VaultPage({ id, account }: { id: string; account: string }) {
  const { vaults, rate, portfolio, error } = useInvestData();
  const vault = vaults?.find((v) => v.id === id) ?? null;
  const inv = useMemo<Investment | null>(() => {
    if (!vault) return null;
    const unit: Unit = vault.unit === "XLM" ? "XLM" : "USDC";
    const word = unit === "XLM" ? "Lumens" : "Dólar digital";
    return {
      name: vault.name,
      mark: { kind: "defindex", asset: vault.asset },
      apy: vault.apyPercent,
      rateLine: vault.apyPercent === null ? "Taxa indisponível agora" : `Rende ${apyText(vault.apyPercent)}`,
      rateSource: vault.apyPercent === null ? null : "Taxa de hoje, informada pela DeFindex",
      about:
        "Rende todo dia. Você resgata quando quiser, inclusive para pagar um Pix: o valor volta para a sua carteira.",
      unit,
      priceBrl: priceBrl(vault.unit, rate, portfolio, vault.id),
      invested: vault.invested,
      canInvest: vault.canInvest,
      wallet: { in: word, out: word, mark: { kind: "classic", asset: unit === "XLM" ? "native" : USDC_MARK } },
      terms: {
        in: [["Resgate", "Quando quiser", "tudo ou uma parte"]],
        out: [["Chega", "Na sua carteira", "assim que a rede registrar"]],
      },
      addLink: unit === "USDC",
      needsTrust: false,
      prepare: (mode, a) => (mode === "in" ? api.deposit(vault.id, a.value) : api.redeem(vault.id, a.value)),
    };
  }, [vault, rate, portfolio]);

  return (
    <OptionPage
      key={id}
      inv={inv}
      account={account}
      loading={<Loading error={vaults && !vault ? NOT_HERE : error} />}
    />
  );
}

/**
 * Tesouro (T-029): bought with the wallet's dollars or lumens and sold back on the market, one confirmation each; amounts in
 * reais, as Tesouro earns. Buying the first time asks the wallet to accept Tesouro (one more step, once).
 */
export function TesouroPage({ account }: { account: string }) {
  const { tesouro, rate, error, reload } = useInvestData();
  const inv = useMemo<Investment | null>(() => {
    if (!tesouro) return null;
    const held = Number(tesouro.held);
    const heldBrl = Number(tesouro.valueUsd) * rate;
    return {
      name: "Tesouro",
      mark: { kind: "classic", asset: "TESOURO:GC3CW7" },
      apy: null,
      rateLine: "Rende em reais, todo dia",
      rateSource: null,
      about: "Um título público em reais. Comprado e vendido pelo preço do mercado, na hora.",
      heldDetail:
        held > 0 && heldBrl > 0 ? `${units(String(held), 2)} unidades · 1 ≈ ${reais(heldBrl / held)}` : undefined,
      unit: "BRL",
      priceBrl: 1,
      invested: String(heldBrl),
      canInvest: String(Number(tesouro.canBuyUsd) * rate),
      wallet: { in: "Dólar digital e lumens", out: "Dólar digital", mark: { kind: "classic", asset: USDC_MARK } },
      terms: {
        in: [
          ["Preço", "O do mercado", "na hora da compra"],
          ["Resgate", "Quando quiser", "pelo preço do mercado"],
        ],
        out: [
          ["Preço", "O do mercado", "na hora da venda"],
          ["Chega", "Na sua carteira", "como dólar digital"],
        ],
      },
      addLink: true,
      needsTrust: !tesouro.trusted,
      prepare: (mode, a) =>
        api.tesouro(
          mode === "in" ? "buy" : "sell",
          mode === "out" && a.all ? { all: true } : { amountBrl: (a.cents / 100).toFixed(2) },
        ),
      trust: async () => {
        const t = await api.rampTrustline("TESOURO");
        if (!("transaction" in t)) throw new Error("already trusted");
        return t;
      },
      reload,
    };
  }, [tesouro, rate, reload]);

  return <OptionPage inv={inv} account={account} loading={<Loading error={error} />} />;
}
