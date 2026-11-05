// 7 Comprovante (canvas board 7; T-044): a paper slip. Its band says the real status, live (carimbo blue when paid, ink
// while on its way, grey when the money came back, red when it failed), then the amount, who was paid, the steps with
// their times, how it was paid and the ids a person can show. For a key payment, the key; for a QR code, the merchant.
import { useEffect, useRef, useState } from "react";
import { api, type ExitView } from "../api.ts";
import { Button, Icon, Mark } from "../design/ds.tsx";
import { clock, explorerTx, LUMENS_VAULT, longDate, reais, short, usd } from "../format.ts";
import { navigate } from "../router.ts";
import { afterAction } from "../store.ts";
import { rise, useSuccessHaptic } from "../success.tsx";
import {
  colorOf,
  Details,
  Dock,
  FlowHeader,
  Loading,
  Notice,
  payeeOfPayment,
  positionName,
  sourceWord,
} from "../ui.tsx";

const PAID = [
  { status: "awaiting_deposit", label: "Confirmado" },
  { status: "funded", label: "Recebido" },
  { status: "paying", label: "Enviando" },
  { status: "completed", label: "Pago" },
] as const;
const REFUND = [
  { status: "awaiting_deposit", label: "Confirmado" },
  { status: "refunding", label: "Devolvendo" },
  { status: "refunded", label: "Devolvido" },
] as const;
const DONE = new Set(["completed", "refunded", "expired"]);
/** "8 s", "2:02": how long the payment has been on its way. */
const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** While a payment is in flight, what is happening right now (T-026: it must be obvious the payment is being processed). */
const LIVE: Record<string, string> = {
  awaiting_deposit: "Confirmando na rede",
  funded: "Recebemos, preparando o Pix",
  paying: "Enviando o Pix ao banco",
  refunding: "Devolvendo para a sua carteira",
};

/** A position id as the vault, XLM or a stablecoin, coloured as everywhere else. */
function pickView(id: string) {
  const kind = id.startsWith("defindex:") ? "defindex" : "classic";
  // A vault pick names its vault: the lumens one (T-026) pays out lumens, the dollar one Blend's dollar.
  const asset = id.startsWith("defindex:")
    ? id === `defindex:${LUMENS_VAULT}`
      ? "native"
      : "USDC:GATALT"
    : id.replace(/^classic:/, "");
  return { name: positionName({ kind, asset }).name, color: colorOf({ kind, asset }) };
}

export function Receipt({ exitId }: { exitId: string }) {
  const [view, setView] = useState<ExitView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await api.exit(exitId);
        if (!alive) return;
        setView(v);
        setError(null);
        if (DONE.has(v.payment.status)) return;
      } catch (err) {
        if (!alive) return;
        if (err instanceof Error && "status" in err && err.status === 404) {
          setError("Esse pagamento não existe nesta conta.");
          return;
        }
        setError("Sem conexão com a Vants. Tentando de novo…");
      }
      timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [exitId]);

  const back = () => (history.length > 1 ? history.back() : navigate({ name: "activity" }));

  // The success moment plays when the Pix is paid while the receipt is open (T-035): straight from paying, or watching a
  // payment in flight. A receipt that loads already paid (from Atividade) is calm.
  const firstStatus = useRef<string | null>(null);
  if (view && firstStatus.current === null) firstStatus.current = view.payment.status;
  const paidNow = view?.payment.status === "completed";
  const celebrate = paidNow && firstStatus.current !== "completed";
  useSuccessHaptic(celebrate);
  // Finished while open (paid, or refunded back to the wallet): the balances moved (T-040).
  const status = view?.payment.status;
  useEffect(() => {
    if (status && DONE.has(status) && firstStatus.current !== null && !DONE.has(firstStatus.current)) afterAction();
  }, [status]);

  if (!view)
    return (
      <div className="app">
        <FlowHeader title="Comprovante" back={back} />
        <main className="screen">
          {error ? (
            <Notice tone="danger">{error}</Notice>
          ) : (
            <Loading label="Carregando o comprovante">
              <span className="bar" style={{ height: 300 }} />
              <div className="facts">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <span className="bar" style={{ width: "35%", height: 14 }} />
                    <span className="bar" style={{ width: 96, height: 14 }} />
                  </div>
                ))}
              </div>
            </Loading>
          )}
        </main>
      </div>
    );

  const p = view.payment;
  const who = payeeOfPayment(p);
  const refunding = p.status === "refunding" || p.status === "refunded";
  const path = refunding ? REFUND : PAID;
  const at = path.findIndex((s) => s.status === p.status);
  const done = DONE.has(p.status);
  const live = done ? null : (LIVE[p.status] ?? null);
  const timeOf = (s: string) => p.timeline.find((t) => t.status === s)?.at;
  const started = timeOf("awaiting_deposit");
  const paidAt = timeOf("completed");
  const took = started && paidAt ? Math.max(1, Math.round((Date.parse(paidAt) - Date.parse(started)) / 1000)) : null;
  const headline =
    p.status === "completed"
      ? who.isKey
        ? "Pix enviado"
        : "Pix pago"
      : refunding
        ? "Não conseguimos pagar este Pix"
        : p.status === "expired"
          ? "O pagamento não chegou a tempo"
          : who.isKey
            ? "Enviando o seu Pix"
            : "Pagando o seu Pix";

  // How it was paid: the amounts the user chose, in reais at the quote's ratio; or just the positions, for older payments.
  // The picks cover the bill and the fee (the asset amount includes it), as Sai de showed before paying (T-034).
  const total7 = Number(p.quote.assetAmount);
  const totalCents = Math.round(Number(p.quote.amountBrl) * 100) + Math.round(Number(p.quote.feeBrl ?? 0) * 100);
  const shares = view.picks.map((pk) => {
    const id = typeof pk === "string" ? pk : pk.id;
    const amount = typeof pk === "string" ? undefined : pk.amount;
    const cents = amount && total7 ? Math.round((Number(amount) / total7) * totalCents) : null;
    return { id, cents, ...pickView(id) };
  });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard blocked: the text stays on screen to select
    }
  }

  async function share() {
    const text = [
      `${headline}: ${reais(p.quote.amountBrl)} para ${who.title}`,
      longDate(view?.createdAt ?? new Date().toISOString()),
      ...(p.payout?.endToEndId ? [`Código do Pix: ${p.payout.endToEndId}`] : []),
      ...(p.funding ? [`Registro público: ${explorerTx(p.funding.txHash)}`] : []),
      "Vants · modo de teste",
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "Comprovante Vants", text });
      else await copy(text, "share");
    } catch {
      // the share sheet was dismissed
    }
  }

  return (
    <div className="app">
      <FlowHeader title="Comprovante" back={back} />
      <main className="screen screen-dock">
        <article className={`slip${celebrate ? " celebrate" : ""}`} aria-labelledby="receipt-title">
          <header
            className={`slip-band${paidNow ? " paid" : p.status === "refunded" ? " back" : refunding || p.status === "expired" ? " bad" : ""}`}
          >
            {paidNow ? (
              <Mark size={20} />
            ) : live ? (
              <span className="op-spin" aria-hidden="true" />
            ) : (
              <Icon name={refunding ? "undo" : p.status === "expired" ? "x" : "clock"} size={20} />
            )}
            <h1 id="receipt-title" className="slip-title">
              {headline}
            </h1>
            {paidAt ? (
              <time className="band-end" dateTime={paidAt}>
                {clock(paidAt)}
              </time>
            ) : live && started ? (
              <span className="band-end">há {elapsed(now - Date.parse(started))}</span>
            ) : null}
          </header>
          <div className="slip-body">
            <p className="t-hero rise" style={rise(0).style}>
              {reais(p.quote.amountBrl)}
            </p>
            <p className="slip-to rise" style={rise(1).style}>
              para <strong>{who.title}</strong>
              {who.sub && !who.isKey ? `, ${who.sub}` : ""}
            </p>
            <p className="small muted rise" style={rise(2).style}>
              {longDate(view.createdAt)}
              {took ? ` · em ${took} segundos` : ""}
            </p>
            {live && (
              <p className="live-line" role="status">
                {live}
              </p>
            )}
            {refunding && <p className="small secondary">O valor volta para a sua carteira.</p>}
            <hr className="tear" />
            <ol className="progress" aria-label="Andamento">
              {path.map((s, i) => {
                const state =
                  refunding && s.status === "refunding" && i <= at
                    ? "bad"
                    : i < at || (i === at && done)
                      ? "done"
                      : i === at
                        ? "now"
                        : "";
                const t = timeOf(s.status);
                return (
                  <li key={s.status} className={`progress-step ${state}`}>
                    <i />
                    {s.label}
                    <time>{t ? clock(t) : ""}</time>
                  </li>
                );
              })}
            </ol>
          </div>
        </article>

        <section className="section" aria-labelledby="how">
          <h2 id="how" className="t-label">
            Saiu de
          </h2>
          <dl className="breakdown">
            {shares.map((s) => (
              <div key={s.id}>
                <span className="swatch" style={{ background: s.color }} />
                <dt>{s.name}</dt>
                <dd>{s.cents !== null ? reais(s.cents / 100) : sourceWord(s.id)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {p.payout?.endToEndId && (
          <dl className="facts">
            <div>
              <dt>Código do Pix</dt>
              <dd style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className="id">{short(p.payout.endToEndId, 6, 6)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => copy(p.payout?.endToEndId ?? "", "e2e")}
                  aria-label="Copiar o código do Pix"
                >
                  <Icon name={copied === "e2e" ? "check" : "copy"} size={18} />
                </button>
              </dd>
            </div>
          </dl>
        )}

        <Details summary="Detalhes técnicos">
          <dl className="facts">
            <div>
              <dt>Pagamento</dt>
              <dd className="id">{p.id}</dd>
            </div>
            <div>
              <dt>Em dólar digital</dt>
              <dd>{usd(p.quote.assetAmount)}</dd>
            </div>
            {p.funding && (
              <div>
                <dt>Registro público</dt>
                <dd>
                  <a className="link id" href={explorerTx(p.funding.txHash)} target="_blank" rel="noreferrer">
                    {short(p.funding.txHash, 6, 4)}
                    <Icon name="arrowUpRight" size={14} />
                  </a>
                </dd>
              </div>
            )}
            {p.refunds
              .filter((r) => r.txHash)
              .map((r) => (
                <div key={r.txHash}>
                  <dt>Devolução</dt>
                  <dd>
                    <a className="link id" href={explorerTx(r.txHash ?? "")} target="_blank" rel="noreferrer">
                      {short(r.txHash ?? "", 6, 4)}
                    </a>
                  </dd>
                </div>
              ))}
          </dl>
        </Details>
        {error && <p className="small muted">{error}</p>}
      </main>
      <Dock note={done ? undefined : <span>Pode sair: o comprovante continua se atualizando em Atividade.</span>}>
        {done ? (
          <div className="dock-row">
            <Button variant="secondary" size="lg" iconLeft={copied === "share" ? "check" : "share"} onClick={share}>
              {copied === "share" ? "Copiado" : "Compartilhar"}
            </Button>
            <Button size="lg" onClick={() => navigate({ name: "home" })}>
              Concluir
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="lg" block onClick={() => navigate({ name: "home" })}>
            Voltar ao início
          </Button>
        )}
      </Dock>
    </div>
  );
}
