// Início (reworked in the T-026 review; T-044): the balance in reais on the ink slab with what it is made of (dollars,
// investments, lumens), paying a Pix as the one wide action (adding money leads when there's nothing to pay with), what the
// money is in plain words (investments show their yield and open their page), and the last payments.
import { useCallback, useEffect, useState } from "react";
import { api, type ExitView } from "../api.ts";
import { Icon } from "../design/ds.tsx";
import { clock, code, dayLabel, reais, units, usd } from "../format.ts";
import { hrefOf } from "../router.ts";
import { investCache, portfolioCache, useCached } from "../store.ts";
import {
  Initials,
  Notice,
  payeeOfPayment,
  pickIds,
  positionName,
  ShareBar,
  SkeletonRows,
  StatusBadge,
  sourceWord,
  TopBar,
} from "../ui.tsx";

/** "R$ 57.846" + ",10" in grey: the cents step back, as in the design. */
export function HeroMoney({ value }: { value: number }) {
  const [whole = "", cents = ""] = reais(value).split(",");
  return (
    <p className="t-hero">
      {whole}
      <span className="cents">,{cents}</span>
    </p>
  );
}

export function Home({ account: _account }: { account: string }) {
  // The balance is the one kept on the device (T-040): shown at once, then refreshed in the background on every visit.
  const cached = useCached(portfolioCache);
  const invest = useCached(investCache);
  const portfolio = cached.data;
  const [recent, setRecent] = useState<ExitView[] | null>(null);
  const [recentFailed, setRecentFailed] = useState(false);
  const apy = new Map((invest.data?.vaults ?? []).map((x) => [x.id, x.apyPercent]));

  const load = useCallback(async () => {
    const [e] = await Promise.allSettled([api.exits({ limit: 3 }), portfolioCache.refresh(), investCache.refresh()]);
    if (e.status === "fulfilled") setRecent(e.value.items);
    setRecentFailed(e.status === "rejected");
  }, []);
  const error =
    cached.failed || recentFailed
      ? portfolio
        ? "Sem conexão agora: mostrando o último saldo."
        : "Não foi possível atualizar agora."
      : null;

  useEffect(() => {
    void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const rate = Number(portfolio?.rate ?? "0");
  const total = Number(portfolio?.totalUsd ?? "0");
  const priced = (portfolio?.positions ?? [])
    .filter((p) => p.valueUsd)
    .sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd));
  const unpriced = (portfolio?.positions ?? []).filter((p) => !p.valueUsd);
  const empty = portfolio !== null && priced.length === 0;
  const inReais = (usdValue: number) => (rate ? reais(usdValue * rate) : usd(usdValue));
  // What the balance is made of, on the slab (T-044): the dollars that pay first, what is invested, the lumens.
  const kinds = KINDS.map((k) => ({
    ...k,
    value: priced.filter((p) => kindOf(p) === k.key).reduce((n, p) => n + Number(p.valueUsd), 0),
  })).filter((k) => k.value > 0);

  return (
    <>
      <TopBar />
      <main className="screen screen-tabs">
        <section className="slab balance" aria-labelledby="bal">
          <h1 id="bal" className="t-label">
            Saldo para pagar
          </h1>
          {portfolio ? (
            <>
              <HeroMoney value={rate ? total * rate : total} />
              <p className="balance-sub">{usd(total)}</p>
            </>
          ) : (
            <span className="bar" style={{ width: 240, height: 56, marginTop: 6 }} aria-hidden="true" />
          )}
          {kinds.length > 1 && (
            <div className="kinds">
              <ShareBar
                label="Do que é feito o seu saldo"
                parts={kinds.map((k) => ({ key: k.key, weight: k.value, color: k.color }))}
              />
              <ul className="legend">
                {kinds.map((k) => (
                  <li key={k.key}>
                    <span className="swatch" style={{ background: k.color }} />
                    {k.label}
                    <span className="money">{inReais(k.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <nav className="home-actions" aria-label="Ações">
          <a
            className={`vt-btn vt-btn--lg ${empty ? "vt-btn--secondary" : "vt-btn--primary pay-bar"}`}
            href={hrefOf({ name: "pay", mode: "qr" })}
          >
            <Icon name="scan" size={22} />
            <span>Pagar um Pix</span>
            {!empty && <Icon name="chevronRight" size={22} />}
          </a>
          <a className={`vt-btn vt-btn--lg vt-btn--${empty ? "primary" : "secondary"}`} href={hrefOf({ name: "add" })}>
            <Icon name="plus" size={20} />
            <span>Adicionar dinheiro</span>
          </a>
        </nav>

        {error && <Notice tone={portfolio ? "info" : "danger"}>{error}</Notice>}

        <section className="section" aria-labelledby="assets">
          <div className="section-head">
            <h2 id="assets" className="t-section">
              Seu dinheiro
            </h2>
            <button
              type="button"
              className="icon-btn refresh"
              onClick={() => void load()}
              aria-label={cached.refreshing ? "Atualizando" : "Atualizar"}
              aria-busy={cached.refreshing}
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>
          {!portfolio ? (
            <SkeletonRows label="Carregando seu saldo" />
          ) : empty ? (
            <p className="panel empty-note">
              {portfolio.funded
                ? "Sua carteira ainda está vazia. Adicione reais com Pix: eles viram dólar digital, pronto para pagar."
                : "Sua carteira ainda não foi ativada na rede de testes. Ative com lumens de teste e volte aqui."}
            </p>
          ) : (
            <ul className="rows">
              {priced.map((p) => {
                const { name, sub } = positionName(p);
                const earns = p.kind === "defindex" && p.vault;
                const a = earns && p.vault ? apy.get(p.vault) : null;
                // Tesouro earns in reais and has its own page (T-029).
                const tesouro = code(p.asset) === "TESOURO";
                const body = (
                  <>
                    <span className="row-main">
                      <span className="row-title">{name}</span>
                      {earns ? (
                        <span className="row-sub earn-line">
                          {a ? `Rende ${a.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ao ano` : "Rendendo"}
                        </span>
                      ) : tesouro ? (
                        <span className="row-sub earn-line">Rende em reais</span>
                      ) : (
                        <span className="row-sub">
                          {units(p.amount, 2)} {sub?.split(" · ")[0]}
                        </span>
                      )}
                    </span>
                    <span className="row-end">
                      <span className="money">
                        {p.pricing === "estimated" && <span className="approx">≈ </span>}
                        {reais(Number(p.valueUsd) * rate)}
                      </span>
                    </span>
                    {(earns && p.vault) || tesouro ? (
                      <Icon name="chevronRight" size={18} className="go" />
                    ) : (
                      <span className="go-space" aria-hidden="true" />
                    )}
                  </>
                );
                return (
                  <li key={p.id}>
                    {/* Rows that open a page end in a chevron; the others keep its space, so every amount ends on the
                        same edge (T-044). */}
                    {(earns && p.vault) || tesouro ? (
                      <a className="row" href={hrefOf(p.vault ? { name: "vault", id: p.vault } : { name: "tesouro" })}>
                        {body}
                      </a>
                    ) : (
                      <div className="row">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {unpriced.length > 0 && (
            <p className="fine">
              {unpriced.length === 1 ? "1 ativo" : `${unpriced.length} ativos`} sem preço confiável{" "}
              {unpriced.length === 1 ? "não entra" : "não entram"} no saldo. Valores com ≈ são estimados.
            </p>
          )}
        </section>

        <section className="section" aria-labelledby="recent">
          <div className="section-head">
            <h2 id="recent" className="t-section">
              Últimos pagamentos
            </h2>
            {recent && recent.length > 0 && (
              <a className="link small" href={hrefOf({ name: "activity" })}>
                Ver todos
              </a>
            )}
          </div>
          {!recent ? (
            <SkeletonRows lines={2} label="Carregando seus pagamentos" quiet />
          ) : recent.length === 0 ? (
            <p className="panel empty-note">
              Nenhum pagamento ainda. Cada Pix que você pagar aparece aqui, com o comprovante.
            </p>
          ) : (
            <ul className="rows">
              {recent.map((e) => (
                <PaymentRow key={e.id} exit={e} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

/** The three kinds of money on the slab, each with its colour there (the dollars that pay first in carimbo blue). */
const KINDS = [
  { key: "dollar", label: "Dólar digital", color: "var(--accent-on-inverse)" },
  { key: "invest", label: "Investido", color: "var(--gray-500)" },
  { key: "lumens", label: "Lumens", color: "var(--gray-25)" },
  { key: "other", label: "Outros", color: "var(--gray-700)" },
] as const;

function kindOf(p: { kind: string; asset: string }): (typeof KINDS)[number]["key"] {
  if (p.kind === "defindex" || code(p.asset) === "TESOURO") return "invest";
  if (p.asset === "native") return "lumens";
  return code(p.asset) === "USDC" ? "dollar" : "other";
}

export function PaymentRow({ exit, withDay = true }: { exit: ExitView; withDay?: boolean }) {
  const p = exit.payment;
  const who = payeeOfPayment(p);
  const from = [...new Set(pickIds(exit.picks).map(sourceWord))].join(" e ");
  const refunded = p.status === "refunded" || p.status === "expired";
  return (
    <li>
      <a className="row" href={hrefOf({ name: "receipt", id: exit.id })}>
        <Initials name={who.title} isKey={who.isKey} />
        <span className="row-main">
          <span className="row-title">{who.title}</span>
          <span className="row-sub">
            {withDay ? `${dayLabel(exit.createdAt)}, ` : ""}
            {clock(exit.createdAt)}
            {from ? ` · de ${from}` : ""}
          </span>
        </span>
        <span className="row-end">
          <span className={refunded ? "money struck" : "money"}>{reais(p.quote.amountBrl)}</span>
          <StatusBadge status={p.status} />
        </span>
      </a>
    </li>
  );
}
