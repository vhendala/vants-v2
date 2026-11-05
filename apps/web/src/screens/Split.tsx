// 5 De onde sai (T-023, reworked in T-026): the price is fixed first; then ONE bar is the whole payment, a coloured segment per
// source. Dragging the divider between two segments moves money from one to the other; a tap on an amount types it exactly;
// three one-tap suggestions fill the bar (the screen opens with "Manter rendendo" applied). Shares can't pass the total or a
// balance, and dollars from different issuers don't mix (lumens go with either), so what's on screen can always be paid in
// ONE confirmation (DEC-031, DEC-034). Sources that can't take part sit closed at the bottom, with the reason.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from "react";
import {
  type Bill,
  type Candidate,
  compatible,
  complete,
  covered,
  currencyOf,
  maxCents,
  parse7,
  remove,
  routesClash,
  type Slice,
  type Source,
  set,
  setDivider,
  suggest,
  toPicks,
  chooseSource,
} from "../allocation.ts";
import { ApiError, type Pick, type Position, type Priced } from "../api.ts";
import { Button, Icon } from "../design/ds.tsx";
import { centsToReais, code, parseReais, reais, units } from "../format.ts";
import { AssetAvatar, colorOf, Details, Dock, Initials, Notice, type Payee, positionName, ShareBar } from "../ui.tsx";

const REASONS: Record<string, string> = {
  shortfall: "A preços de agora, os valores escolhidos não cobrem o pagamento. Ajuste e tente de novo.",
  over_position: "Um dos valores passou do que o ativo tem agora. Ajuste e tente de novo.",
  mixed_routes: "Use um investimento por pagamento. O Tesouro também conta como um.",
  wrong_asset:
    "Esses dólares digitais são de emissores diferentes e não entram no mesmo Pix. Lumens combinam com qualquer um.",
  unpayable: "Um dos ativos não tem preço confiável agora.",
  unknown_position: "Sua carteira mudou. Volte e comece de novo.",
  router_unavailable: "Pagar com o que está investido não está disponível aqui.",
  needs_trustline:
    "Para juntar essas fontes, sua carteira precisa aceitar dólar digital. Adicione dinheiro uma vez (ela pede essa permissão) ou pague com uma fonte só.",
};

/** What the review and receipt show of the split: each chosen position, its colour and its share in reais. */
export interface ChosenSource {
  id: string;
  name: string;
  detail: string;
  color: string;
  cents: number;
}

/** Sold for the payment's dollar (lumens, Tesouro): no currency of its own, worth its estimate (T-029). */
const sold = (p: Position) => p.pricing === "estimated";

function sourceOf(p: Position): Source {
  return {
    id: p.id,
    currency: sold(p) ? null : p.asset,
    available7: parse7((sold(p) ? (p.payableUsd ?? p.valueUsd) : p.amount) ?? "0"),
    vault: p.kind === "defindex",
    orderBook: p.kind === "classic" && p.asset !== "native" && sold(p),
  };
}

/** What `cents` of this bill is in the position's own units, in plain words: dollars, or lumens at their estimate. */
function inUnits(p: Position, cents: number, bill: Bill, viaAmm: boolean): string {
  const asset = bill.totalCents ? (Number(bill.total7) * cents) / bill.totalCents / 1e7 : 0;
  if (p.kind === "classic" && p.asset === "native") {
    const xlm = (asset * Number(p.amount)) / Number(p.valueUsd ?? 1);
    return `≈ ${units(String(xlm), 1)} lumens, a preço estimado, trocados na hora${viaAmm ? " (troca automática)" : ""}`;
  }
  if (p.kind === "defindex" && p.asset === "native") {
    // Lumens invested (T-026): taken out and swapped in the payment, or taken out first and paid from the wallet (unyield);
    // the figure is an estimate, like lumens in the wallet.
    const xlm = (asset * Number(p.amount)) / Number((p.unyield ? p.valueUsd : p.payableUsd) ?? p.valueUsd ?? 1);
    return p.unyield
      ? `≈ ${units(String(xlm), 1)} lumens, resgatados antes do Pix`
      : `≈ ${units(String(xlm), 1)} lumens, que param de render`;
  }
  if (p.kind === "defindex") {
    return `${units(String(asset), 2)} dólares digitais, que param de render`;
  }
  if (code(p.asset) === "TESOURO") {
    const n = (asset * Number(p.amount)) / Number(p.valueUsd ?? 1);
    return `≈ ${units(String(n), 2)} unidades de Tesouro, vendidas na hora a preço de mercado`;
  }
  return `${units(String(asset), 2)} ${code(p.asset) === "USDC" ? "dólares digitais" : code(p.asset)}`;
}

type Strategy = "keep-earning" | "simplest" | "even";
const STRATEGIES: { id: Strategy; label: string }[] = [
  { id: "keep-earning", label: "Manter rendendo" },
  { id: "simplest", label: "Mais simples" },
  { id: "even", label: "Dividir igual" },
];

const roleOf = (p: Position): Candidate["role"] =>
  p.kind === "defindex" || code(p.asset) === "TESOURO" ? "earning" : p.asset === "native" ? "lumens" : "dollar";

/** Dragging snaps to whole reais, except at a bound (a ceiling or the bill), which stays exact. */
const snap = (cents: number) => Math.round(cents / 100) * 100;

export function Split({
  priced,
  payee,
  fixedAmount,
  onPlan,
}: {
  priced: Priced;
  payee: Payee;
  fixedAmount: boolean;
  onPlan: (picks: Pick[], sources: ChosenSource[]) => Promise<void>;
}) {
  const positions = priced.portfolio.positions;
  const sources = useMemo(() => positions.filter((p) => p.payable).map(sourceOf), [positions]);
  const candidates = useMemo<Candidate[]>(
    () => positions.filter((p) => p.payable).map((p) => ({ ...sourceOf(p), role: roleOf(p) })),
    [positions],
  );
  const totalCents = Math.round((Number(priced.amountBrl) + Number(priced.feeBrl)) * 100);
  const billIn = (currency: string | null): Bill => {
    const a = priced.assets.find((x) => x.asset === currency) ?? priced.assets[0];
    return { totalCents, total7: parse7(a?.assetAmount ?? "0") };
  };
  const [strategy, setStrategy] = useState<Strategy | null>("keep-earning");
  const [slices, setSlices] = useState<Slice[]>(() => suggest("keep-earning", candidates, billIn(null)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The plan Vants picked is shown first; "Alterar" opens the editor in place (T-026 review: one decision at the counter).
  const [editing, setEditing] = useState(false);

  const currency = currencyOf(slices, sources);
  const bill = billIn(currency);
  const rest = totalCents - covered(slices);
  const usesVault = slices.some((s) => s.cents > 0 && s.id.startsWith("defindex:"));
  const byId = (id: string) => positions.find((p) => p.id === id);

  const change = (next: Slice[]) => {
    setError(null);
    setStrategy(null);
    setSlices(next);
  };
  const apply = (st: Strategy) => {
    setError(null);
    setStrategy(st);
    setSlices(suggest(st, candidates, billIn(null)));
  };

  async function review() {
    setBusy(true);
    setError(null);
    const chosen: ChosenSource[] = slices
      .filter((s) => s.cents > 0)
      .map((s) => {
        const p = byId(s.id);
        return {
          id: s.id,
          name: p ? positionName(p).name : s.id,
          // The figure only ("≈ 42,2 lumens"), without the explanation after it (", a preço estimado…").
          detail: p ? (inUnits(p, s.cents, bill, usesVault).split(", ")[0] ?? "") : "",
          color: p ? colorOf(p) : "var(--gray-400)",
          cents: s.cents,
        };
      });
    try {
      await onPlan(toPicks(slices, sources, bill), chosen);
    } catch (err) {
      setError(
        err instanceof ApiError && err.reason
          ? (REASONS[err.reason] ?? err.message)
          : err instanceof ApiError && err.code === "FLOAT_UNAVAILABLE"
            ? "A Vants não consegue pagar esse valor agora. Tente daqui a pouco."
            : err instanceof ApiError && err.code === "OFFLINE"
              ? err.message
              : "Não foi possível montar o pagamento. Tente de novo.",
      );
    } finally {
      setBusy(false);
    }
  }

  // The bar shows the shares that have money: an empty one would put two handles on one spot (it stays in the list).
  const inBar = slices.filter((s) => s.cents > 0);

  // What isn't in the bar: what can join now, then what can take a dollar's place (another issuer: tapping it swaps), and,
  // closed at the bottom, what can't pay at all, with the reason.
  const others = positions.filter((p) => !slices.some((s) => s.id === p.id));
  const sourceOfId = (id: string) => sources.find((x) => x.id === id);
  const why = (p: Position): string | null => {
    const source = sourceOfId(p.id);
    if (!p.payable || !source)
      return p.pricing === "unpriced" ? "Sem preço confiável agora" : "A Vants ainda não paga Pix com este ativo";
    if (maxCents(source, bill) === 0) return "Saldo pequeno demais";
    return null;
  };
  const usable = others.filter((p) => why(p) === null);
  const unusable = others.filter((p) => why(p) !== null);
  /** What a swap-in would replace: chosen dollars of another issuer, or the other investment (one vault per payment). */
  const clashes = (p: Position) => {
    const source = sourceOfId(p.id);
    if (!source || compatible(source, slices, sources)) return [];
    return slices.filter((s) => {
      const other = sourceOfId(s.id);
      if (!other) return false;
      const issuerClash = source.currency !== null && other.currency !== null && other.currency !== source.currency;
      return issuerClash || Boolean(source.vault && other.vault) || routesClash(source, other);
    });
  };
  const join = (p: Position) => {
    const out = clashes(p).map((s) => s.id);
    change(
      chooseSource(
        p.id,
        slices.filter((s) => !out.includes(s.id)),
        sources,
        bill,
      ),
    );
  };

  const unyield = inBar.some((s) => byId(s.id)?.unyield);
  return (
    <>
      <main className="screen screen-dock">
        <section className="payee" aria-labelledby="who">
          <Initials name={payee.title} isKey={payee.isKey} />
          <span className="row-main">
            <span id="who" className="row-title">
              {payee.title}
            </span>
            <span className="row-sub">
              {[payee.sub, payee.isKey ? null : fixedAmount ? "valor fixo" : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="payee-amount">
            <span className="money">{reais(priced.amountBrl)}</span>
            <span className="small muted">
              {priced.feeBrl !== "0.00" ? `tarifa ${reais(priced.feeBrl)}` : "sem tarifa"}
            </span>
          </span>
        </section>

        {!editing ? (
          <section className="section plan" aria-labelledby="plan">
            <div className="section-head">
              <h1 id="plan" className="t-section">
                Sai de
              </h1>
              {positions.length > 0 && (
                <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                  Alterar
                </button>
              )}
            </div>
            {inBar.length > 1 && (
              <div style={{ margin: "8px 0 4px" }}>
                <ShareBar
                  label="Quanto sai de cada fonte"
                  parts={inBar.map((s) => ({
                    key: s.id,
                    weight: s.cents,
                    color: (() => {
                      const p = byId(s.id);
                      return p ? colorOf(p) : "var(--gray-400)";
                    })(),
                  }))}
                />
              </div>
            )}
            <ul className="rows">
              {inBar.map((sl) => {
                const p = byId(sl.id);
                if (!p) return null;
                return (
                  <li key={sl.id} className="row">
                    <AssetAvatar position={p} />
                    <span className="row-main">
                      <span className="row-title">{positionName(p).name}</span>
                      <span className="row-sub">{inUnits(p, sl.cents, bill, usesVault).split(", ")[0]}</span>
                    </span>
                    <span className="row-end">
                      <span className="money">{centsToReais(sl.cents)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {rest > 0 && (
              <p className="mix-status" aria-live="polite">
                <span>Faltam {centsToReais(rest)}</span>
                <button type="button" className="vt-btn vt-btn--sm vt-btn--primary" onClick={() => setEditing(true)}>
                  Escolher
                </button>
              </p>
            )}
            {unyield && (
              <Notice tone="info">
                Os lumens investidos saem do investimento antes do Pix: você confirma 2 vezes na carteira.
              </Notice>
            )}
            {positions.length === 0 && (
              <Notice tone="info">
                Sua carteira ainda não tem dinheiro para pagar. Adicione reais com Pix e volte aqui.
              </Notice>
            )}
          </section>
        ) : (
          <section className="mix" aria-labelledby="mix">
            <div className="section-head">
              <h1 id="mix" className="t-section">
                Escolha de onde sai
              </h1>
              <button type="button" className="link-btn" onClick={() => setEditing(false)} disabled={rest !== 0}>
                Pronto
              </button>
            </div>
            <fieldset className="mix-ideas">
              <legend className="sr-only">Sugestões</legend>
              {STRATEGIES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  className="chip"
                  aria-pressed={strategy === st.id}
                  onClick={() => apply(st.id)}
                >
                  {st.label}
                </button>
              ))}
            </fieldset>
            {inBar.length > 0 && (
              <MixBar
                slices={inBar}
                bill={bill}
                nameOf={(id) => {
                  const p = byId(id);
                  return p ? positionName(p).name : id;
                }}
                colorOf={(id) => {
                  const p = byId(id);
                  return p ? colorOf(p) : "var(--gray-400)";
                }}
                onDivider={(i, at) => {
                  const moved = setDivider(i, at, inBar, sources, bill);
                  change(slices.map((s) => moved.find((m) => m.id === s.id) ?? s));
                }}
              />
            )}
            {rest > 0 && (
              <p className="mix-status" aria-live="polite">
                <span>Faltam {centsToReais(rest)}</span>
                {slices.length > 0 && (
                  <button
                    type="button"
                    className="vt-btn vt-btn--sm vt-btn--primary"
                    onClick={() => change(complete(slices, candidates, bill))}
                  >
                    Completar
                  </button>
                )}
              </p>
            )}
            <ul>
              {slices.map((sl) => {
                const p = byId(sl.id);
                const source = sources.find((x) => x.id === sl.id);
                if (!p || !source) return null;
                return (
                  <ShareRow
                    key={sl.id}
                    position={p}
                    cents={sl.cents}
                    units={inUnits(p, sl.cents, bill, usesVault).split(", ")[0] ?? ""}
                    onChange={(c) => change(set(sl.id, c, slices, sources, bill))}
                    onRemove={() => change(remove(sl.id, slices))}
                  />
                );
              })}
            </ul>
            {inBar.length > 1 && <p className="fine">Arraste os círculos da barra para mudar quanto sai de cada um.</p>}

            {usable.length > 0 && (
              <section className="section" aria-labelledby="more">
                <h2 id="more" className="t-label">
                  {slices.length ? "Usar também" : "Fontes"}
                </h2>
                <ul className="rows">
                  {usable.map((p) => {
                    const source = sourceOfId(p.id);
                    const ceiling = source ? maxCents(source, bill) : 0;
                    const out = clashes(p);
                    const replaced = out.map((x) => {
                      const q = byId(x.id);
                      return q ? positionName(q).name : x.id;
                    });
                    return (
                      <li key={p.id}>
                        <button type="button" className="row row-btn" onClick={() => join(p)}>
                          <AssetAvatar position={p} />
                          <span className="row-main">
                            <span className="row-title">{positionName(p).name}</span>
                            <span className="row-sub">
                              {out.length
                                ? `No lugar de ${replaced.join(" e ")}`
                                : `Até ${centsToReais(ceiling)}${p.pricing === "estimated" ? ", estimado" : ""}`}
                            </span>
                          </span>
                          <span className="link">{out.length ? "Trocar" : "Usar"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {unusable.length > 0 && (
              <Details summary={`Não dá para usar neste Pix (${unusable.length})`}>
                <ul className="rows">
                  {unusable.map((p) => (
                    <li key={p.id} className="row row-off">
                      <AssetAvatar position={p} />
                      <span className="row-main">
                        <span className="row-title">{positionName(p).name}</span>
                        <span className="row-sub">{why(p)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Details>
            )}
          </section>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </main>
      <Dock busy={busy}>
        <Button size="lg" block onClick={review} disabled={rest !== 0 || busy} aria-busy={busy}>
          {busy ? "Montando o pagamento" : rest === 0 ? "Revisar pagamento" : `Faltam ${centsToReais(rest)}`}
        </Button>
      </Dock>
    </>
  );
}

/**
 * The payment as one thin bar: a segment per source, in its colour, and a round handle on each segment's right edge. A handle drags
 * (pointer, snapping to whole reais) or steps with the arrow keys (R$ 1, R$ 10 with Shift); it is a slider for assistive
 * tech, its value the share on its left.
 */
function MixBar({
  slices,
  bill,
  nameOf,
  colorOf: colour,
  onDivider,
}: {
  slices: Slice[];
  bill: Bill;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  onDivider: (i: number, at: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const total = bill.totalCents || 1;
  const edges: number[] = [];
  for (const s of slices) edges.push((edges.at(-1) ?? 0) + s.cents);
  const rest = total - (edges.at(-1) ?? 0);

  const atPointer = (e: PointerEvent) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return 0;
    const raw = ((e.clientX - r.left) / r.width) * total;
    return Math.max(0, Math.min(total, snap(raw)));
  };
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10_00 : 1_00;
    const at = edges[i] ?? 0;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? at + step
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? at - step
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? total
              : null;
    if (to === null) return;
    e.preventDefault();
    onDivider(i, to);
  };

  return (
    <div className={dragging === null ? "mixbar" : "mixbar is-dragging"} ref={bar}>
      <div className="mixbar-track">
        {slices.map((s) =>
          s.cents > 0 ? (
            <span
              key={s.id}
              className="mixbar-seg"
              style={{ flexGrow: s.cents, background: colour(s.id) } as CSSProperties}
            />
          ) : null,
        )}
        {rest > 0 && <span className="mixbar-seg mixbar-rest" style={{ flexGrow: rest }} />}
      </div>
      {slices.map((s, i) =>
        // The last handle only shows while part of the bill is uncovered: at the bar's end it would have nowhere to go.
        i === slices.length - 1 && rest === 0 ? null : (
          <span
            key={s.id}
            role="slider"
            tabIndex={0}
            className={dragging === i ? "mixbar-handle is-active" : "mixbar-handle"}
            style={{ left: `clamp(16px, ${((edges[i] ?? 0) / total) * 100}%, calc(100% - 16px))` }}
            aria-label={`Quanto sai de ${nameOf(s.id)}`}
            aria-valuemin={0}
            aria-valuemax={bill.totalCents}
            aria-valuenow={s.cents}
            aria-valuetext={centsToReais(s.cents)}
            onKeyDown={onKey(i)}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(i);
            }}
            onPointerMove={(e) => {
              if (dragging === i) onDivider(i, atPointer(e));
            }}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
          >
            <span className="mixbar-knob" aria-hidden="true" />
          </span>
        ),
      )}
    </div>
  );
}

/** One source in the mix: its colour and name, what the share is in its own units, the amount (tap to type it), remove. */
function ShareRow({
  position,
  cents,
  units: inOwnUnits,
  onChange,
  onRemove,
}: {
  position: Position;
  cents: number;
  units: string;
  onChange: (cents: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { name } = positionName(position);
  const id = `amt-${position.id.replace(/[^a-z0-9]/gi, "")}`;
  const shown = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  return (
    <li className="share-row">
      <span className="swatch" style={{ background: colorOf(position) }} />
      <span className="row-main">
        <span className="row-title share-name">{name}</span>
        <span className="row-sub">{inOwnUnits}</span>
      </span>
      <label className="share-amount" htmlFor={id}>
        <span aria-hidden="true">R$</span>
        <input
          id={id}
          className="share-input"
          inputMode="decimal"
          autoComplete="off"
          value={draft ?? shown}
          onFocus={(e) => {
            setDraft(shown);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            const c = parseReais(e.target.value);
            if (c !== null) onChange(c);
          }}
          onBlur={() => setDraft(null)}
          aria-label={`Quanto sai de ${name}, em reais`}
        />
      </label>
      <button type="button" className="remove-btn" onClick={onRemove} aria-label={`Não usar ${name}`}>
        <Icon name="x" size={16} />
      </button>
    </li>
  );
}
