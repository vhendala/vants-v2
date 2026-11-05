// Motion (T-026), after the taste skill's motion reference: short, ease-out, and only where it explains something. Pages
// cross-fade and rise (a view transition); a balance counts up to its value once; lists enter in a quick stagger (CSS).
// With "reduce motion" on, everything lands at once.
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type DocumentWithTransitions = Document & { startViewTransition?: (update: () => void) => unknown };

/** Runs a page change inside a view transition when the browser has them; otherwise just runs it. */
export function withTransition(update: () => void): void {
  const doc = document as DocumentWithTransitions;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/** The number shown while counting up to `target` (once per mount; later changes snap). */
export function useCountUp(target: number | null, ms = 700): number | null {
  const [shown, setShown] = useState<number | null>(target === null || reducedMotion() ? target : 0);
  const done = useRef(false);
  useEffect(() => {
    if (target === null) return;
    if (done.current || reducedMotion()) {
      setShown(target);
      return;
    }
    done.current = true;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(target * easeOutQuart(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return shown;
}

/**
 * True once `done` turns true while the screen is open (T-035): a payment that completes as you watch gets the success
 * moment; a receipt opened later, already paid, doesn't replay it.
 */
export function useJustCompleted(done: boolean): boolean {
  const atMount = useRef(done);
  const [just, setJust] = useState(false);
  useEffect(() => {
    if (done && !atMount.current) setJust(true);
  }, [done]);
  return just;
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/** `target`, counted up from zero once `active` turns on (T-035); otherwise the value itself. */
export function useCountTo(target: number, active: boolean, ms = 900, delay = 200): number {
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (!active || reducedMotion()) {
      setShown(target);
      return;
    }
    setShown(0);
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / ms));
      setShown(target * easeOutExpo(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, ms, delay]);
  return shown;
}
