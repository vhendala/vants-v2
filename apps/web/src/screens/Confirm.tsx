// Confirmar na carteira (T-026): any move that isn't a Pix — investing, taking money out, letting the wallet receive an
// asset — shown in plain words before the wallet opens, then followed until the network settles it. Same rule as a payment:
// one transaction, exactly the one shown (the server refuses any other).
import { type ReactNode, useEffect, useState } from "react";
import { type Action, api, ApiError } from "../api.ts";
import { Button } from "../design/ds.tsx";
import { afterAction } from "../store.ts";
import { Dock, Notice, OpSteps, type WaitKind } from "../ui.tsx";
import { useNavLock, useWaitStage } from "../wait.ts";
import { sign } from "../wallet.ts";

export type ConfirmState = "idle" | "signing" | "sending" | "settling" | "done" | "failed";

/** Signs and submits an action, then waits for the network. */
export function useConfirm(action: Action | null, account: string) {
  const [state, setState] = useState<ConfirmState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "settling" || !action) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await api.action(action.id);
        if (!alive) return;
        if (v.status === "done") {
          afterAction(); // the balances moved (T-040)
          return setState("done");
        }
        if (v.status === "failed") {
          setError("A rede não concluiu esta operação. Nada saiu da sua carteira.");
          return setState("failed");
        }
      } catch {
        // offline for a moment: keep asking
      }
      timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [state, action]);

  async function confirm() {
    if (!action) return;
    setError(null);
    try {
      setState("signing");
      const signed = await sign(action.transaction.xdr, account);
      setState("sending");
      await api.submitAction(action.id, signed);
      setState("settling");
    } catch (err) {
      setState("idle");
      setError(
        err instanceof ApiError && err.code === "ACTION_EXPIRED"
          ? "O prazo para confirmar acabou. Volte e comece de novo."
          : err instanceof ApiError && err.code === "PLAN_MISMATCH"
            ? "A carteira devolveu uma operação diferente da combinada. Nada foi enviado."
            : err instanceof ApiError && err.code === "SUBMIT_FAILED"
              ? "A rede recusou a operação. Confira seu saldo e tente de novo."
              : err instanceof ApiError && err.code === "OFFLINE"
                ? err.message
                : "Você não confirmou na carteira. Nada foi enviado.",
      );
    }
  }

  return { state, error, confirm };
}

/** The deadline to confirm, ticking. */
export function useDeadline(maxTime: number | undefined) {
  const [left, setLeft] = useState(() => (maxTime ?? 0) - Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!maxTime) return;
    const t = setInterval(() => setLeft(maxTime - Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [maxTime]);
  return left;
}

/** An operation's phases, as the person lives them: their wallet, then the network. */
export type OpPhase = "signing" | "sending" | "settling";

/** An action's steps: confirm in the wallet, send it, the network records it. */
export const ACTION_STEPS = ["Confirmar na sua carteira", "Enviar à rede", "Registrar na rede"];

/**
 * The dock while an operation runs (T-042): its steps in view, the wait's words if it runs long, and no way back while it
 * is being sent (leaving wouldn't cancel it). Past half a minute recording, the way back opens again: the operation is with
 * the network, and Atividade will show how it ended.
 */
export function useOpDock(phase: OpPhase | null, steps: string[] = ACTION_STEPS) {
  const stage = useWaitStage(phase);
  useNavLock(phase === "sending" || (phase === "settling" && stage !== "stuck"));
  const wait: WaitKind = phase === "signing" ? "wallet" : "send";
  return {
    busy: phase,
    wait,
    progress: phase ? (
      <OpSteps
        steps={steps}
        at={phase === "signing" ? 0 : phase === "sending" ? 1 : 2}
        yourTurn={phase === "signing"}
      />
    ) : undefined,
  };
}

/** The phase of a confirmation, or null when nothing runs. */
export const phaseOf = (state: ConfirmState): OpPhase | null =>
  state === "signing" || state === "sending" || state === "settling" ? state : null;

/** What the wallet will be asked to confirm, in the words the server wrote for it. */
export function ConfirmPanel({
  action,
  heading,
  children,
  account,
  cta,
  onDone,
}: {
  action: Action;
  heading: string;
  children?: ReactNode;
  account: string;
  cta: string;
  onDone: () => void;
}) {
  const { state, error, confirm } = useConfirm(action, account);
  const left = useDeadline(action.transaction.maxTime);
  const expired = left <= 0 && state === "idle";

  useEffect(() => {
    if (state === "done") onDone();
  }, [state, onDone]);

  const busy = state === "signing" || state === "sending" || state === "settling";
  const op = useOpDock(phaseOf(state));
  return (
    <>
      <main className="screen screen-dock">
        <section>
          <h1 className="t-title">{heading}</h1>
          {children}
        </section>
        <section className="section" aria-labelledby="what">
          <h2 id="what" className="t-label" style={{ marginBottom: 12 }}>
            Sua carteira vai mostrar
          </h2>
          <ul className="ops">
            {action.transaction.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        {/* Once confirmed in the wallet, the deadline no longer matters: the steps in the dock take over (T-042). */}
        {state !== "sending" && state !== "settling" && (
          <dl className="facts">
            <div>
              <dt>Prazo para confirmar</dt>
              <dd className="money">
                {left <= 0 ? "expirou" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
              </dd>
            </div>
          </dl>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </main>
      <Dock {...op}>
        <Button size="lg" block onClick={confirm} disabled={expired || busy} aria-busy={busy}>
          {state === "signing"
            ? "Confirme na carteira"
            : state === "sending" || state === "settling"
              ? "Registrando"
              : expired
                ? "Prazo expirado"
                : cta}
        </Button>
      </Dock>
    </>
  );
}
