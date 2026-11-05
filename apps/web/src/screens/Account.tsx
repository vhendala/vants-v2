// Conta (T-026, reworked in the review): the wallet first (its name, the address shortened with copy), the session, the
// public record, help and the photo credits; disconnecting is a plain red action at the end, confirmed in place.
import { useState } from "react";
import { Button, Icon } from "../design/ds.tsx";
import { clock, dayLabel, explorerAccount, short } from "../format.ts";
import { PHOTOS } from "../photos/index.ts";
import { hrefOf, navigate } from "../router.ts";
import type { Session } from "../session.ts";
import { Details, FlowHeader, TestChip } from "../ui.tsx";
import { walletName } from "../wallet.ts";

export function Account({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(session.account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the address is in the public record link
    }
  }

  return (
    <div className="app">
      <FlowHeader title="Conta" back={() => (history.length > 1 ? history.back() : navigate({ name: "home" }))} />
      <main className="screen">
        <section className="me">
          <span className="avatar avatar-lg" aria-hidden="true">
            <Icon name="wallet" size={24} />
          </span>
          <span className="row-main">
            <span className="t-section">{walletName() ?? "Sua carteira"}</span>
            <span className="row-sub">Conectada à Vants</span>
          </span>
        </section>

        <dl className="facts">
          <div>
            <dt>Endereço</dt>
            <dd style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="id">{short(session.account, 4, 4)}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={copy}
                aria-label={copied ? "Endereço copiado" : "Copiar endereço"}
              >
                <Icon name={copied ? "check" : "copy"} size={18} />
              </button>
            </dd>
          </div>
          <div>
            <dt>Ambiente</dt>
            <dd>
              <TestChip />
            </dd>
          </div>
          <div>
            <dt>Conectada até</dt>
            <dd>
              {dayLabel(new Date(session.expiresAt * 1000).toISOString())},{" "}
              {clock(new Date(session.expiresAt * 1000).toISOString())}
            </dd>
          </div>
        </dl>

        <ul className="rows">
          <li>
            <a className="row" href={explorerAccount(session.account)} target="_blank" rel="noreferrer">
              <span className="row-main">
                <span className="row-title">Ver registro público</span>
                <span className="row-sub">Tudo o que a sua carteira fez na rede</span>
              </span>
              <Icon name="arrowUpRight" size={18} className="go" />
            </a>
          </li>
          <li>
            <a className="row" href={hrefOf({ name: "help" })}>
              <span className="row-main">
                <span className="row-title">Ajuda</span>
                <span className="row-sub">Perguntas frequentes</span>
              </span>
              <Icon name="chevronRight" size={18} className="go" />
            </a>
          </li>
        </ul>

        <Details summary="Créditos das imagens">
          <ul className="small muted" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.values(PHOTOS).map((p) => (
              <li key={p.source}>
                {p.alt}, por{" "}
                <a className="link" href={p.source} target="_blank" rel="noreferrer">
                  {p.author}
                </a>{" "}
                ({p.license}).
              </li>
            ))}
          </ul>
        </Details>

        <p className="small muted">
          A Vants nunca vê as chaves da sua carteira. Ela só lê seus saldos e prepara pagamentos; nada sai sem a sua
          confirmação.
        </p>

        <section className="section" aria-label="Desconectar">
          {leaving ? (
            <div className="dock-row">
              <Button variant="secondary" onClick={() => setLeaving(false)}>
                Cancelar
              </Button>
              <Button className="vt-btn--danger" onClick={onSignOut}>
                Desconectar
              </Button>
            </div>
          ) : (
            <button type="button" className="link-btn danger-link" onClick={() => setLeaving(true)}>
              <Icon name="logOut" size={18} />
              Desconectar esta carteira
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
