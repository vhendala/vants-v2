// Entrar (T-026; T-030; T-044; T-045): the photograph of paying at a café counter, darkened, printed edge to edge across the
// top; on the ink below it, what Vants does in one large line, three promises as a printed list, and the wallet. Sign-in is SEP-10 (DEC-011): the wallet signs a challenge that can't move funds. A returning user whose
// wallet the kit remembers continues with one tap.
import { Networks, WebAuth } from "@stellar/stellar-sdk";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button, Icon, Logo } from "../design/ds.tsx";
import { short } from "../format.ts";
import { PHOTOS } from "../photos/index.ts";
import { Notice, TestChip, WaitNote } from "../ui.tsx";
import { connect, remembered, sign, walletConnectOn } from "../wallet.ts";

/** SEP-10: before signing, check the challenge comes from the server stellar.toml names (its SIGNING_KEY). */
async function verifyChallenge(xdr: string): Promise<void> {
  const toml = await (await fetch("/.well-known/stellar.toml")).text();
  const key = /^SIGNING_KEY="([^"]+)"/m.exec(toml)?.[1];
  if (!key) throw new Error("stellar.toml sem SIGNING_KEY");
  WebAuth.readChallengeTx(xdr, key, Networks.TESTNET, location.host, location.host);
}

export function Welcome({ onSignedIn }: { onSignedIn: (account: string, token: string) => void }) {
  // Each sign-in step has its own words (T-042): the wallet opening, the access being prepared, the person's turn in the
  // wallet, then entering.
  const [step, setStep] = useState<"idle" | "connecting" | "preparing" | "signing" | "entering">("idle");
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<{ address: string; wallet: string } | null>(null);

  useEffect(() => {
    void remembered().then(setKnown);
  }, []);

  async function signIn(address?: string) {
    setError(null);
    try {
      setStep("connecting");
      const account = address ?? (await connect());
      setStep("preparing");
      const { transaction } = await api.challenge(account);
      await verifyChallenge(transaction);
      setStep("signing");
      const signed = await sign(transaction, account);
      setStep("entering");
      const { token } = await api.token(signed);
      onSignedIn(account, token);
    } catch (err) {
      setStep("idle");
      const msg = err instanceof Error ? err.message : "";
      setError(
        /reject|cancel|denied|declined|closed/i.test(msg) || !msg
          ? "Conexão cancelada na carteira. Tente de novo quando quiser."
          : msg,
      );
    }
  }

  const busy = step !== "idle";
  const working =
    step === "connecting"
      ? "Abrindo a carteira"
      : step === "preparing"
        ? "Preparando o acesso"
        : step === "signing"
          ? "Confirme na carteira"
          : "Entrando";
  return (
    <div className="welcome">
      <WelcomeMedia />
      <header className="welcome-top">
        <Logo height={26} tone="reverse" />
        <TestChip />
      </header>

      <section className="welcome-body">
        <h1>Pague qualquer Pix com a sua carteira</h1>
        <p className="lede">Com dólar digital, lumens ou o que você investiu.</p>
        <ul className="promises">
          <li>
            <Icon name="scan" size={20} />
            <span>QR code ou chave Pix, em uma confirmação</span>
          </li>
          <li>
            <Icon name="wallet" size={20} />
            <span>O dinheiro fica com você até a hora de pagar</span>
          </li>
          <li>
            <Icon name="undo" size={20} />
            <span>Se o Pix não sair, o valor volta sozinho</span>
          </li>
        </ul>

        <div className="welcome-actions">
          {step === "signing" && (
            <Notice tone="info">
              Confirme na carteira para entrar. Isso só prova que a conta é sua: nada é enviado.
            </Notice>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {known ? (
            <>
              <Button size="lg" block onClick={() => signIn(known.address)} disabled={busy} aria-busy={busy}>
                {busy ? working : `Continuar com ${known.wallet}`}
              </Button>
              <Button variant="ghost" block className="welcome-ghost" onClick={() => signIn()} disabled={busy}>
                Usar outra carteira
              </Button>
            </>
          ) : (
            <Button size="lg" block onClick={() => signIn()} disabled={busy} aria-busy={busy}>
              {busy ? working : "Conectar carteira"}
            </Button>
          )}
          <WaitNote wait={busy ? step : null} kind={step === "signing" || step === "connecting" ? "wallet" : "load"} />
          <p className="fine center welcome-fine">
            {known
              ? `Conta ${short(known.address, 4, 4)}`
              : walletConnectOn
                ? "Funciona com LOBSTR, Freighter, xBull e outras carteiras Stellar, também pelo WalletConnect"
                : "Funciona com LOBSTR, Freighter, xBull e outras carteiras Stellar"}
          </p>
        </div>
      </section>
    </div>
  );
}

/** The welcome photograph (T-031): darkened and printed across the top, with a hard edge to the ink (T-045). */
function WelcomeMedia() {
  const w = PHOTOS.welcome;
  return (
    <img
      className="welcome-media"
      src={w.src}
      width={w.width}
      height={w.height}
      alt={w.alt}
      style={{ objectPosition: w.focus }}
      fetchPriority="high"
    />
  );
}
