// Pagar Pix (canvas rows 2 and 3): one flow for both ways to pay.
//   QR code    3a scan or paste → (4 amount, only when the code has none) → 5 split → 6a review → receipt
//   Pix key    3b key           → 4 amount                                 → 5 split → 6b review → receipt
// The receipt takes over once the transaction is submitted. When the split takes lumens invested that must come out of the
// vault first (T-026, DEC-043), a "Resgatar" confirmation comes between the split and the review.
import { parseBrCode } from "@vants/pix";
import { useState } from "react";
import {
  type Action,
  api,
  ApiError,
  type Destination,
  type Exit,
  type Pick,
  type PixKeyType,
  type Priced,
} from "../api.ts";
import { Button } from "../design/ds.tsx";
import { units } from "../format.ts";
import { unyieldFirst } from "../unyield.ts";
import { navigate } from "../router.ts";
import { Dock, FlowHeader, Notice, payeeOfDestination } from "../ui.tsx";
import { Amount, type AmountTarget } from "./Amount.tsx";
import { ConfirmPanel } from "./Confirm.tsx";
import { PixKey } from "./PixKey.tsx";
import { Review } from "./Review.tsx";
import { Scan } from "./Scan.tsx";
import { type ChosenSource, Split } from "./Split.tsx";

type Stage =
  | { name: "start" }
  | { name: "amount"; target: AmountTarget }
  | { name: "split"; dest: Destination; priced: Priced; target?: AmountTarget }
  | {
      name: "unyield";
      dest: Destination;
      priced: Priced;
      target?: AmountTarget;
      action: Action;
      lumens: string;
      picks: Pick[];
      sources: ChosenSource[];
      error?: string;
    }
  | { name: "review"; dest: Destination; priced: Priced; target?: AmountTarget; exit: Exit; sources: ChosenSource[] };

export function Pay({ account, mode }: { account: string; mode: "qr" | "key" }) {
  const [stage, setStage] = useState<Stage>({ name: "start" });

  // Always four steps (who, how much, from where, review); a QR code with a fixed amount skips the second.
  const of = 4;
  const at = stage.name === "start" ? 1 : stage.name === "amount" ? 2 : stage.name === "split" ? 3 : 4;

  const switchMode = (m: "qr" | "key") => navigate({ name: "pay", mode: m }, { replace: true });

  const back = () => {
    if (stage.name === "review" || stage.name === "unyield")
      setStage({
        name: "split",
        dest: stage.dest,
        priced: stage.priced,
        ...(stage.target ? { target: stage.target } : {}),
      });
    else if (stage.name === "split")
      setStage(stage.target ? { name: "amount", target: stage.target } : { name: "start" });
    else if (stage.name === "amount") setStage({ name: "start" });
    else navigate({ name: "home" });
  };

  const toSplit = async (dest: Destination, target?: AmountTarget) => {
    const priced = await api.price(dest);
    setStage({ name: "split", dest, priced, ...(target ? { target } : {}) });
  };

  const payee =
    stage.name === "split" || stage.name === "review" || stage.name === "unyield"
      ? payeeOfDestination(stage.dest, stage.priced, stage.target?.kind === "qr" ? stage.target.name : undefined)
      : null;

  return (
    <div className="app">
      <FlowHeader title="Pagar Pix" back={back} step={{ at, of }} />
      {stage.name === "start" &&
        (mode === "qr" ? (
          <Scan
            onMode={switchMode}
            onCode={async (brCode) => {
              try {
                await toSplit({ type: "br_code", brCode });
              } catch (err) {
                if (!(err instanceof ApiError && err.code === "AMOUNT_REQUIRED")) throw err;
                // A code without an amount (a "Pix copia e cola" for any value): ask for it, then price it.
                const parsed = parseBrCode(brCode);
                setStage({
                  name: "amount",
                  target: { kind: "qr", brCode, ...(parsed.ok ? { name: parsed.code.merchantName } : {}) },
                });
              }
            }}
          />
        ) : (
          <PixKey
            onMode={switchMode}
            onKey={(key: string, keyType: PixKeyType) =>
              setStage({ name: "amount", target: { kind: "key", key, keyType } })
            }
          />
        ))}
      {stage.name === "amount" && (
        <Amount
          target={stage.target}
          onChange={() => setStage({ name: "start" })}
          onAmount={(amountBrl) =>
            toSplit(
              stage.target.kind === "key"
                ? { type: "pix_key", key: stage.target.key, keyType: stage.target.keyType, amountBrl }
                : { type: "br_code", brCode: stage.target.brCode, amountBrl },
              stage.target,
            )
          }
        />
      )}
      {stage.name === "split" && payee && (
        <Split
          priced={stage.priced}
          payee={payee}
          fixedAmount={stage.dest.type === "br_code" && !stage.target}
          onPlan={async (picks, sources) => {
            const first = unyieldFirst(picks, stage.priced.portfolio.positions);
            if (first) {
              // The lumens come out of the vault first (one confirmation); the Pix is then paid from the wallet (another).
              const action = await api.redeem(first.vault, first.lumens);
              setStage({ ...stage, name: "unyield", action, lumens: first.lumens, picks: first.picks, sources });
              return;
            }
            const exit = await api.createExit(stage.dest, picks);
            setStage({ ...stage, name: "review", exit, sources });
          }}
        />
      )}
      {stage.name === "unyield" &&
        (stage.error ? (
          <>
            <main className="screen screen-dock">
              <h1 className="t-title">Os lumens já estão na sua carteira</h1>
              <Notice tone="danger">{stage.error}</Notice>
              <p className="lede">Nada foi pago. Volte e escolha de onde sai: os lumens agora aparecem como Lumens.</p>
            </main>
            <Dock>
              <Button size="lg" block onClick={back}>
                Escolher de novo
              </Button>
            </Dock>
          </>
        ) : (
          <ConfirmPanel
            action={stage.action}
            account={account}
            heading="Primeiro, resgate seus lumens"
            cta={`Resgatar ${units(stage.lumens, 2)} lumens`}
            onDone={async () => {
              try {
                const exit = await api.createExit(stage.dest, stage.picks);
                setStage({
                  name: "review",
                  dest: stage.dest,
                  priced: stage.priced,
                  ...(stage.target ? { target: stage.target } : {}),
                  exit,
                  sources: stage.sources,
                });
              } catch (err) {
                setStage({
                  ...stage,
                  error:
                    err instanceof ApiError && err.reason === "shortfall"
                      ? "O preço mudou e os lumens não cobrem mais o valor."
                      : "Não foi possível montar o Pix agora.",
                });
              }
            }}
          >
            <p className="lede">
              Para pagar pelo melhor preço, os lumens saem de Lumens que rendem para a sua carteira. Depois você
              confirma o Pix: são 2 confirmações. O que sobrar fica na sua carteira.
            </p>
          </ConfirmPanel>
        ))}
      {stage.name === "review" && payee && (
        <Review
          exit={stage.exit}
          payee={payee}
          sources={stage.sources}
          feeBrl={stage.priced.feeBrl}
          account={account}
          onSubmitted={() => navigate({ name: "receipt", id: stage.exit.id }, { replace: true })}
        />
      )}
    </div>
  );
}
