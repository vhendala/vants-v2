// 6 Revisar (reworked in the T-026 review): who is paid and how much, where it comes from, the terms (fee, refund, deadline),
// then the wallet. The ONE transaction's exact lines are one tap away ("O que sua carteira vai mostrar"; PRODUCT.md: say
// exactly what will be signed). A key payment adds a check: no name is known before paying, so the key is what to confirm.
import { useEffect, useState } from "react";
import { api, ApiError, type Exit } from "../api.ts";
import { Button } from "../design/ds.tsx";
import { centsToReais, reais } from "../format.ts";
import { afterAction } from "../store.ts";
import { Details, Dock, Notice, type Payee, ShareBar } from "../ui.tsx";
import { sign } from "../wallet.ts";
import { useOpDock } from "./Confirm.tsx";
import type { ChosenSource } from "./Split.tsx";

const PAY_STEPS = ["Confirmar na sua carteira", "Enviar o pagamento"];

export function Review({
  exit,
  payee,
  sources,
  feeBrl,
  account,
  onSubmitted,
}: {
  exit: Exit;
  payee: Payee;
  sources: ChosenSource[];
  feeBrl: string;
  account: string;
  onSubmitted: () => void;
}) {
  const [left, setLeft] = useState(() => exit.transaction.maxTime - Math.floor(Date.now() / 1000));
  const [step, setStep] = useState<"idle" | "signing" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setLeft(exit.transaction.maxTime - Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [exit.transaction.maxTime]);

  const expired = left <= 0;
  // The payment's steps here; the receipt follows it from the moment it is sent (T-042).
  const op = useOpDock(step === "idle" ? null : step, PAY_STEPS);

  async function confirm() {
    setError(null);
    try {
      setStep("signing");
      const signed = await sign(exit.transaction.xdr, account);
      setStep("sending");
      await api.submit(exit.id, signed);
      afterAction(); // the money left the wallet (T-040)
      onSubmitted();
    } catch (err) {
      setStep("idle");
      setError(
        err instanceof ApiError && err.code === "EXIT_EXPIRED"
          ? "O prazo para confirmar acabou. Volte e monte o pagamento de novo."
          : err instanceof ApiError && err.code === "PLAN_MISMATCH"
            ? "A carteira devolveu uma operação diferente da combinada. Nada foi enviado."
            : err instanceof ApiError && err.code === "SUBMIT_FAILED"
              ? "A rede recusou o pagamento. Confira seu saldo e tente de novo."
              : err instanceof ApiError && err.code === "OFFLINE"
                ? err.message
                : "Você não confirmou na carteira. Nada foi enviado.",
      );
    }
  }

  const minutes = Math.max(0, Math.floor(left / 60));
  const seconds = String(Math.max(0, left % 60)).padStart(2, "0");
  const verb = payee.isKey ? "enviar" : "pagar";

  return (
    <>
      <main className="screen screen-dock">
        <section className="who">
          <p className="t-label">{payee.isKey ? "Pix para a chave" : "Pix para"}</p>
          <p className="who-name">{payee.title}</p>
          {payee.sub && <p className="small muted">{payee.sub}</p>}
          <p className="t-hero">{reais(exit.amountBrl)}</p>
        </section>

        {payee.isKey && (
          <Notice tone="pending">
            Confira a chave antes de confirmar. Um Pix enviado para a chave errada não volta sozinho.
          </Notice>
        )}

        {sources.length > 0 && (
          <section className="section" aria-labelledby="from">
            <h2 id="from" className="t-label">
              Sai de
            </h2>
            {sources.length > 1 && (
              <ShareBar
                label="Quanto sai de cada fonte"
                parts={sources.map((s) => ({ key: s.id, weight: s.cents, color: s.color }))}
              />
            )}
            <dl className="breakdown">
              {sources.map((s) => (
                <div key={s.id}>
                  <span className="swatch" style={{ background: s.color }} />
                  <dt>
                    {s.name}
                    {s.detail && <span className="breakdown-sub">{s.detail}</span>}
                  </dt>
                  <dd>{centsToReais(s.cents)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <dl className="facts">
          <div>
            <dt>Tarifa</dt>
            <dd>{feeBrl === "0.00" ? "Sem tarifa" : reais(feeBrl)}</dd>
          </div>
          <div>
            <dt>{payee.isKey ? "Se o Pix não sair" : "Se algo der errado"}</dt>
            <dd>O valor volta para a sua carteira</dd>
          </div>
          {step !== "sending" && (
            <div>
              <dt>Prazo para confirmar</dt>
              <dd className="money">{expired ? "Expirou" : `${minutes}:${seconds}`}</dd>
            </div>
          )}
        </dl>

        <Details summary="O que sua carteira vai mostrar">
          <ul className="ops">
            {exit.transaction.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Details>

        {error && <Notice tone="danger">{error}</Notice>}
      </main>
      <Dock {...op}>
        <Button size="lg" block onClick={confirm} disabled={expired || step !== "idle"} aria-busy={step !== "idle"}>
          {step === "signing"
            ? "Confirme na carteira"
            : step === "sending"
              ? "Enviando"
              : expired
                ? "Prazo expirado"
                : `Confirmar e ${verb} ${reais(exit.amountBrl)}`}
        </Button>
      </Dock>
    </>
  );
}
