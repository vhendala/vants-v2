// The mini app (SPEC §3.5, §5.3; T-021, T-023, T-026): a session that survives reloads, four tabs (home, invest, pay,
// activity), adding money, the receipt, the account and help. Signed out, only the welcome screen shows.
import { useCallback, useEffect, useState } from "react";
import { setToken, whenUnauthorized } from "./api.ts";
import { navigate, useRoute } from "./router.ts";
import { Account } from "./screens/Account.tsx";
import { Activity } from "./screens/Activity.tsx";
import { AddMoney } from "./screens/AddMoney.tsx";
import { Help, NotFound } from "./screens/Help.tsx";
import { Home } from "./screens/Home.tsx";
import { Invest, TesouroPage, VaultPage } from "./screens/Invest.tsx";
import { Pay } from "./screens/Pay.tsx";
import { Receipt } from "./screens/Receipt.tsx";
import { Welcome } from "./screens/Welcome.tsx";
import { loadSession, type Session, saveSession, sessionFrom } from "./session.ts";
import { clearCaches } from "./store.ts";
import { TabBar } from "./ui.tsx";
import { disconnect, onWalletDisconnect } from "./wallet.ts";

export function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const s = loadSession();
    setToken(s?.token ?? null);
    return s;
  });
  const route = useRoute();

  const signOut = useCallback(async (opts: { wallet?: boolean } = { wallet: true }) => {
    setToken(null);
    saveSession(null);
    clearCaches(); // nothing of this account stays on the device (T-040)
    setSession(null);
    if (opts.wallet) await disconnect();
  }, []);

  useEffect(() => {
    // The session ended on the server (expired, or the secret rotated): back to the welcome screen, wallet remembered.
    whenUnauthorized(() => void signOut({ wallet: false }));
    return onWalletDisconnect(() => void signOut({ wallet: false }));
  }, [signOut]);

  const onSignedIn = useCallback((account: string, token: string) => {
    const s = sessionFrom(account, token);
    setToken(token);
    saveSession(s);
    setSession(s);
    navigate({ name: "home" }, { replace: true });
  }, []);

  if (!session) return <Welcome onSignedIn={onSignedIn} />;

  switch (route.name) {
    case "pay":
      // Switching between QR code and Pix key starts the flow over (a new mount per mode).
      return <Pay key={route.mode} account={session.account} mode={route.mode} />;
    case "receipt":
      return <Receipt exitId={route.id} />;
    case "account":
      return <Account session={session} onSignOut={() => void signOut()} />;
    case "vault":
      return <VaultPage key={route.id} id={route.id} account={session.account} />;
    case "tesouro":
      return <TesouroPage account={session.account} />;
    case "add":
      return <AddMoney account={session.account} />;
    case "help":
      return <Help />;
    case "notfound":
      return <NotFound />;
    default:
      return (
        <div className="app">
          {route.name === "activity" ? (
            <Activity account={session.account} />
          ) : route.name === "invest" ? (
            <Invest />
          ) : (
            <Home account={session.account} />
          )}
          <TabBar current={route.name} />
        </div>
      );
  }
}
