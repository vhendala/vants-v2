// The one way to type an amount (T-026 review): digits enter from the cents, the way bank apps take money, on the app's own
// keypad or a keyboard. Used for a Pix, investing, taking out and adding money.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../design/ds.tsx";

/** Cents typed so far, and the key handler; physical keys work too (unless an input has focus). */
export function useCents(max = 99_999_999, initial = 0) {
  const [cents, setCents] = useState(initial);
  const press = useCallback(
    (k: string) =>
      setCents((c) => {
        if (k === "back") return Math.floor(c / 10);
        const next = c * (k === "00" ? 100 : 10) + (k === "00" ? 0 : Number(k));
        return next > max ? c : next;
      }),
    [max],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);
  return { cents, setCents, press };
}

export function Keypad({ onPress }: { onPress: (k: string) => void }) {
  return (
    <fieldset className="keypad">
      <legend className="sr-only">Teclado</legend>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((k) => (
        <button key={k} type="button" onClick={() => onPress(k)}>
          {k}
        </button>
      ))}
      <button type="button" onClick={() => onPress("back")} aria-label="Apagar">
        <Icon name="backspace" size={24} />
      </button>
    </fieldset>
  );
}

/** The amount as typed: "R$ 1.234" with ",56" stepped back, and a caret. `prefix`/`suffix` name the unit. */
export function TypedAmount({ cents, prefix = "R$", suffix }: { cents: number; prefix?: string; suffix?: string }) {
  const whole = Math.floor(cents / 100).toLocaleString("pt-BR");
  const frac = String(cents % 100).padStart(2, "0");
  return (
    <p className="t-hero" aria-live="polite">
      {prefix ? `${prefix} ` : ""}
      {whole}
      <span className="cents">,{frac}</span>
      <span className="caret" aria-hidden="true" />
      {suffix ? <span className="cents"> {suffix}</span> : null}
    </p>
  );
}
