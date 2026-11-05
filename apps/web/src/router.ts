// Hash routes, so a refresh or the back button keeps the user where they were (T-023). The API serves the app at `/`.
// T-026: investing, adding money, help, and a page for an address that doesn't exist. Moving between pages runs as a view
// transition where the browser has them (motion.ts).
import { useEffect, useRef, useState } from "react";
import { withTransition } from "./motion.ts";

export type Route =
  | { name: "home" }
  | { name: "pay"; mode: "qr" | "key" }
  | { name: "activity" }
  | { name: "receipt"; id: string }
  | { name: "account" }
  | { name: "invest" }
  | { name: "vault"; id: string }
  | { name: "tesouro" }
  | { name: "add" }
  | { name: "help" }
  | { name: "notfound" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const receipt = /^\/activity\/(ext_[0-9a-f]{20})$/.exec(path);
  if (receipt?.[1]) return { name: "receipt", id: receipt[1] };
  const vault = /^\/invest\/(C[A-Z2-7]{55})$/.exec(path);
  if (vault?.[1]) return { name: "vault", id: vault[1] };
  switch (path) {
    case "/":
      return { name: "home" };
    case "/invest/tesouro":
      return { name: "tesouro" };
    case "/pay":
      return { name: "pay", mode: "qr" };
    case "/pay/key":
      return { name: "pay", mode: "key" };
    case "/activity":
    case "/account":
    case "/invest":
    case "/add":
    case "/help":
      return { name: path.slice(1) as "activity" | "account" | "invest" | "add" | "help" };
    default:
      return { name: "notfound" };
  }
}

export function hrefOf(r: Route): string {
  switch (r.name) {
    case "home":
    case "notfound":
      return "#/";
    case "receipt":
      return `#/activity/${r.id}`;
    case "vault":
      return `#/invest/${r.id}`;
    case "tesouro":
      return "#/invest/tesouro";
    case "pay":
      return r.mode === "key" ? "#/pay/key" : "#/pay";
    default:
      return `#/${r.name}`;
  }
}

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const href = hrefOf(r);
  if (opts.replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const shown = useRef(location.hash);
  useEffect(() => {
    // The back button fires popstate and hashchange: one page change, one transition.
    const on = () => {
      if (location.hash === shown.current) return;
      shown.current = location.hash;
      withTransition(() => {
        setRoute(parseRoute(location.hash));
        window.scrollTo({ top: 0 });
      });
    };
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return route;
}
