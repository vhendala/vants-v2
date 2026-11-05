// The app's shared pieces (T-025; reworked in the T-026 review; restyled for direction A in T-044): one top bar for every
// tab, one flow header, one dock, one status vocabulary, and the marks people recognise money by.
import { maskPixKey, PIX_KEY_LABEL } from "@vants/pix";
import type { ReactNode } from "react";
import type { Destination, ExitView, PaymentStatus, PaymentView, Position, Priced } from "./api.ts";
import { Badge, Icon, type IconName, Logo } from "./design/ds.tsx";
import { code, issuerLabel } from "./format.ts";
import { hrefOf, type Route } from "./router.ts";
import { useNavLocked, useWaitStage, type WaitStage } from "./wait.ts";

/**
 * Each source keeps one colour on every screen, for the split and its legend (T-044): the dollars that pay a Pix first in
 * carimbo blue, lumens in ink, investments in greys. Colour is never the only cue: the legend names every part.
 */
export function colorOf(p: Pick<Position, "kind" | "asset">): string {
  if (p.kind === "defindex") return p.asset === "native" ? "var(--gray-700)" : "var(--gray-400)";
  if (p.asset === "native") return "var(--text)";
  if (issuerLabel(p.asset) === "Circle") return "var(--accent)";
  if (issuerLabel(p.asset) === "Blend") return "var(--blue-300)";
  if (code(p.asset) === "TESOURO") return "var(--gray-300)";
  return "var(--gray-200)";
}

/**
 * What people call an asset (T-026 voice: no crypto jargon). The technical name stays as the small second line, for the
 * person who wants to check it in their wallet.
 */
export function assetWords(asset: string): { name: string; sub: string } {
  if (asset === "native") return { name: "Lumens", sub: "XLM · moeda da Stellar" };
  const issuer = issuerLabel(asset);
  // Circle's is the dollar Vants pays with; Blend's is the one the dollar investment holds and gives back.
  if (code(asset) === "USDC")
    return issuer === "Circle"
      ? { name: "Dólar digital", sub: "USDC" }
      : issuer === "Blend"
        ? { name: "Dólar de investimento", sub: "USDC · Blend" }
        : { name: "Dólar de outro emissor", sub: "não aceito pela Vants" };
  if (code(asset) === "TESOURO") return { name: "Tesouro", sub: "título público em reais" };
  return { name: code(asset), sub: "outro ativo da carteira" };
}

/** A position id as a short word ("investimento", "lumens", "dólar"), for lists. */
export function sourceWord(id: string): string {
  if (id.startsWith("defindex:")) return "investimento";
  if (id === "classic:native") return "lumens";
  const c = code(id.replace(/^classic:/, ""));
  return c === "USDC" ? "dólar" : c === "TESOURO" ? "tesouro" : c;
}

/** Position ids from an exit's picks, whatever their shape. */
export const pickIds = (picks: ExitView["picks"]) => picks.map((p) => (typeof p === "string" ? p : p.id));

export function positionName(p: Pick<Position, "kind" | "asset">): { name: string; sub: string | null } {
  if (p.kind === "defindex")
    return p.asset === "native"
      ? { name: "Lumens que rendem", sub: "investido" }
      : { name: "Dólar que rende", sub: "investido" };
  const w = assetWords(p.asset);
  return { name: w.name, sub: w.sub };
}

/** Lumens' mark: a planet and its orbit, drawn for Vants (not Stellar's logo). */
const LumensGlyph = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="5.4" fill="currentColor" />
    <ellipse
      cx="12"
      cy="12"
      rx="10.4"
      ry="3.1"
      transform="rotate(-22 12 12)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

/**
 * A position's mark (T-030; T-044): the money's own sign, printed in a small square: "$" in ink for dollars, the planet for
 * lumens, "R$" for Tesouro. Each kind of money has the same mark on every screen; whether it earns is said in words.
 */
export function AssetAvatar({ position, size }: { position: Pick<Position, "kind" | "asset">; size?: "lg" }) {
  const c = code(position.asset);
  const kind = position.asset === "native" ? "xlm" : c === "TESOURO" ? "brl" : c === "USDC" ? "usd" : "other";
  return (
    <span className={`mark mark-${kind}${size === "lg" ? " mark-lg" : ""}`} aria-hidden="true">
      {kind === "xlm" ? (
        <LumensGlyph size={size === "lg" ? 28 : 20} />
      ) : kind === "brl" ? (
        "R$"
      ) : kind === "usd" ? (
        "$"
      ) : (
        c.slice(0, 2)
      )}
    </span>
  );
}

/** Who was paid: a merchant's initials on a neutral disc; a key icon for a Pix key (no name is known for it). */
export function Initials({ name, size, isKey }: { name: string; size?: "lg"; isKey?: boolean }) {
  const letters = name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={size === "lg" ? "avatar avatar-lg" : "avatar"} aria-hidden="true">
      {isKey || !letters ? <Icon name="key" size={size === "lg" ? 24 : 18} /> : letters}
    </span>
  );
}

// --- who is paid -----------------------------------------------------------------------------------------------------

/** "PADARIA SAO JORGE" → "Padaria Sao Jorge": QR codes carry names in capitals (EMV); the app shows them as names. */
const SMALL = new Set(["de", "da", "do", "das", "dos", "e"]);
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

/** Some bank apps put a placeholder ("N") as the merchant name: then it isn't a name. */
const realName = (s: string | undefined) => (s && s.trim().length >= 3 ? titleCase(s.trim()) : null);

export interface Payee {
  /** Bold line: the merchant, or the key as bank apps show it. */
  title: string;
  /** Under it: the city, or the key's type. */
  sub: string | null;
  /** True for a payment to a Pix key (no name is known before paying). */
  isKey: boolean;
}

export function payeeOfDestination(d: Destination, priced?: Priced | null, parsedName?: string): Payee {
  if (d.type === "pix_key")
    return { title: maskPixKey(d.keyType, d.key), sub: `Chave Pix · ${PIX_KEY_LABEL[d.keyType]}`, isKey: true };
  const name = realName(priced?.payee?.name) ?? realName(parsedName);
  return {
    title: name ?? (priced?.payee?.key ? `Chave Pix •••${priced.payee.key.slice(-4)}` : "QR code Pix"),
    sub: realName(priced?.payee?.city) ?? null,
    isKey: false,
  };
}

export function payeeOfPayment(p: PaymentView): Payee {
  const d = p.quote.destination;
  if (d.type === "pix_key")
    return { title: maskPixKey(d.keyType, d.key), sub: `Chave Pix · ${PIX_KEY_LABEL[d.keyType]}`, isKey: true };
  const name = realName(d.payee.name);
  return {
    title: name ?? (d.payee.key ? `Chave Pix •••${d.payee.key.slice(-4)}` : "QR code Pix"),
    sub: realName(d.payee.city),
    isKey: false,
  };
}

// --- status ----------------------------------------------------------------------------------------------------------

/** One status vocabulary: a word with a small mark; done has a check, what is still moving an amber dot. */
const STATUS: Record<PaymentStatus, { text: string; tone: "done" | "pending" | "danger" | "neutral" }> = {
  awaiting_deposit: { text: "Confirmando", tone: "pending" },
  funded: { text: "Processando", tone: "pending" },
  paying: { text: "Enviando", tone: "pending" },
  completed: { text: "Pago", tone: "done" },
  refunding: { text: "Devolvendo", tone: "pending" },
  refunded: { text: "Devolvido", tone: "neutral" },
  expired: { text: "Não concluído", tone: "danger" },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const s = STATUS[status];
  if (s.tone === "done")
    return (
      <span className="status status-done">
        <Icon name="check" size={14} />
        {s.text}
      </span>
    );
  if (s.tone === "neutral") return <span className="status">{s.text}</span>;
  return (
    <Badge tone={s.tone} dot={s.tone === "pending"}>
      {s.text}
    </Badge>
  );
}

// --- chrome ----------------------------------------------------------------------------------------------------------

/** The one place test mode is said, on every tab: the words with an amber dot, not a pill. */
export const TestChip = () => (
  <span className="test-chip">
    <span className="test-chip-dot" aria-hidden="true" />
    Modo de teste
  </span>
);

/**
 * Every tab's top bar: the wordmark on Início, the tab's name elsewhere; test mode and the account on the right (help
 * lives in the account, T-030).
 */
export function TopBar({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      {title ? <h1 className="topbar-title">{title}</h1> : <Logo height={24} />}
      <span className="topbar-end">
        <TestChip />
        {children}
        <a className="icon-btn account-btn" href={hrefOf({ name: "account" })} aria-label="Sua conta e ajuda">
          <Icon name="wallet" size={20} />
        </a>
      </span>
    </header>
  );
}

/** A flow's header: back, its name, and how far along it is. */
export function FlowHeader({
  title,
  back,
  step,
}: {
  title: string;
  back: () => void;
  step?: { at: number; of: number } | undefined;
}) {
  // While a transaction is being sent, there is no way back (T-042): leaving wouldn't cancel it.
  const locked = useNavLocked();
  return (
    <header className="flow-header">
      <button
        type="button"
        className="icon-btn"
        onClick={back}
        disabled={locked}
        aria-label={locked ? "Voltar (indisponível enquanto a operação é enviada)" : "Voltar"}
      >
        <Icon name="chevronLeft" size={24} />
      </button>
      <span className="flow-title">{title}</span>
      {step && (
        <span className="steps" role="img" aria-label={`Passo ${step.at} de ${step.of}`}>
          {Array.from({ length: step.of }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
            <span key={i} className={i < step.at ? "step on" : "step"} />
          ))}
        </span>
      )}
    </header>
  );
}

const TABS: { route: Route; label: string; icon: IconName }[] = [
  { route: { name: "home" }, label: "Início", icon: "home" },
  { route: { name: "invest" }, label: "Investir", icon: "trendingUp" },
  { route: { name: "pay", mode: "qr" }, label: "Pagar", icon: "scan" },
  { route: { name: "activity" }, label: "Atividade", icon: "receipt" },
];

export function TabBar({ current }: { current: Route["name"] }) {
  return (
    <nav className="tabbar" aria-label="Navegação">
      {TABS.map((t) => {
        const on =
          current === t.route.name ||
          (t.route.name === "activity" && current === "receipt") ||
          (t.route.name === "invest" && current === "vault");
        return (
          <a key={t.label} href={hrefOf(t.route)} className="tab" aria-current={on ? "page" : undefined}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The pinned action area at the bottom of a flow screen; `note` says what the action needs or does. While its action works
 * (`busy`: true, or the name of the current phase), a wait past a few seconds says so here, in place of the note (T-042);
 * `progress` shows an operation's steps above it, where they are always in view.
 */
export function Dock({
  children,
  note,
  busy = false,
  wait = "prepare",
  progress,
}: {
  children: ReactNode;
  note?: ReactNode;
  busy?: boolean | string | null;
  wait?: WaitKind;
  progress?: ReactNode;
}) {
  const stage = useWaitStage(busy);
  return (
    <footer className="dock">
      {progress}
      {stage !== "now" ? <WaitText kind={wait} stage={stage} /> : note && <div className="dock-note">{note}</div>}
      {children}
    </footer>
  );
}

// --- waiting (T-042, DEC-059) ----------------------------------------------------------------------------------------

/**
 * What a wait is: a screen's data loading; preparing something (nothing has left the wallet); the wallet waiting for the
 * person; or an operation already with the network.
 */
export type WaitKind = "load" | "prepare" | "wallet" | "send";

const WAIT_WORDS: Record<WaitKind, Record<"slow" | "stuck", string>> = {
  load: {
    slow: "Ainda carregando. No modo de teste, a rede às vezes leva alguns segundos.",
    stuck: "Está demorando mais que o normal. Confira sua internet; se não carregar, volte e abra de novo.",
  },
  prepare: {
    slow: "Ainda preparando. Nada saiu da sua carteira.",
    stuck: "Está demorando mais que o normal. Nada saiu da sua carteira: pode esperar, ou voltar e tentar de novo.",
  },
  wallet: {
    slow: "Sua carteira está esperando você confirmar. Se ela não apareceu, procure em outra aba ou janela.",
    stuck: "Sua carteira ainda espera a confirmação. Se ela não apareceu, procure em outra aba ou janela.",
  },
  send: {
    slow: "A rede está registrando. No modo de teste, às vezes leva alguns segundos a mais.",
    stuck:
      "Está demorando mais que o normal. Sua operação já foi enviada: pode sair, o resultado aparece em Atividade.",
  },
};

/** The words for a wait that has run long, with a clock: it is still working, and what is safe. */
export function WaitText({ kind, stage }: { kind: WaitKind; stage: Exclude<WaitStage, "now"> }) {
  return (
    <p className="wait-note" role="status">
      <Icon name="clock" size={16} className="wait-note-icon" />
      <span>{WAIT_WORDS[kind][stage]}</span>
    </p>
  );
}

/** A wait's note on the page itself (for waits without a dock): nothing at first, then the words. */
export function WaitNote({ wait, kind }: { wait: boolean | string | null; kind: WaitKind }) {
  const stage = useWaitStage(wait);
  return stage === "now" ? null : <WaitText kind={kind} stage={stage} />;
}

/**
 * A screen's content loading: placeholders shaped like it that visibly move, the name of what is loading for screen
 * readers, and the note if it takes long. `quiet` leaves the note to another placeholder on the same screen.
 */
export function Loading({ label, children, quiet }: { label: string; children: ReactNode; quiet?: boolean }) {
  return (
    <div className="loading" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div aria-hidden="true" className="loading-shape">
        {children}
      </div>
      {!quiet && <WaitNote wait kind="load" />}
    </div>
  );
}

/**
 * An operation's steps while it runs (confirm in the wallet, send, record): done ones checked, the current one turning
 * (or the wallet, when it is the person's turn), the rest waiting. Lives in the dock, so it is always in view.
 */
export function OpSteps({ steps, at, yourTurn }: { steps: string[]; at: number; yourTurn?: boolean }) {
  return (
    <ol className="op-steps" aria-label="Andamento">
      {steps.map((label, i) => {
        const state = i < at ? "done" : i === at ? (yourTurn ? "turn" : "now") : "next";
        return (
          <li key={label} className={`op-step ${state}`} aria-current={i === at ? "step" : undefined}>
            <span className="op-dot" aria-hidden="true">
              {state === "done" ? (
                <Icon name="check" size={12} />
              ) : state === "turn" ? (
                <Icon name="wallet" size={12} />
              ) : state === "now" ? (
                <span className="op-spin" />
              ) : null}
            </span>
            <span className="op-label">
              {label}
              {state === "done" && <span className="sr-only"> (feito)</span>}
              {state === "now" && <span className="sr-only"> (agora)</span>}
              {state === "turn" && <span className="sr-only"> (sua vez)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** An inline note: info (neutral), pending (amber: check this), danger (red: it went wrong). */
export function Notice({ tone, children }: { tone: "info" | "danger" | "pending"; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={tone === "info" ? "info" : "alert"} size={18} className="notice-icon" />
      <span>{children}</span>
    </p>
  );
}

/** Loading a list: rows at their real height with bars where values land, moving (T-042). */
export function SkeletonRows({
  lines = 3,
  label = "Carregando",
  quiet,
}: {
  lines?: number;
  label?: string;
  quiet?: boolean;
}) {
  return (
    <Loading label={label} {...(quiet ? { quiet } : {})}>
      <ul className="rows">
        {Array.from({ length: lines }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <li key={i} className="row">
            <span className="avatar bar" />
            <span className="row-main">
              <span className="bar" style={{ width: "55%", height: 16 }} />
              <span className="bar" style={{ width: "35%", height: 12, marginTop: 6 }} />
            </span>
            <span className="bar" style={{ width: 72, height: 16 }} />
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** A thin bar of shares (the review and receipt), with the same colours as the legend under it. */
export function ShareBar({ parts, label }: { parts: { key: string; weight: number; color: string }[]; label: string }) {
  return (
    <div className="sharebar" role="img" aria-label={label}>
      {parts
        .filter((p) => p.weight > 0)
        .map((p) => (
          <span key={p.key} style={{ flexGrow: p.weight, background: p.color }} />
        ))}
    </div>
  );
}

/** "Detalhes": what most people never need, one tap away (ids, the exact operation lines). */
export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="details">
      <summary>
        <span>{summary}</span>
        <Icon name="chevronDown" size={18} className="details-chevron" />
      </summary>
      <div className="details-body">{children}</div>
    </details>
  );
}
