// 3b Chave Pix: type or paste the key; its kind is detected as you type (the type chips only appear to change it), checked by
// the same rules the API enforces (@vants/pix), and the keys paid before are one tap away.
import { detectPixKeyType, maskPixKey, normalizePixKey, PIX_KEY_LABEL, type PixKeyType } from "@vants/pix";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { Button, Icon } from "../design/ds.tsx";
import { dayLabel, reais } from "../format.ts";
import { Dock, Initials } from "../ui.tsx";

const TYPES: PixKeyType[] = ["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"];

/** The QR code / Chave Pix switch at the top of the first pay step. */
export function ModeSwitch({ mode, onMode }: { mode: "qr" | "key"; onMode: (m: "qr" | "key") => void }) {
  return (
    <fieldset className="segmented">
      <legend className="sr-only">Como pagar</legend>
      <button type="button" aria-pressed={mode === "qr"} onClick={() => onMode("qr")}>
        QR code
      </button>
      <button type="button" aria-pressed={mode === "key"} onClick={() => onMode("key")}>
        Chave Pix
      </button>
    </fieldset>
  );
}

interface Recent {
  key: string;
  keyType: PixKeyType;
  amountBrl: string;
  at: string;
}

export function PixKey({
  onKey,
  onMode,
}: {
  onKey: (key: string, keyType: PixKeyType) => void;
  onMode: (m: "qr" | "key") => void;
}) {
  const [raw, setRaw] = useState("");
  const [chosen, setChosen] = useState<PixKeyType | null>(null);
  const [picking, setPicking] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);

  useEffect(() => {
    api
      .exits({ limit: 50 })
      .then((page) => {
        const seen = new Set<string>();
        const keys: Recent[] = [];
        for (const e of page.items) {
          const d = e.payment.quote.destination;
          if (d.type !== "pix_key" || seen.has(d.key)) continue;
          seen.add(d.key);
          keys.push({ key: d.key, keyType: d.keyType, amountBrl: e.payment.quote.amountBrl, at: e.createdAt });
        }
        setRecent(keys.slice(0, 3));
      })
      .catch(() => setRecent([]));
  }, []);

  const detected = useMemo(() => detectPixKeyType(raw), [raw]);
  const type = chosen ?? detected;
  const check = type && raw.trim() ? normalizePixKey(type, raw) : null;

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setRaw(text);
        setChosen(null);
      }
    } catch {
      document.getElementById("pixkey")?.focus();
    }
  }

  return (
    <>
      <main className="screen screen-dock">
        <ModeSwitch mode="key" onMode={onMode} />

        <section className="section" aria-label="Chave Pix">
          <label htmlFor="pixkey" className="field-label" style={{ marginBottom: 6 }}>
            Chave Pix de quem recebe
          </label>
          <div className="input-row">
            <input
              id="pixkey"
              className="text-input"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setChosen(null);
              }}
              placeholder="CPF, CNPJ, e-mail, celular ou aleatória"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="pixkey-status"
            />
            <button type="button" className="icon-btn" onClick={paste} aria-label="Colar">
              <Icon name="clipboard" size={20} />
            </button>
          </div>
          <p
            id="pixkey-status"
            className={check && !check.ok ? "hint hint-bad" : check?.ok ? "hint hint-ok" : "hint"}
            aria-live="polite"
            style={{ marginTop: 8 }}
          >
            {!raw.trim() ? (
              "O tipo da chave é reconhecido enquanto você digita."
            ) : check?.ok ? (
              <>
                <Icon name="check" size={16} /> {PIX_KEY_LABEL[type ?? "EMAIL"]}
                {!picking && (
                  <>
                    {" · "}
                    <button type="button" className="link-btn" onClick={() => setPicking(true)}>
                      Não é {PIX_KEY_LABEL[type ?? "EMAIL"].toLowerCase()}?
                    </button>
                  </>
                )}
              </>
            ) : check ? (
              check.message
            ) : (
              "Escolha o tipo da chave"
            )}
          </p>
          {(picking || (raw.trim() && !type)) && (
            <fieldset style={{ marginTop: 12 }}>
              <legend className="sr-only">Tipo de chave</legend>
              <div className="chips">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="chip"
                    aria-pressed={type === t}
                    onClick={() => {
                      setChosen(t);
                      setPicking(false);
                    }}
                  >
                    {PIX_KEY_LABEL[t]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </section>

        {recent.length > 0 && (
          <section className="section" aria-labelledby="recent-keys">
            <h2 id="recent-keys" className="t-label">
              Chaves usadas antes
            </h2>
            <ul className="rows">
              {recent.map((r) => (
                <li key={r.key}>
                  <button type="button" className="row row-btn" onClick={() => onKey(r.key, r.keyType)}>
                    <Initials name="" isKey />
                    <span className="row-main">
                      <span className="row-title">{maskPixKey(r.keyType, r.key)}</span>
                      <span className="row-sub">
                        {PIX_KEY_LABEL[r.keyType]} · {reais(r.amountBrl)} {dayLabel(r.at).toLowerCase()}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={18} className="go" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Dock>
        <Button
          size="lg"
          block
          disabled={!check?.ok || !type}
          onClick={() => check?.ok && type && onKey(check.key, type)}
        >
          Continuar
        </Button>
      </Dock>
    </>
  );
}
