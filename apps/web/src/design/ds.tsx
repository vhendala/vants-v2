// Vants components (first ported from the Vants design system artifact in T-023; restyled for direction A in T-044,
// DEC-060): the wordmark, buttons and status words, with `vt-*` classes styled by `ds.css`. Icons are Lucide geometry at a
// 1.75 stroke.
import type { ButtonHTMLAttributes, ReactNode } from "react";

const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

const ICONS = {
  // the design system's set
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  arrowUpRight: "M7 17 17 7M7 7h10v10",
  plus: "M12 5v14M5 12h14",
  chevronDown: "m6 9 6 6 6-6",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  shield:
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  clock: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  // Lucide, for the app
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  receipt:
    "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11",
  scan: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  wallet:
    "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",
  refresh:
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5",
  logOut: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  alert: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01",
  camera:
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  clipboard:
    "M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2",
  trendingUp: "M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  swap: "M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11",
  key: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4zM16.5 7.5h.01",
  backspace:
    "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM12 9l6 6M18 9l-6 6",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  arrowDownLeft: "M17 7 7 17M17 17H7V7",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  star: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  /** Accessible name; omit for decorative icons. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      className={cx("vt-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The V of Vants drawn as the tick of "pago" (T-044, DEC-060): one stroke, the letter and the confirmation at once. */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cx("vt-logo-mark", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 7.5 10 19 20.5 3.5" pathLength={1} />
    </svg>
  );
}

/** The wordmark: the mark and "vants" in Archivo Condensed. `height` is its type size; `reverse` on the ink slab. */
export function Logo({
  tone = "auto",
  height = 24,
  className,
}: {
  tone?: "auto" | "reverse" | "mono";
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={cx("vt-logo", `vt-logo--${tone}`, className)}
      style={{ fontSize: height }}
      role="img"
      aria-label="Vants"
    >
      <Mark size={Math.round(height * 0.92)} />
      <span aria-hidden="true">vants</span>
    </span>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  iconLeft,
  iconRight,
  block,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "yield" | "inverse";
  size?: "sm" | "md" | "lg";
  iconLeft?: IconName | undefined;
  iconRight?: IconName | undefined;
  /** Full width (the app's pinned actions). */
  block?: boolean;
}) {
  const iconSize = size === "lg" ? 20 : 18;
  return (
    <button
      type={type}
      className={cx("vt-btn", `vt-btn--${variant}`, `vt-btn--${size}`, block && "vt-btn--block", className)}
      {...rest}
    >
      {iconLeft && <Icon name={iconLeft} size={iconSize} />}
      <span>{children}</span>
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

/** One to three words of status. The word carries it; the tone reinforces it. */
export function Badge({
  tone = "neutral",
  dot,
  code,
  children,
}: {
  tone?: "neutral" | "accent" | "yield" | "danger" | "pending";
  dot?: boolean;
  code?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx("vt-badge", `vt-badge--${tone}`, code && "vt-badge--code")}>
      {dot && <span className="vt-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
