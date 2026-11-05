// Investing and taking out (T-041), built like Pagar Pix: each option opens on an overview (what you have there, what it
// pays, how taking out works) with Investir and Resgatar as two actions; each runs as a flow with the header's steps:
//   1 amount (the keypad, quick amounts)  →  (receive the asset, Tesouro's first purchase)  →  2 review  →  done
// The review says where the money leaves from and where it lands, in reais too, the terms and the deadline, with the wallet's
// lines one tap away, then the one confirmation. The server builds and checks every transaction, as before.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type Action, ApiError, type Position } from "../api.ts";
import { Button, Icon } from "../design/ds.tsx";
import { floorCents, reais } from "../format.ts";
import { flowSteps, type Mode, quickAmounts, sendValue, yearEarnings } from "../move.ts";
import { navigate } from "../router.ts";
import { SuccessCard } from "../success.tsx";
import { AssetAvatar, Details, Dock, FlowHeader, Loading, Notice } from "../ui.tsx";
import { ConfirmPanel, phaseOf, useConfirm, useDeadline, useOpDock } from "./Confirm.tsx";
import { Keypad, TypedAmount, useCents } from "./Keypad.tsx";

export const PAST = "Rendimento passado não garante rendimento futuro. As taxas mudam todo dia.";

/** The unit an option counts in: dollars, lumens, or reais (Tesouro). */
export type Unit = "USDC" | "XLM" | "BRL";

/** "US$ 12,50", "12,5 lumens" or "R$ 12,50": an amount as people say it. */
export function inUnit(unit: Unit, n: number): string {
  if (unit === "BRL") return reais(n);
  if (unit === "XLM")
    return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${n === 1 ? "lumen" : "lumens"}`;
  return `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** One place money can be invested, described for the overview and the flow. */
export interface Investment {
  name: string;
  mark: Pick<Position, "kind" | "asset">;
  /** The yearly rate today, when known (the vaults; Tesouro has none to show). */
  apy: number | null;
  /** Under the name: "8% ao ano" or "Rende em reais, todo dia". */
  rateLine: string;
  /** Where the rate comes from, said once. */
  rateSource: string | null;
  unit: Unit;
  /** Reais per unit (an estimate for lumens), or null when unknown. */
  priceBrl: number | null;
  /** Exact amounts in the unit ("96.2962962"): what is invested here, and what the wallet can put in. */
  invested: string;
  canInvest: string;
  /** The wallet side of the move: where the money comes from, and where it lands when taken out. */
  wallet: { in: string; out: string; mark: Pick<Position, "kind" | "asset"> };
  /** The terms on the review, after the estimate: a label, a value, and a quieter second line. */
  terms: Record<Mode, [string, string, string?][]>;
  /** One plain sentence on the overview: how it earns and how it comes back. */
  about: string;
  /** What goes on the overview under "Você tem", when there is more to say (Tesouro's units). */
  heldDetail?: string | undefined;
  /** With nothing to put in: where to get some (adding money by Pix), or null when there's nowhere to send them. */
  addLink: boolean;
  /** Investing needs the wallet to accept the asset first (Tesouro, once). */
  needsTrust: boolean;
  /** Builds the one transaction (the server checks the balance again). */
  prepare: (mode: Mode, amount: { cents: number; value: string; all: boolean }) => Promise<Action>;
  /** Builds "let the wallet receive it" (Tesouro). */
  trust?: () => Promise<Action>;
  /** Re-reads the balances after the wallet accepted the asset. */
  reload?: () => Promise<void>;
}

type Stage = { at: "overview" } | { at: "flow"; mode: Mode } | { at: "done"; mode: Mode; amount: number };

/** An option's page: the overview, then the flow it starts, then the success moment. */
export function OptionPage({ inv, account, loading }: { inv: Investment | null; account: string; loading: ReactNode }) {
  const [stage, setStage] = useState<Stage>({ at: "overview" });
  const leave = () => (history.length > 1 ? history.back() : navigate({ name: "invest" }));

  if (!inv)
    return (
      <div className="app">
        <FlowHeader title="Investir" back={leave} />
        <main className="screen">{loading}</main>
      </div>
    );

  if (stage.at === "flow")
    return (
      <MoveFlow
        key={stage.mode}
        inv={inv}
        mode={stage.mode}
        account={account}
        onExit={() => setStage({ at: "overview" })}
        onDone={(amount) => setStage({ at: "done", mode: stage.mode, amount })}
      />
    );

  // The end of the flow (T-035): the success moment, then somewhere that makes sense: an investment is seen in Investir;
  // money taken out is back in the balance on Início.
  if (stage.at === "done") {
    const finish = () => navigate(stage.mode === "in" ? { name: "invest" } : { name: "home" });
    return (
      <div className="app">
        <FlowHeader title={inv.name} back={finish} />
        <main className="screen screen-dock screen-success">
          <SuccessCard
            celebrate
            title={stage.mode === "in" ? "Investido" : "Resgatado"}
            value={stage.amount}
            format={(n) => inUnit(inv.unit, n)}
            detail={
              stage.mode === "in"
                ? `em ${inv.name}${inv.apy !== null ? ` · ${inv.rateLine.charAt(0).toLowerCase()}${inv.rateLine.slice(1)}` : ""}`
                : `De volta à sua carteira como ${inv.wallet.out.toLowerCase()}, pronto para pagar um Pix`
            }
          />
          {stage.mode === "in" && <p className="fine center">{PAST}</p>}
        </main>
        <Dock>
          <div className="dock-row">
            <Button variant="secondary" size="lg" onClick={() => navigate({ name: "activity" })}>
              Ver atividade
            </Button>
            <Button size="lg" onClick={finish}>
              {stage.mode === "in" ? "Ver investimentos" : "Concluir"}
            </Button>
          </div>
        </Dock>
      </div>
    );
  }

  return <Overview inv={inv} back={leave} start={(mode) => setStage({ at: "flow", mode })} />;
}

/** In reais, "≈" when it is an estimate (lumens; dollars at today's rate). */
const approxBrl = (inv: Investment, n: number) =>
  inv.unit === "BRL" ? null : inv.priceBrl ? `≈ ${reais(n * inv.priceBrl)}` : null;

function Overview({ inv, back, start }: { inv: Investment; back: () => void; start: (mode: Mode) => void }) {
  const has = Number(inv.invested);
  const can = Number(inv.canInvest);
  const hasBrl = approxBrl(inv, has);
  return (
    <div className="app">
      <FlowHeader title={inv.name} back={back} />
      <main className="screen screen-dock">
        {/* The rate on the ink slab (T-044): the answer to "what does it earn" before anything else. */}
        <section className="slab" aria-labelledby="option-name">
          <h1 id="option-name" className="t-label">
            {inv.name}
          </h1>
          {inv.apy === null ? (
            <p className="rate-figure words">{inv.rateLine}</p>
          ) : (
            <p className="rate-figure">{inv.apy.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ao ano</p>
          )}
          {inv.rateSource && <p className="small muted">{inv.rateSource}</p>}
        </section>

        <dl className="facts">
          <div>
            <dt>Você tem aqui</dt>
            <dd>
              {has > 0 ? (
                <>
                  <span className="money">{hasBrl ?? inUnit(inv.unit, has)}</span>
                  {(hasBrl || inv.heldDetail) && (
                    <span className="fact-sub">{inv.heldDetail ?? inUnit(inv.unit, has)}</span>
                  )}
                </>
              ) : (
                <span className="secondary">Nada ainda</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Para investir</dt>
            <dd>
              {can > 0 ? (
                <>
                  <span className="money">{inUnit(inv.unit, can)}</span>
                  <span className="fact-sub">
                    {inv.unit === "BRL" ? `Em ${inv.wallet.in.toLowerCase()}` : "Na sua carteira"}
                  </span>
                </>
              ) : (
                <span className="secondary">Nada na carteira</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Resgate</dt>
            <dd>
              Quando quiser
              <span className="fact-sub">tudo ou uma parte</span>
            </dd>
          </div>
        </dl>

        {can <= 0 && (
          <Notice tone="info">
            {inv.addLink
              ? `Para investir aqui, adicione dinheiro com Pix.${has > 0 ? " Você ainda pode resgatar." : ""}`
              : `Você não tem ${inv.wallet.in.toLowerCase()} para investir agora.`}
          </Notice>
        )}
        <p className="small secondary">{inv.about}</p>
        <p className="fine">{PAST}</p>
      </main>
      <Dock>
        <div className={has > 0 ? "dock-row" : undefined}>
          {has > 0 && (
            <Button variant="secondary" size="lg" block onClick={() => start("out")}>
              Resgatar
            </Button>
          )}
          {can > 0 || !inv.addLink ? (
            <Button size="lg" block disabled={can <= 0} onClick={() => start("in")}>
              Investir
            </Button>
          ) : (
            <Button size="lg" block onClick={() => navigate({ name: "add" })}>
              Adicionar com Pix
            </Button>
          )}
        </div>
      </Dock>
    </div>
  );
}

/** A review loading: the amount, the two ends of the move and the terms, as bars. */
function ReviewShape() {
  return (
    <>
      <section className="who">
        <span className="bar" style={{ width: 110, height: 18 }} />
        <span className="bar" style={{ width: 180, height: 40, marginTop: 6 }} />
      </section>
      <div className="move">
        {[0, 1].map((i) => (
          <div key={i} className="move-row">
            <span className="avatar bar" />
            <span className="row-main">
              <span className="bar" style={{ width: "30%", height: 12 }} />
              <span className="bar" style={{ width: "55%", height: 16, marginTop: 6 }} />
            </span>
          </div>
        ))}
      </div>
      <div className="facts">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <span className="bar" style={{ width: "40%", height: 14 }} />
            <span className="bar" style={{ width: 72, height: 14 }} />
          </div>
        ))}
      </div>
    </>
  );
}

/** An option's overview loading: its mark, name and rate, then the facts, as bars. */
export function OverviewShape() {
  return (
    <>
      <section className="slab">
        <span className="bar" style={{ width: 140, height: 16 }} />
        <span className="bar" style={{ width: 220, height: 56, marginTop: 10 }} />
        <span className="bar" style={{ width: 180, height: 14, marginTop: 8 }} />
      </section>
      <div className="facts">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <span className="bar" style={{ width: "35%", height: 14 }} />
            <span className="bar" style={{ width: 96, height: 16 }} />
          </div>
        ))}
      </div>
    </>
  );
}

type Step =
  | { at: "amount" }
  | { at: "trust"; action: Action }
  | { at: "review"; action: Action; cents: number; all: boolean };

/** One move, as a flow: amount, (receive the asset), review; it calls `onDone` once the network has it. */
function MoveFlow({
  inv,
  mode,
  account,
  onExit,
  onDone,
}: {
  inv: Investment;
  mode: Mode;
  account: string;
  onExit: () => void;
  onDone: (amount: number) => void;
}) {
  const exact = mode === "in" ? inv.canInvest : inv.invested;
  const maxCents = floorCents(Number(exact));
  const { cents, setCents, press } = useCents();
  const [step, setStep] = useState<Step>({ at: "amount" });
  const [trust, setTrust] = useState(mode === "in" && inv.needsTrust);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = flowSteps(trust);
  const at = step.at === "amount" ? steps.amount : step.at === "trust" ? (steps.trust ?? 2) : steps.review;
  const verb = mode === "in" ? "Investir" : "Resgatar";

  const back = () => (step.at === "amount" ? onExit() : setStep({ at: "amount" }));

  const toReview = useCallback(async () => {
    const sent = sendValue(cents, exact);
    setStep({ at: "review", action: await inv.prepare(mode, { cents, ...sent }), cents, all: sent.all });
  }, [cents, exact, inv, mode]);

  async function next() {
    setBusy(true);
    setError(null);
    try {
      if (trust && inv.trust) setStep({ at: "trust", action: await inv.trust() });
      else await toReview();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (code === "TRUSTLINE_REQUIRED" && inv.trust) {
        // The wallet doesn't accept the asset yet (the list was older than the wallet): that step comes first.
        setTrust(true);
        try {
          setStep({ at: "trust", action: await inv.trust() });
        } catch {
          setError("Não foi possível preparar agora. Tente de novo em instantes.");
        }
      } else setError(prepareError(code, inv.unit, maxCents / 100));
    } finally {
      setBusy(false);
    }
  }

  const afterTrust = useCallback(() => {
    // The wallet accepts the asset now: the move itself is next.
    setBusy(true);
    void (inv.reload?.() ?? Promise.resolve())
      .then(toReview)
      .catch((err) => {
        setStep({ at: "amount" });
        setError(prepareError(err instanceof ApiError ? err.code : "", inv.unit, maxCents / 100));
      })
      .finally(() => setBusy(false));
  }, [inv, toReview, maxCents]);

  const header = <FlowHeader title={verb} back={back} step={{ at, of: steps.of }} />;

  if (step.at === "trust")
    return (
      <div className="app">
        {header}
        {busy ? (
          <>
            <main className="screen screen-dock">
              <Notice tone="info">Pronto: sua carteira já recebe {inv.name}.</Notice>
              <Loading label="Preparando o investimento">
                <ReviewShape />
              </Loading>
            </main>
            <Dock busy="after-trust">
              <Button size="lg" block disabled aria-busy>
                Preparando o investimento
              </Button>
            </Dock>
          </>
        ) : (
          <ConfirmPanel
            action={step.action}
            account={account}
            heading={`Deixe sua carteira receber ${inv.name}`}
            cta="Confirmar e continuar"
            onDone={afterTrust}
          >
            <p className="lede">
              Toda carteira precisa aceitar um ativo antes de recebê-lo. É uma vez só; depois você revisa o
              investimento.
            </p>
          </ConfirmPanel>
        )}
      </div>
    );

  if (step.at === "review")
    return (
      <div className="app">
        {header}
        <MoveReview
          inv={inv}
          mode={mode}
          action={step.action}
          cents={step.cents}
          all={step.all}
          account={account}
          onDone={onDone}
        />
      </div>
    );

  const typed = cents / 100;
  const over = cents > maxCents;
  const brl = approxBrl(inv, typed);
  return (
    <div className="app">
      {header}
      <main className="screen screen-dock">
        <div className="payee">
          <AssetAvatar position={inv.mark} />
          <span className="row-main">
            <span className="row-title">{inv.name}</span>
            <span className="row-sub">
              {mode === "in" ? inv.rateLine : `Você tem ${inUnit(inv.unit, Number(inv.invested))} aqui`}
            </span>
          </span>
        </div>

        <section className="amount" aria-labelledby="amt">
          <h1 id="amt" className="sr-only">
            {mode === "in" ? "Quanto investir" : "Quanto resgatar"}
          </h1>
          <TypedAmount
            cents={cents}
            prefix={inv.unit === "XLM" ? "" : inv.unit === "BRL" ? "R$" : "US$"}
            {...(inv.unit === "XLM" ? { suffix: "lumens" } : {})}
          />
          <p className="small muted">
            {cents > 0 && brl
              ? brl
              : `${mode === "in" ? "Para investir" : "Investido"}: ${inUnit(inv.unit, maxCents / 100)}`}
          </p>
          <div className="chips" style={{ justifyContent: "center", marginTop: 8 }}>
            {quickAmounts(maxCents).map((q) => (
              <button
                key={q.label}
                type="button"
                className="chip"
                aria-pressed={cents === q.cents}
                onClick={() => {
                  setError(null);
                  setCents(q.cents);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </section>

        {over && (
          <Notice tone="pending">
            {mode === "in"
              ? `Você tem ${inUnit(inv.unit, maxCents / 100)} para investir.`
              : `Você tem ${inUnit(inv.unit, maxCents / 100)} investidos aqui.`}
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Keypad
          onPress={(k) => {
            setError(null);
            press(k);
          }}
        />
      </main>
      <Dock busy={busy}>
        <Button size="lg" block onClick={next} disabled={cents === 0 || over || busy} aria-busy={busy}>
          {busy ? "Preparando" : "Revisar"}
        </Button>
      </Dock>
    </div>
  );
}

function prepareError(code: string, unit: Unit, max: number): string {
  if (code === "OVER_BALANCE") return `Esse valor passa do que você tem (até ${inUnit(unit, max)}).`;
  if (code === "NO_MARKET")
    return "O mercado não tem ofertas para esse valor agora. Tente um valor menor ou mais tarde.";
  if (code === "OFFLINE") return "Sem conexão. Confira a internet e tente de novo.";
  return "Não foi possível preparar agora. Tente de novo em instantes.";
}

/** The review: the amount, where it leaves from and where it lands, the terms, then the one confirmation. */
function MoveReview({
  inv,
  mode,
  action,
  cents,
  all,
  account,
  onDone,
}: {
  inv: Investment;
  mode: Mode;
  action: Action;
  cents: number;
  all: boolean;
  account: string;
  onDone: (amount: number) => void;
}) {
  const { state, error, confirm } = useConfirm(action, account);
  const left = useDeadline(action.transaction.maxTime);
  const expired = left <= 0 && state === "idle";
  const busy = state === "signing" || state === "sending" || state === "settling";
  const op = useOpDock(phaseOf(state));
  const amount = cents / 100;

  useEffect(() => {
    if (state === "done") onDone(amount);
  }, [state, onDone, amount]);

  const option = { title: inv.name, sub: inv.rateLine, mark: inv.mark };
  const wallet = {
    title: "Sua carteira",
    sub: mode === "in" ? inv.wallet.in : inv.wallet.out,
    mark: inv.wallet.mark,
  };
  const [from, to] = mode === "in" ? [wallet, option] : [option, wallet];
  const earns = mode === "in" ? yearEarnings(amount, inv.apy) : null;
  const remaining = Number(inv.invested) - amount;
  const brl = approxBrl(inv, amount);
  const label = inUnit(inv.unit, amount);

  return (
    <>
      <main className="screen screen-dock">
        <section className="who">
          <p className="t-label">{mode === "in" ? "Você vai investir" : "Você vai resgatar"}</p>
          <p className="t-hero">{label}</p>
          {brl && <p className="small muted">{brl}</p>}
        </section>

        <div className="move">
          <ol aria-label="De onde sai e para onde vai">
            {[
              { side: "Sai de", ...from },
              { side: "Vai para", ...to },
            ].map((r) => (
              <li key={r.side} className="move-row">
                <AssetAvatar position={r.mark} />
                <span className="row-main">
                  <span className="move-side">{r.side}</span>
                  <span className="row-title">{r.title}</span>
                  <span className="row-sub">{r.sub}</span>
                </span>
              </li>
            ))}
          </ol>
          <span className="move-arrow" aria-hidden="true">
            <Icon name="chevronDown" size={14} />
          </span>
        </div>

        <dl className="facts">
          {earns !== null && (
            <div>
              <dt>Em 1 ano</dt>
              <dd>
                <span className="earn-line money">+ {inUnit(inv.unit, earns)}</span>
                <span className="fact-sub">
                  {inv.priceBrl && inv.unit !== "BRL" ? `≈ ${reais(earns * inv.priceBrl)} · ` : ""}na taxa de hoje
                </span>
              </dd>
            </div>
          )}
          {mode === "out" && !all && remaining > 0 && (
            <div>
              <dt>Continua investido</dt>
              <dd className="money">{inUnit(inv.unit, remaining)}</dd>
            </div>
          )}
          {inv.terms[mode].map(([dt, dd, sub]) => (
            <div key={dt}>
              <dt>{dt}</dt>
              <dd>
                {dd}
                {sub && <span className="fact-sub">{sub}</span>}
              </dd>
            </div>
          ))}
          {state !== "sending" && state !== "settling" && (
            <div>
              <dt>Prazo para confirmar</dt>
              <dd className="money">
                {left <= 0 ? "Expirou" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
              </dd>
            </div>
          )}
        </dl>

        <Details summary="O que sua carteira vai mostrar">
          <ul className="ops">
            {action.transaction.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Details>

        {mode === "in" && inv.apy !== null && <p className="fine">{PAST}</p>}
        {error && <Notice tone="danger">{error}</Notice>}
      </main>
      <Dock {...op}>
        <Button size="lg" block onClick={confirm} disabled={expired || busy} aria-busy={busy}>
          {state === "signing" ? (
            "Confirme na carteira"
          ) : state === "sending" || state === "settling" ? (
            "Registrando"
          ) : expired ? (
            "Prazo expirado"
          ) : (
            <>
              Confirmar e {mode === "in" ? "investir" : "resgatar"} {label}
            </>
          )}
        </Button>
      </Dock>
    </>
  );
}
