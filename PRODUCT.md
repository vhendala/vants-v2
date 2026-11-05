# Product

## Register

product

## Users

Stellar holders in Brazil who want to spend what they hold, usually at a counter. The mini app opens inside their wallet
(LOBSTR, Freighter, xBull): phone in one hand, a merchant's Pix QR code in front of them, often with someone waiting. Less
often, at home, paying a bill or sending to someone. They already trust their wallet; they don't yet trust Vants, and they
are moving real money (on testnet for now, but the habits are the same).

The job: turn something they hold (USDC, XLM, a DeFindex vault position) into a paid Pix, in one signature, and know for
sure it was paid.

## Product Purpose

Vants pays any Pix QR code in Brazil from Stellar assets. The mini app is the consumer face of Vants Pay, the rail other
wallets plug into: scan or paste a code, see the price before choosing anything, pick what to pay from, sign once, and get a
receipt with the Pix end-to-end id and the on-chain transaction. Success is a payment that feels as quick and certain as
paying with a Brazilian bank app, from a Stellar wallet.

## Brand Personality

Calm, precise, honest. The voice of Wise or Nubank: plain numbers, quiet confidence, nothing hidden. Every estimate is
labelled as one, every fee is shown, and the app says exactly what the wallet is about to sign. pt-BR first, short sentences,
no jargon at the point of payment (shares, paths and hashes live one tap away, not in the way).

### Voice (T-026)

Vants never speaks crypto. Same words in every product (from `prfaq-vants.md`, `earlier-prototype/product.md`):
friendly, plain Portuguese; the brand verbs are Investir → Render → Pagar. The technical name is allowed only as a small second
line, for someone checking their wallet.

| Instead of | Say |
|------------|-----|
| USDC | Dólar digital (USDC in the small line) |
| XLM | Lumens |
| Cofre DeFindex, cotas, shares | Dólar que rende / Lumens que rendem; "investido", "resgatar" |
| Soroswap, path payment, swap | troca automática, "trocados na hora" |
| assinar a transação | confirmar na carteira; "1 operação" |
| Testnet | Modo de teste |
| Transação Stellar, hash | registro público |
| trustline | "deixe sua carteira receber dólar digital" (once) |
| non-custodial | o dinheiro fica com você, sob o seu controle |

Every yield is shown with "Rendimento passado não garante rendimento futuro" and where the number comes from.

### Look: "Comprovante" (T-044, DEC-060)

Everything reads as printed: a till slip, a bank comprovante, the stamp on it. The certainty at the end is the product, so
the whole app borrows the look of the thing that proves a payment.

- **Colour.** Receipt paper (the page), ink (text, rules, the slab) and carimbo blue, the ink of a rubber stamp, as the one
  brand colour: the primary action, the dollars that pay first, a paid receipt. Status keeps its own small marks (a green
  check, an amber dot, red for failure), always with the word.
- **Type.** Archivo only: condensed and heavy for money and titles (the balance, the amount to pay, a rate), normal width
  for everything people read. Money is the picture on every task screen.
- **The ink slab.** A screen's answer sits on a full-width ink block in paper type: the balance on Início with what it is
  made of, the rate on an investment.
- **Ledgers, not cards.** Lists and facts sit on the page, opened by a 2px ink rule, with hairlines between rows and dotted
  leaders from a label to its value. Corners are square (3px). Nothing at rest casts a shadow.
- **The slip.** The receipt and every success are a paper slip whose top band states the status in words: carimbo blue
  "Pix pago", ink while it is on its way, grey when the money came back, red when it failed.
- **Motion.** State only. A paid band prints in from the left and its tick draws itself; nothing glows, pulses or counts up.
- **Mark.** The V of Vants drawn as the tick of "pago", beside the name in Archivo Condensed.
- **One photograph** (T-045, DEC-061), on Welcome only: a hand paying with a phone at a café counter, darkened and printed
  edge to edge across the top with a hard edge to the ink (no fade). Below it, on the ink: one large line, three promises
  as a printed list, the wallet. Task screens carry no photos: the money is the picture there.

## Anti-references

- The neon-on-black crypto trading look: glows, gradients, "degen" energy.
- The generated-app look: soft grey page with white rounded cards, icons in tinted circles, a glowing success card, pill
  badges, numbers that count up (T-043: the human's reason for the redesign).
- Dense DeFi dashboards: APY tables, charts, protocol jargon, many decisions per screen.
- Navy-and-gold traditional banking: stiff, formal, distant.

## Design Principles

1. **Price first, then choose.** The amount in reais and what it costs are on screen before the user picks anything.
2. **One decision per screen at the counter.** Scan, pick, sign, done; detail is available, never in the way.
3. **Say exactly what will be signed.** The one transaction is described in plain words before the wallet opens; nothing
   surprises the user in their wallet.
4. **Honest numbers.** Estimates are labelled, unpriced positions can't be paid from, and every status is the real status.
5. **Certainty at the end.** The receipt is the product: paid, when, to whom, with ids a person can show a merchant.

## Accessibility & Inclusion

No specific standard was required. Baseline: legible in daylight on a phone, large tap targets for one-handed use,
contrast that holds for status colours (never colour alone for status), and reduced motion respected.

## Visual identity

Since T-044 (DEC-060) the look is direction A, "Comprovante", chosen by the human from three mockup directions (T-043) and
checked with tasteskill v2 app rules. It replaces the earlier Vants design system artifact, its palette, fonts, logo and
photograph. Tokens and components live in `apps/web/src/design/`; the system is written down in DESIGN.md. Light theme only.
