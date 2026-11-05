// 4 Valor: how much, for a Pix key or a QR code without a fixed amount. Typed the way bank apps take money (each digit
// enters from the cents), on the app's own keypad or a keyboard, capped by what Vants can pay right now (GET /app/limits).
import { maskPixKey, PIX_KEY_LABEL, type PixKeyType } from "@vants/pix";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api.ts";
import { Button } from "../design/ds.tsx";
import { Keypad, TypedAmount, useCents } from "./Keypad.tsx";
import { centsToReais } from "../format.ts";
import { Dock, Initials, Notice } from "../ui.tsx";

export type AmountTarget =
  | { kind: "key"; key: string; keyType: PixKeyType }
  | { kind: "qr"; brCode: string; name?: string };

const MAX_CENTS = 99_999_999; // R$ 999.999,99: eight digits is plenty for a Pix here

export function Amount({
  target,
  onAmount,
  onChange,
}: {
  target: AmountTarget;
  onAmount: (amountBrl: string) => Promise<void>;
  onChange: () => void;
}) {
  const { cents, setCents, press } = useCents(MAX_CENTS);
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .limits()
      .then((l) => setLimit(Math.round(Number(l.maxBrl) * 100)))
      .catch(() => setLimit(null));
  }, []);

  const over = limit !== null && cents > limit;

  async function next() {
    setBusy(true);
    setError(null);
    try {
      await onAmount((cents / 100).toFixed(2));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "FLOAT_UNAVAILABLE"
          ? "A Vants não consegue pagar esse valor agora. Tente um valor menor."
          : err instanceof ApiError && err.code === "INVALID_PIX_KEY"
            ? `${err.message}. Volte e confira a chave.`
            : err instanceof ApiError && err.code === "AMOUNT_MISMATCH"
              ? "Esse QR code tem um valor fixo diferente."
              : err instanceof Error
                ? err.message
                : "Não foi possível continuar. Tente de novo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <main className="screen screen-dock">
        <div className="payee">
          <Initials name={target.kind === "key" ? "" : (target.name ?? "")} isKey={target.kind === "key"} />
          <span className="row-main">
            <span className="row-title">
              {target.kind === "key" ? maskPixKey(target.keyType, target.key) : (target.name ?? "Recebedor do QR")}
            </span>
            <span className="row-sub">
              {target.kind === "key" ? `Chave Pix · ${PIX_KEY_LABEL[target.keyType]}` : "QR code sem valor definido"}
            </span>
          </span>
          <button type="button" className="link-btn small" onClick={onChange}>
            Alterar
          </button>
        </div>

        <section className="amount" aria-labelledby="amt">
          <h1 id="amt" className="sr-only">
            Quanto enviar
          </h1>
          <TypedAmount cents={cents} />
          <p className="small muted">{limit === null ? "" : `Até ${centsToReais(limit)} por Pix agora`}</p>
          <div className="chips" style={{ justifyContent: "center", marginTop: 8 }}>
            {[5000, 10000, 20000].map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={cents === v} onClick={() => setCents(v)}>
                {centsToReais(v).replace(",00", "")}
              </button>
            ))}
          </div>
        </section>

        {over && <Notice tone="pending">A Vants paga até {centsToReais(limit ?? 0)} por Pix agora.</Notice>}
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
          {busy ? "Calculando o preço" : "Continuar"}
        </Button>
      </Dock>
    </>
  );
}
