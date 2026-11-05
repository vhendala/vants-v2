// Adicionar dinheiro (T-026, reworked in the review): reais in by Pix, through Etherfuse (sandbox). The amount comes first, on
// the keypad, and the price follows it live (it holds two minutes); what the reais become is one switch above it. The
// person's details are asked once; the wallet accepts the asset once (one confirmation); then a Pix "copia e cola" to pay
// from their bank. In test mode a quiet button stands in for the bank.
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type Action,
  ApiError,
  api,
  type RampOrder,
  type RampProfile,
  type RampQuote,
  type RampTarget,
} from "../api.ts";
import { Button, Icon } from "../design/ds.tsx";
import { reais, units, usd } from "../format.ts";
import { useJustCompleted } from "../motion.ts";
import { hrefOf, navigate } from "../router.ts";
import { afterAction } from "../store.ts";
import { SuccessCard } from "../success.tsx";
import { Dock, FlowHeader, Notice } from "../ui.tsx";
import { ConfirmPanel, useDeadline } from "./Confirm.tsx";
import { Keypad, TypedAmount, useCents } from "./Keypad.tsx";

const MIN_CENTS = 10_00;
const MAX_CENTS = 5_000_00;

export const TARGETS: Record<RampTarget, { name: string; line: string; unit: (n: number) => string }> = {
  USDC: {
    name: "Dólar digital",
    line: "Pronto para pagar qualquer Pix, ou para investir.",
    unit: (n) => (n === 1 ? "dólar digital" : "dólares digitais"),
  },
  TESOURO: {
    name: "Tesouro",
    line: "Título do governo que rende em reais.",
    unit: (n) => (n === 1 ? "unidade de Tesouro" : "unidades de Tesouro"),
  },
};

export const ORDER_STATUS: Record<string, { text: string; tone: "pending" | "done" | "danger" | "neutral" }> = {
  created: { text: "Esperando seu Pix", tone: "pending" },
  funded: { text: "Pix recebido, enviando", tone: "pending" },
  completed: { text: "Na sua carteira", tone: "done" },
  failed: { text: "Não concluído", tone: "danger" },
  refunded: { text: "Devolvido", tone: "neutral" },
  canceled: { text: "Cancelado", tone: "neutral" },
};

/** Fictitious details that pass the sandbox's checks (CPF check digits included): test mode only. */
const TEST_PROFILE: Form = {
  givenName: "Ana",
  familyName: "Teste",
  cpf: "529.982.247-25",
  birthDate: "12/04/1990",
  email: "ana.teste@exemplo.com.br",
  phone: "(11) 98765-4321",
  occupation: "Designer",
  postalCode: "01310-100",
  street: "Avenida Paulista, 1000",
  city: "São Paulo",
  region: "SP",
};

type Step =
  | { at: "start" }
  | { at: "profile" }
  | { at: "trust"; quote: RampQuote; action: Action }
  | { at: "order"; order: RampOrder };

export function AddMoney({ account }: { account: string }) {
  const [step, setStep] = useState<Step>({ at: "start" });
  const [target, setTarget] = useState<RampTarget>("USDC");
  const { cents, press } = useCents(MAX_CENTS * 10);
  const [ramp, setRamp] = useState<Awaited<ReturnType<typeof api.ramp>> | null>(null);
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRamp(await api.ramp());
    } catch {
      setError("Não foi possível falar com a Vants agora.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const amountOk = cents >= MIN_CENTS && cents <= MAX_CENTS;
  const amountBrl = (cents / 100).toFixed(2);

  // The price follows the amount (once the details are on file): fetched a moment after the last key.
  const asked = useRef("");
  useEffect(() => {
    setQuote(null);
    if (!amountOk || !ramp?.profile) return;
    const key = `${target}:${amountBrl}`;
    asked.current = key;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await api.rampQuote(target, amountBrl);
        if (asked.current === key) setQuote(q);
      } catch {
        if (asked.current === key) setQuote(null);
      } finally {
        if (asked.current === key) setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [amountOk, amountBrl, target, ramp?.profile]);

  const left = useDeadline(quote ? Math.floor(Date.parse(quote.expiresAt) / 1000) : undefined);

  const back = () => {
    setError(null);
    if (step.at === "start") return history.length > 1 ? history.back() : navigate({ name: "home" });
    setStep({ at: "start" });
    void load();
  };

  async function order(q: RampQuote) {
    setStep({ at: "order", order: await api.rampOrder(q.quoteId) });
  }

  /** From the amount on: details once, a fresh price, the wallet accepting the asset once, then the order. */
  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (!ramp?.profile) {
        setStep({ at: "profile" });
        return;
      }
      const q = quote && left > 10 ? quote : await api.rampQuote(target, amountBrl);
      if (q.needsTrustline) {
        const r = await api.rampTrustline(q.target);
        if (!("needed" in r)) {
          setStep({ at: "trust", quote: q, action: r });
          return;
        }
      }
      await order(q);
    } catch (err) {
      setError(
        err instanceof ApiError && (err.code === "QUOTE_EXPIRED" || err.code === "QUOTE_NOT_FOUND")
          ? "O preço expirou. Tente de novo."
          : err instanceof ApiError && err.code === "OFFLINE"
            ? err.message
            : "Não conseguimos gerar o Pix agora. Tente de novo.",
      );
    } finally {
      setBusy(false);
    }
  }

  const title = "Adicionar dinheiro";

  if (step.at === "profile")
    return (
      <div className="app">
        <FlowHeader title={title} back={back} step={{ at: 2, of: 3 }} />
        <ProfileForm
          onSaved={async () => {
            await load();
            setStep({ at: "start" });
          }}
        />
      </div>
    );

  if (step.at === "trust")
    return (
      <div className="app">
        <FlowHeader title={title} back={back} step={{ at: 2, of: 3 }} />
        <ConfirmPanel
          action={step.action}
          account={account}
          heading={`Deixe sua carteira receber ${step.quote.target === "USDC" ? "dólar digital" : "Tesouro"}`}
          cta="Confirmar e gerar o Pix"
          onDone={() =>
            void order(step.quote).catch(() => {
              setError("Não conseguimos gerar o Pix agora. Tente de novo.");
              setStep({ at: "start" });
            })
          }
        >
          <p className="lede">
            Toda carteira precisa aceitar um ativo antes de recebê-lo. É uma vez só: os próximos depósitos vão direto.
          </p>
        </ConfirmPanel>
      </div>
    );

  if (step.at === "order")
    return (
      <div className="app">
        <FlowHeader title={title} back={back} step={{ at: 3, of: 3 }} />
        <OrderView order={step.order} sandbox={ramp?.sandbox ?? true} />
      </div>
    );

  const t = TARGETS[target];
  return (
    <div className="app">
      <FlowHeader title={title} back={back} step={{ at: 1, of: 3 }} />
      <main className="screen screen-dock">
        {ramp && !ramp.available && <Notice tone="pending">Adicionar com Pix não está disponível agora.</Notice>}
        <fieldset className="segmented">
          <legend className="sr-only">Seus reais viram</legend>
          {(Object.keys(TARGETS) as RampTarget[]).map((k) => (
            <button key={k} type="button" aria-pressed={target === k} onClick={() => setTarget(k)}>
              {TARGETS[k].name}
            </button>
          ))}
        </fieldset>

        <section className="amount" aria-label="Quanto">
          <TypedAmount cents={cents} />
          <p className="small muted" aria-live="polite">
            {cents > MAX_CENTS
              ? `Até ${reais(MAX_CENTS / 100)} por vez`
              : cents > 0 && cents < MIN_CENTS
                ? `A partir de ${reais(MIN_CENTS / 100)}`
                : quote
                  ? `Você recebe ≈ ${units(quote.receive, 2)} ${t.unit(Number(quote.receive))} · tarifa ${reais(quote.feeBrl)}`
                  : quoting
                    ? "Buscando o preço"
                    : t.line}
          </p>
        </section>
        {target === "TESOURO" && (ramp?.sandbox ?? true) && (
          <Notice tone="info">
            No modo de teste, a Etherfuse confirma a compra com Pix mas não entrega o Tesouro na carteira. Para testar,{" "}
            <a className="link" href={hrefOf({ name: "tesouro" })}>
              invista em Tesouro com seu saldo
            </a>
            .
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Keypad onPress={press} />
      </main>
      <Dock
        busy={busy}
        note={
          quote && left > 0 ? (
            <>
              <span>Preço garantido por</span>
              <span className="money">
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
              </span>
            </>
          ) : (
            <span>Quem converte seus reais é a Etherfuse, parceira da Vants.</span>
          )
        }
      >
        <Button size="lg" block disabled={!amountOk || busy || ramp?.available === false} aria-busy={busy} onClick={go}>
          {busy ? "Preparando o Pix" : ramp && !ramp.profile && amountOk ? "Continuar" : "Gerar o Pix"}
        </Button>
      </Dock>
    </div>
  );
}

function OrderView({ order: first, sandbox }: { order: RampOrder; sandbox: boolean }) {
  const [order, setOrder] = useState(first);
  const [copied, setCopied] = useState(false);
  const [paying, setPaying] = useState(false);
  const [since] = useState(() => Date.now());
  const [, tick] = useState(0);
  // The success moment when the money lands while this screen is open (T-035); an order opened later, already done, is calm.
  const landed = order.status === "completed";
  const celebrate = useJustCompleted(landed);
  useEffect(() => {
    if (celebrate) afterAction(); // the money is in the wallet (T-040)
  }, [celebrate]);

  useEffect(() => {
    if (["completed", "failed", "refunded", "canceled"].includes(order.status)) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const o = await api.rampOrderStatus(order.id);
        if (alive) setOrder(o);
      } catch {
        // keep asking
      }
      if (alive) tick((n) => n + 1);
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [order.id, order.status]);

  async function copy() {
    if (!order.pixCode) return;
    try {
      await navigator.clipboard.writeText(order.pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the code is selectable
    }
  }

  async function simulate() {
    setPaying(true);
    try {
      await api.rampSimulatePaid(order.id);
      setOrder(await api.rampOrderStatus(order.id));
    } finally {
      setPaying(false);
    }
  }

  const t = TARGETS[order.target as RampTarget] ?? TARGETS.USDC;
  const s = ORDER_STATUS[order.status] ?? { text: order.status, tone: "neutral" as const };
  const slow = order.status === "funded" && Date.now() - Math.max(since, Date.parse(order.updatedAt)) > 60_000;
  const steps = [
    { key: "created", label: "Pix gerado" },
    { key: "funded", label: "Pix recebido" },
    { key: "completed", label: "Na sua carteira" },
  ];
  const at = steps.findIndex((x) => x.key === order.status);
  const waiting = order.status === "created";

  return (
    <>
      <main className="screen screen-dock">
        {landed ? (
          <SuccessCard
            celebrate={celebrate}
            title="Na sua carteira"
            // The hero is money, short enough for one line: dollars as US$; Tesouro as the reais paid, its units below.
            {...(order.target === "TESOURO"
              ? {
                  value: Number(order.amountBrl),
                  format: reais,
                  detail: `≈ ${units(order.receive, 2)} ${t.unit(Number(order.receive))} · via Pix`,
                }
              : {
                  value: Number(order.receive),
                  format: usd,
                  detail: `em dólar digital · ${reais(order.amountBrl)} via Pix`,
                })}
          >
            <ol className="progress" style={{ "--n": steps.length } as React.CSSProperties} aria-label="Andamento">
              {steps.map((x, i) => (
                <li
                  key={x.key}
                  className={`progress-step ${i < at || order.status === "completed" ? "done" : i === at ? "now" : ""}`}
                >
                  <i />
                  {x.label}
                </li>
              ))}
            </ol>
          </SuccessCard>
        ) : (
          <section className="receipt">
            <p className="t-label">{s.text}</p>
            <p className="t-hero">{reais(order.amountBrl)}</p>
            <p className="secondary">
              viram {units(order.receive, 2)} {t.unit(Number(order.receive))}
            </p>
            <ol className="progress" style={{ "--n": steps.length } as React.CSSProperties} aria-label="Andamento">
              {steps.map((x, i) => (
                <li
                  key={x.key}
                  className={`progress-step ${i < at || order.status === "completed" ? "done" : i === at ? "now" : ""}`}
                >
                  <i />
                  {x.label}
                </li>
              ))}
            </ol>
          </section>
        )}

        {waiting &&
          (order.pixCode ? (
            <section className="section" aria-labelledby="copia">
              <h2 id="copia" className="t-section">
                Pix copia e cola
              </h2>
              <p className="small muted" style={{ marginBottom: 12 }}>
                Copie o código e pague {reais(order.amountBrl)} no app do seu banco.
              </p>
              <div className="code-box">
                <span className="id">{order.pixCode}</span>
                <button type="button" className="icon-btn" onClick={copy} aria-label="Copiar código Pix">
                  <Icon name={copied ? "check" : "copy"} size={18} />
                </button>
              </div>
            </section>
          ) : (
            <Notice tone="pending">
              O código do Pix ainda não chegou do parceiro.{" "}
              {order.statusPage && (
                <a className="link" href={order.statusPage} target="_blank" rel="noreferrer">
                  Acompanhar na Etherfuse
                </a>
              )}
            </Notice>
          ))}
        {!waiting && order.status !== "completed" && order.statusPage && (
          <a className="link" href={order.statusPage} target="_blank" rel="noreferrer">
            Acompanhar o pedido na Etherfuse <Icon name="arrowUpRight" size={14} />
          </a>
        )}
        {slow && (
          <Notice tone="pending">
            Está demorando mais que o normal. No modo de teste, o parceiro às vezes não conclui esta etapa; nada é
            cobrado.
          </Notice>
        )}
      </main>
      <Dock>
        {waiting && order.pixCode ? (
          <Button size="lg" block iconLeft={copied ? "check" : "copy"} onClick={copy}>
            {copied ? "Código copiado" : "Copiar código Pix"}
          </Button>
        ) : landed ? (
          // Money landed (T-035): paying is the natural next step; Concluir shows the new balance on Início.
          <div className="dock-row">
            <Button variant="secondary" size="lg" onClick={() => navigate({ name: "pay", mode: "qr" })}>
              Pagar um Pix
            </Button>
            <Button size="lg" onClick={() => navigate({ name: "home" })}>
              Concluir
            </Button>
          </div>
        ) : (
          <Button size="lg" block variant="secondary" onClick={() => navigate({ name: "home" })}>
            Voltar ao início
          </Button>
        )}
        {waiting && sandbox && (
          <Button variant="ghost" block onClick={simulate} disabled={paying} aria-busy={paying}>
            Modo de teste: simular o pagamento
          </Button>
        )}
      </Dock>
    </>
  );
}

/** The details form, as typed: masks keep CPF, celular, CEP and the date in the shape people write them. */
interface Form {
  givenName: string;
  familyName: string;
  cpf: string;
  birthDate: string;
  email: string;
  phone: string;
  occupation: string;
  postalCode: string;
  street: string;
  city: string;
  region: string;
}

const digits = (s: string) => s.replace(/\D/g, "");
const MASKS: Partial<Record<keyof Form, (v: string) => string>> = {
  cpf: (v) =>
    digits(v)
      .slice(0, 11)
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2"),
  phone: (v) =>
    digits(v)
      .slice(0, 11)
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d{1,4})$/, "$1-$2"),
  postalCode: (v) =>
    digits(v)
      .slice(0, 8)
      .replace(/^(\d{5})(\d{1,3})$/, "$1-$2"),
  birthDate: (v) =>
    digits(v)
      .slice(0, 8)
      .replace(/^(\d{2})(\d)/, "$1/$2")
      .replace(/^(\d{2})\/(\d{2})(\d)/, "$1/$2/$3"),
  region: (v) =>
    v
      .replace(/[^a-z]/gi, "")
      .slice(0, 2)
      .toUpperCase(),
};

function ProfileForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [f, setF] = useState<Form>({
    givenName: "",
    familyName: "",
    cpf: "",
    birthDate: "",
    email: "",
    phone: "",
    occupation: "",
    postalCode: "",
    street: "",
    city: "",
    region: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: MASKS[k] ? (MASKS[k] as (v: string) => string)(e.target.value) : e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const [d, m, y] = f.birthDate.split("/");
    if (!d || !m || !y || y.length !== 4) return setError("Confira a data de nascimento (dd/mm/aaaa).");
    setBusy(true);
    setError(null);
    const profile: RampProfile = {
      givenName: f.givenName,
      familyName: f.familyName,
      cpf: f.cpf,
      birthDate: `${y}-${m}-${d}`,
      email: f.email,
      phone: f.phone,
      occupation: f.occupation,
      address: { street: f.street, city: f.city, region: f.region, postalCode: f.postalCode },
    };
    try {
      await api.rampProfile(profile);
      await onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "INVALID_CPF"
          ? "Esse CPF não é válido. Confira os números."
          : err instanceof ApiError && err.code === "INVALID_PHONE"
            ? "Esse celular não parece certo. Use DDD e número."
            : err instanceof ApiError && err.code === "INVALID_REQUEST"
              ? "Faltou algum dado. Confira os campos."
              : "Não foi possível salvar agora. Tente de novo.",
      );
    } finally {
      setBusy(false);
    }
  }

  const input = (
    k: keyof Form,
    label: string,
    attrs: { half?: boolean; mode?: "numeric" | "email" | "tel"; auto?: string; placeholder?: string } = {},
  ) => (
    <div className={attrs.half ? "field field-half" : "field"}>
      <label htmlFor={`f-${k}`} className="field-label">
        {label}
      </label>
      <input
        id={`f-${k}`}
        className="field-input"
        required
        value={f[k]}
        onChange={set(k)}
        {...(attrs.mode ? { inputMode: attrs.mode } : {})}
        {...(attrs.mode === "email" ? { type: "email" } : {})}
        {...(attrs.auto ? { autoComplete: attrs.auto } : {})}
        {...(attrs.placeholder ? { placeholder: attrs.placeholder } : {})}
      />
    </div>
  );

  return (
    <form onSubmit={save}>
      <main className="screen screen-dock">
        <section>
          <h1 className="t-title">Seus dados</h1>
          <p className="lede">Pedimos uma vez só: quem converte reais precisa saber quem está comprando.</p>
        </section>
        <p className="small">
          <span className="test-chip">Modo de teste</span> use dados fictícios.{" "}
          <button type="button" className="link-btn" onClick={() => setF(TEST_PROFILE)}>
            Preencher com dados de teste
          </button>
        </p>
        <fieldset className="field-group">
          <legend className="t-section">Você</legend>
          <div className="fields">
            {input("givenName", "Nome", { half: true, auto: "given-name" })}
            {input("familyName", "Sobrenome", { half: true, auto: "family-name" })}
            {input("cpf", "CPF", { mode: "numeric", placeholder: "000.000.000-00" })}
            {input("birthDate", "Nascimento", { half: true, mode: "numeric", auto: "bday", placeholder: "dd/mm/aaaa" })}
            {input("phone", "Celular", {
              half: true,
              mode: "tel",
              auto: "tel-national",
              placeholder: "(11) 90000-0000",
            })}
            {input("email", "E-mail", { mode: "email", auto: "email" })}
            {input("occupation", "Profissão")}
          </div>
        </fieldset>
        <fieldset className="field-group">
          <legend className="t-section">Endereço</legend>
          <div className="fields">
            {input("postalCode", "CEP", { half: true, mode: "numeric", auto: "postal-code", placeholder: "00000-000" })}
            {input("region", "Estado (UF)", { half: true, auto: "address-level1", placeholder: "SP" })}
            {input("street", "Rua e número", { auto: "street-address" })}
            {input("city", "Cidade", { auto: "address-level2" })}
          </div>
        </fieldset>
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="fine">
          Seus dados vão para a Etherfuse, que converte os reais. A Vants guarda só seu nome e e-mail.
        </p>
      </main>
      <Dock busy={busy}>
        <Button type="submit" size="lg" block disabled={busy} aria-busy={busy}>
          {busy ? "Salvando" : "Salvar e continuar"}
        </Button>
      </Dock>
    </form>
  );
}
