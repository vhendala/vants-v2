// 3a QR code (reworked in the T-026 review): the camera opens with the screen (at a counter, nobody should have to ask for
// it), or the "Pix copia e cola" is pasted and goes straight on. Typing a code by hand is one tap away.
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { Button } from "../design/ds.tsx";
import { Dock, Notice } from "../ui.tsx";
import { ModeSwitch } from "./PixKey.tsx";

export function Scan({
  onCode,
  onMode,
}: {
  onCode: (brCode: string) => Promise<void>;
  onMode: (m: "qr" | "key") => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "unavailable">(() =>
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
      ? "starting"
      : "unavailable",
  );
  const [pasted, setPasted] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  // The scanner callback lives as long as the camera; it reads the latest submit through this ref.
  const submitRef = useRef<(code: string) => Promise<void>>(async () => undefined);

  async function submit(code: string) {
    const brCode = code.trim();
    if (!brCode || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCode(brCode);
    } catch (err) {
      handled.current = false;
      setError(
        err instanceof ApiError && err.code === "INVALID_BR_CODE"
          ? "Esse não é um QR de Pix válido. Confira o código e tente de novo."
          : err instanceof ApiError && err.code === "FLOAT_UNAVAILABLE"
            ? "A Vants não consegue pagar esse valor agora. Tente um valor menor ou daqui a pouco."
            : err instanceof Error
              ? err.message
              : "Algo deu errado. Tente de novo.",
      );
    } finally {
      setBusy(false);
    }
  }
  submitRef.current = submit;

  /** A Pix code on the clipboard goes straight on; anything else opens the field to fix it. */
  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text.startsWith("000201")) {
        setPasted(text);
        await submit(text);
      } else {
        setManual(true);
        setPasted(text);
        setError(text ? "Isso não parece um código Pix. Confira e tente de novo." : "Não há nada copiado.");
      }
    } catch {
      setManual(true);
    }
  }

  // The camera runs while it is wanted ("starting" and then "on"). The effect must not depend on that step: when it did,
  // "starting" → "on" re-ran it, and its cleanup stopped the scanner the moment the camera came on (a blink, then black).
  const wanted = camera === "starting" || camera === "on";
  useEffect(() => {
    if (!wanted || !video.current) return;
    let scanner: { start(): Promise<void>; stop(): void; destroy(): void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !video.current) return;
        scanner = new QrScanner(
          video.current,
          (result) => {
            if (handled.current) return;
            handled.current = true;
            void submitRef.current(result.data);
          },
          { preferredCamera: "environment", highlightScanRegion: false, returnDetailedScanResult: true },
        );
        await scanner.start();
        if (!cancelled) setCamera((c) => (c === "starting" ? "on" : c));
      } catch {
        if (!cancelled) setCamera("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [wanted]);

  return (
    <>
      <main className="screen screen-dock">
        <ModeSwitch mode="qr" onMode={onMode} />

        <section className={busy ? "camera camera-read" : "camera"} aria-label="Câmera" aria-busy={busy}>
          {camera !== "off" && camera !== "unavailable" && <video ref={video} playsInline muted />}
          <svg className="camera-frame" viewBox="0 0 200 200" aria-hidden="true">
            <path d="M4 44V12a8 8 0 0 1 8-8h32M156 4h32a8 8 0 0 1 8 8v32M196 156v32a8 8 0 0 1-8 8h-32M44 196H12a8 8 0 0 1-8-8v-32" />
          </svg>
          {camera === "off" || camera === "unavailable" ? (
            <button type="button" className="camera-start" onClick={() => setCamera("starting")}>
              <span className="camera-hint">
                {camera === "unavailable" ? "Câmera indisponível: cole o código abaixo" : "Toque para abrir a câmera"}
              </span>
            </button>
          ) : (
            <span className="camera-hint" role="status">
              {busy ? "Código lido" : "Aponte para o QR do Pix"}
            </span>
          )}
        </section>

        <Button variant="secondary" size="lg" block iconLeft="clipboard" onClick={paste} disabled={busy}>
          Colar código Pix
        </Button>
        {manual ? (
          <section className="section" aria-label="Código Pix">
            <label htmlFor="brcode" className="field-label" style={{ marginBottom: 6 }}>
              Pix copia e cola
            </label>
            <textarea
              id="brcode"
              className="code-input"
              rows={3}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="00020126…"
              spellCheck={false}
              autoComplete="off"
            />
          </section>
        ) : (
          <button type="button" className="link-btn" style={{ alignSelf: "center" }} onClick={() => setManual(true)}>
            Digitar o código
          </button>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </main>
      {/* A code read by the camera or pasted shows the same working button as one typed (T-042). */}
      {(manual || busy) && (
        <Dock busy={busy}>
          <Button size="lg" block onClick={() => submit(pasted)} disabled={!pasted.trim() || busy} aria-busy={busy}>
            {busy ? "Calculando o preço" : "Continuar"}
          </Button>
        </Dock>
      )}
    </>
  );
}
