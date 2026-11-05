// The signed-in session, kept on the device so the app stays connected between visits (T-023, DEC-035). The token only
// reads and plans: every payment still needs the wallet's signature (INV-09), so keeping it in localStorage risks privacy
// (someone with the device sees the history), never funds. The wallet kit keeps its own choice of wallet the same way.

export interface Session {
  account: string;
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

const KEY = "vants.session";

function decodeExp(token: string): number {
  try {
    const claims = JSON.parse(atob((token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.exp === "number" ? claims.exp : 0;
  } catch {
    return 0;
  }
}

export function sessionFrom(account: string, token: string): Session {
  return { account, token, expiresAt: decodeExp(token) };
}

/** The stored session, if it has at least a minute left. */
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (typeof s.account !== "string" || typeof s.token !== "string") return null;
    return s.expiresAt - Date.now() / 1000 > 60 ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode or blocked storage: the session lasts as long as the tab
  }
}
