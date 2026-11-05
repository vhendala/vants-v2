// Atividade (T-026; T-033: everything, not only Pix): what was paid this month in one line, then every movement by day on
// the page: Pix payments (each opens its receipt), investing and redeeming, Tesouro bought or sold, the wallet accepting
// an asset, and money added by Pix. Amounts are the ones each movement was made with, in its own unit.
import { useCallback, useEffect, useState } from "react";
import { type ActionActivity, type ActivityItem, api, type RampOrder } from "../api.ts";
import { Badge, Button, Icon } from "../design/ds.tsx";
import { clock, dayLabel, reais, units, usd } from "../format.ts";
import { hrefOf, navigate } from "../router.ts";
import { AssetAvatar, Notice, SkeletonRows, TopBar } from "../ui.tsx";
import { ORDER_STATUS, TARGETS } from "./AddMoney.tsx";
import { PaymentRow } from "./Home.tsx";

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long" });
const TESOURO_MARK = { kind: "classic" as const, asset: "TESOURO:GC3CW7" };

export function Activity({ account: _account }: { account: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [month, setMonth] = useState<{ paidBrl: string; count: number } | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    setBusy(true);
    setError(null);
    try {
      const page = await api.activity({ limit: 20, ...(before ? { before } : {}) });
      setItems((cur) => (before && cur ? [...cur, ...page.items] : page.items));
      setMonth(page.month);
      setNext(page.next);
    } catch {
      setError("Não foi possível carregar a atividade.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days: { label: string; items: ActivityItem[] }[] = [];
  for (const i of items ?? []) {
    const label = dayLabel(i.createdAt);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(i);
    else days.push({ label, items: [i] });
  }

  return (
    <>
      <TopBar title="Atividade">
        <button type="button" className="icon-btn" onClick={() => void load()} aria-label="Atualizar" disabled={busy}>
          <Icon name="refresh" size={20} />
        </button>
      </TopBar>
      <main className="screen screen-tabs">
        {month && month.count > 0 && (
          <p className="secondary">
            Pix pagos em {MONTH.format(new Date())}: <strong className="money">{reais(month.paidBrl)}</strong> em{" "}
            {month.count} Pix
          </p>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {!items ? (
          <SkeletonRows lines={4} label="Carregando sua atividade" />
        ) : items.length === 0 ? (
          <div className="empty">
            <p className="t-section">Nada por aqui ainda</p>
            <p className="secondary">
              Cada Pix que você pagar, cada investimento e cada Pix que você fizer para adicionar dinheiro aparece aqui.
            </p>
            <Button iconLeft="scan" onClick={() => navigate({ name: "pay", mode: "qr" })}>
              Pagar um Pix
            </Button>
          </div>
        ) : (
          days.map((d) => (
            <section key={d.label} className="section" aria-label={d.label}>
              <h2 className="t-label">{d.label}</h2>
              <ul className="rows">
                {d.items.map((i) =>
                  i.type === "payment" ? (
                    <PaymentRow key={i.id} exit={i.exit} withDay={false} />
                  ) : i.type === "action" ? (
                    <ActionRow key={i.id} action={i.action} />
                  ) : (
                    <DepositRow key={i.id} order={i.order} />
                  ),
                )}
              </ul>
            </section>
          ))
        )}
        {next && (
          <Button variant="secondary" block onClick={() => void load(next)} disabled={busy} aria-busy={busy}>
            {busy ? "Carregando" : "Ver mais"}
          </Button>
        )}
      </main>
    </>
  );
}

/** An action's status in the same vocabulary as payments: done is ink with a check, moving is amber, failed is red. */
function ActionStatus({ status }: { status: ActionActivity["status"] }) {
  if (status === "done")
    return (
      <span className="status status-done">
        <Icon name="check" size={14} />
        Concluído
      </span>
    );
  return status === "failed" ? (
    <Badge tone="danger">Não concluído</Badge>
  ) : (
    <Badge tone="pending" dot>
      Processando
    </Badge>
  );
}

/** "12,50" dollars as "US$ 12,50"; lumens as "30 lumens": the unit the movement was made in, not an estimate in reais. */
const inUnit = (asset: string, amount: string) =>
  asset === "native" ? `${units(amount, 2)} ${Number(amount) === 1 ? "lúmen" : "lumens"}` : usd(amount);

export function ActionRow({ action: a }: { action: ActionActivity }) {
  const at = clock(a.createdAt);
  let title: string;
  let sub = at;
  let amount: string | null = null;
  let href = hrefOf({ name: "tesouro" });
  let mark = <AssetAvatar position={TESOURO_MARK} />;
  if ((a.kind === "invest" || a.kind === "redeem") && a.vault) {
    title = a.vault.name;
    sub = `${at} · ${a.kind === "invest" ? "investiu" : "resgatou"}`;
    amount = a.detail.amount ? inUnit(a.vault.asset, a.detail.amount) : null;
    href = hrefOf({ name: "vault", id: a.vault.id });
    mark = <AssetAvatar position={{ kind: "defindex", asset: a.vault.asset }} />;
  } else if (a.kind === "trade") {
    title = "Tesouro";
    amount = a.detail.amountBrl ? reais(a.detail.amountBrl) : null;
    sub = `${at} · ${a.detail.side === "sell" ? (amount ? "vendeu" : "vendeu tudo") : "comprou"}`;
  } else if (a.kind === "trustline") {
    const tesouro = (a.detail.asset ?? "").startsWith("TESOURO");
    title = tesouro ? "Tesouro" : "Dólar digital";
    sub = `${at} · carteira pronta para receber`;
    if (!tesouro) {
      href = hrefOf({ name: "add" });
      mark = <AssetAvatar position={{ kind: "classic", asset: a.detail.asset ?? "USDC:" }} />;
    }
  } else {
    // An investment whose vault Vants no longer offers: the line the wallet showed.
    title = a.transaction.summary[0] ?? "Operação na carteira";
  }
  return (
    <li>
      <a className="row" href={href}>
        {mark}
        <span className="row-main">
          <span className="row-title">{title}</span>
          <span className="row-sub">{sub}</span>
        </span>
        <span className="row-end">
          {amount && <span className="money">{amount}</span>}
          <ActionStatus status={a.status} />
        </span>
      </a>
    </li>
  );
}

export function DepositRow({ order: o }: { order: RampOrder }) {
  const s = ORDER_STATUS[o.status] ?? { text: o.status, tone: "neutral" as const };
  // Short words in the list (the order's page says the rest): waiting for the Pix, then on its way.
  const short = o.status === "created" ? "Aguardando Pix" : o.status === "funded" ? "Enviando" : s.text;
  const target = TARGETS[o.target as keyof typeof TARGETS];
  return (
    <li>
      <a className="row" href={hrefOf({ name: "add" })}>
        <span className="avatar" aria-hidden="true">
          <Icon name="plus" size={18} />
        </span>
        <span className="row-main">
          <span className="row-title">{target ? target.name : o.target}</span>
          <span className="row-sub">{clock(o.createdAt)} · adicionado com Pix</span>
        </span>
        <span className="row-end">
          <span className="money">{reais(o.amountBrl)}</span>
          {s.tone === "done" ? (
            <span className="status status-done">
              <Icon name="check" size={14} />
              Na carteira
            </span>
          ) : s.tone === "pending" ? (
            <Badge tone="pending" dot>
              {short}
            </Badge>
          ) : s.tone === "danger" ? (
            <Badge tone="danger">{s.text}</Badge>
          ) : (
            <span className="status">{s.text}</span>
          )}
        </span>
      </a>
    </li>
  );
}
