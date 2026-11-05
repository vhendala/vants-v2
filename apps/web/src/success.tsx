// The success moment (T-035; T-044): one signature for the end of every flow (a Pix paid, money invested or taken out,
// Tesouro bought or sold, money added by Pix). The result is a paper slip whose band prints in carimbo blue with the tick
// of the mark; the words follow in a short stagger. About 0.6 s, ease-out, nothing loops, glows or counts up. It plays when
// the completion happens on screen (`celebrate`); with reduced motion everything is simply there.
import { type CSSProperties, type ReactNode, useEffect } from "react";
import { Mark } from "./design/ds.tsx";
import { reducedMotion } from "./motion.ts";

/** Stagger index for the words that rise in after the band. */
export const rise = (i: number) => ({ className: "rise", style: { "--i": i } as CSSProperties });

/** A short tap on phones that have one, as the band lands (skipped with reduced motion). */
export function useSuccessHaptic(active: boolean) {
  useEffect(() => {
    if (!active || reducedMotion()) return;
    const t = setTimeout(() => navigator.vibrate?.(12), 300);
    return () => clearTimeout(t);
  }, [active]);
}

export function SuccessCard({
  title,
  value,
  format,
  detail,
  celebrate,
  children,
}: {
  title: string;
  /** The amount, printed as it is. */
  value: number;
  format: (n: number) => string;
  detail?: ReactNode;
  celebrate: boolean;
  /** Below the tear line: the steps, when the flow has them. */
  children?: ReactNode;
}) {
  useSuccessHaptic(celebrate);
  const a = rise(0);
  const d = rise(1);
  return (
    <article className={celebrate ? "slip celebrate" : "slip"} role="status" aria-labelledby="success-title">
      <header className="slip-band paid">
        <Mark size={20} />
        <h1 id="success-title" className="slip-title">
          {title}
        </h1>
      </header>
      <div className="slip-body">
        <p className={`t-hero ${a.className}`} style={a.style}>
          {format(value)}
        </p>
        {detail && (
          <p className={`secondary ${d.className}`} style={d.style}>
            {detail}
          </p>
        )}
        {children && (
          <>
            <hr className="tear" />
            {children}
          </>
        )}
      </div>
    </article>
  );
}
