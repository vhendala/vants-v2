# Design: direction A, "Comprovante"

The Vants mini app's visual system (T-044, DEC-060). Everything reads as printed: receipt paper, ink, and the blue of a
rubber stamp. Product register; light theme only. Tokens: `apps/web/src/design/tokens.css`. Components:
`apps/web/src/design/ds.css`, `ds.tsx`, `apps/web/src/ui.tsx`, `success.tsx`. Screens: `apps/web/src/styles.css`.

## Colour

| Role | Token | Value | Use |
|------|-------|-------|-----|
| Page (paper) | `--bg` | oklch(95.6% 0.003 100) | every screen |
| Slip | `--bg-raised` | oklch(98.5% 0 0) | the receipt, notes, the payee |
| Ink | `--text`, `--bg-inverse` | oklch(17.5% 0.003 100) | text, ledger rules, the slab |
| Secondary / muted text | `--text-secondary`, `--text-muted` | oklch 38.5% / 46% | labels, sublines (≥ 4.5:1 on paper) |
| Hairline | `--line`, `--line-strong` | oklch 88.6% / 83.4% | rows, control borders |
| Carimbo blue | `--accent` | oklch(47% 0.215 266) | the one primary action, the dollars that pay first, a paid band |
| Blue on ink | `--accent-on-inverse` | oklch(74% 0.12 266) | the mark and dollars on the slab |
| Status | `--yield-text`, `--pending`, `--danger` | green 47%, amber 48%, red 52% | small marks beside the word |

Strategy: restrained, with committed moments. Ink and paper carry the screen; blue appears on one action and one data
element per screen; a screen's answer sits on an ink slab. No gradients, glows or tinted cards.

## Type

Archivo only (variable, self-hosted, OFL). `--font-display` is always set with `font-stretch: var(--stretch-display)`
(72%) at 800.

| Role | Size / line | Face |
|------|-------------|------|
| Hero money (`.t-hero`) | min(56px, 14vw) / 1, 60px on the balance | Condensed 800, tabular |
| Rate figure | min(64px, 16vw) / 1 | Condensed 800 |
| Page / payee title | 28–32px | Condensed 800 |
| Section title (`.t-section`) | 22 / 26 | Condensed 800 |
| Row value | 19 / 24 | Condensed 700 |
| Body | 16 / 24 | Archivo 400 |
| Label, subline | 13–14 / 18–20 | Archivo 500 |
| Fine print | 12 / 16 | Archivo 400 |

## Shapes and surfaces

- Corners: 3px everywhere (`--radius-sm`); circles only for people's initials and dots.
- No shadow at rest; `--shadow-float` only for what floats (the wallet modal).
- **Ledger** (`.rows`, `.facts`, `.breakdown`, `.move`): a 2px ink rule on top, 1px hairlines between rows, a hairline to
  close. Facts run a dotted leader from the label to the value.
- **Slab** (`.slab`): a full-width ink block for a screen's answer (the balance and its split; a rate).
- **Slip** (`.slip`): paper with a 1px border; its band (`.slip-band`) states the status: `paid` (blue), default (ink, on
  its way), `back` (grey, returned), `bad` (red). A dashed tear line separates the steps.

## Components

- **Buttons** (`.vt-btn`): primary carimbo blue with paper text; secondary transparent with a 1.5px ink border; ghost blue
  text. 56px tall in docks; Home's "Pagar um Pix" is a 64px full-width bar with the scan icon and a chevron.
- **Status**: a word with a small mark (check, amber dot, red word); never a filled pill.
- **Marks** (`.mark`): the money's sign in a 36px square: "$" in an ink square, the lumens planet outlined, "R$" on grey.
- **Segmented switch**: an ink outline; the selected half is filled with ink.
- **Steps** (`.progress`): one per line, a 10px square marker (ink done, amber now, red failed), a dotted leader to the time.
- **Loading**: placeholders at their real size that breathe in opacity (T-042), with the slow and stuck notes.
- **Wordmark**: the V of Vants drawn as the tick of "pago" plus "vants" in Archivo Condensed 800.

## Photography

One photograph, on Welcome only (DEC-061): darkened in CSS (`brightness(0.6) saturate(0.7)`), printed edge to edge across
the top of the screen with a hard edge to the ink below. No scrim, no fade. Credited in Conta.

## Motion

State only, 120–460 ms, ease-out-expo. A paid band prints in from the left (scaleX) and its tick draws; the amount and
words rise 8px in a 60ms stagger. Nothing loops, glows or counts up; reduced motion shows the end state.

## Checks

`pnpm check:contrast` (WCAG AA on 41 screens) and tasteskill v2 `inspect.mjs --app` at 390px (0 FAIL). Known, deliberate
warnings: the 2px ink ledger rules ("heavy borders") and Welcome's large headline.
