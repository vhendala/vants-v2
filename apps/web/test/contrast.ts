// pnpm check:contrast (T-032): every screen and state of the mini app, rendered in Chrome at 390 px through the dev preview,
// with every piece of visible text measured against what is really behind it. WCAG 2.2 AA: 4.5:1 for text, 3:1 for large
// text (≥ 24 px, or ≥ 18.66 px bold) and for the progress marks that carry state. Text over a photograph or a gradient is
// measured on the rendered pixels (the text hidden, the 10th-percentile pixel), everything else from the computed colours
// composited up the tree. Nothing people read may be under 12 px. Disabled controls are checked like any other text (the design wants them readable). Closed
// <details> are opened first, so text one tap away is checked too.
//
// No dependencies beyond the app's own Vite and an installed Chrome (CHROME_PATH, or the usual macOS/Linux locations).
// Exit 1 on any failure, with each failing text, its ratio, the colours and where it sits.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { createServer } from "vite";

type Step =
  | { hash: string }
  | { click: string | string[] }
  | { keys: string }
  | { type: { sel: string; text: string } }
  | { wait: number };
interface Scenario {
  name: string;
  query?: string;
  steps?: Step[];
}

const KEY = "joao.silva@exemplo.com.br";
const CODE =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865406600.005802BR5917PADARIA SAO JORGE6009SAO PAULO62070503***6304ABCD";

const SCENARIOS: Scenario[] = [
  { name: "welcome", query: "?signedout" },
  { name: "home" },
  { name: "home (empty)", query: "?empty" },
  { name: "invest", steps: [{ hash: "#/invest" }] },
  // Investing and taking out (T-041): the overview, then amount → review, like a Pix.
  { name: "vault", steps: [{ hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" }] },
  {
    name: "vault (nothing to invest)",
    query: "?empty",
    steps: [{ hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" }],
  },
  {
    name: "vault amount",
    steps: [
      { hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" },
      { click: "Investir" },
      { keys: "1000" },
    ],
  },
  {
    name: "vault review",
    steps: [
      { hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" },
      { click: "Investir" },
      { keys: "1250" },
      { click: "Revisar" },
    ],
  },
  {
    name: "vault take out review",
    steps: [
      { hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" },
      { click: "Resgatar" },
      { keys: "3000" },
      { click: "Revisar" },
    ],
  },
  {
    name: "lumens review",
    steps: [
      { hash: "#/invest/CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ" },
      { click: "Investir" },
      { click: "Metade" },
      { click: "Revisar" },
    ],
  },
  { name: "tesouro", steps: [{ hash: "#/invest/tesouro" }] },
  {
    name: "tesouro (receive it first)",
    query: "?empty",
    steps: [{ hash: "#/invest/tesouro" }, { click: "Investir" }, { keys: "500" }, { click: "Revisar" }],
  },
  {
    name: "tesouro review",
    steps: [{ hash: "#/invest/tesouro" }, { click: "Investir" }, { keys: "500" }, { click: "Revisar" }],
  },
  // Waiting (T-042): a screen still loading past a few seconds, the wallet's turn, and the network recording slowly.
  { name: "home (still loading)", query: "?slow=8", steps: [{ wait: 5500 }] },
  {
    name: "invest (wallet's turn)",
    query: "?slow",
    steps: [
      { hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" },
      { wait: 4500 },
      { click: "Investir" },
      { keys: "1250" },
      { click: "Revisar" },
      { wait: 4500 },
      { click: "Confirmar e investir" },
    ],
  },
  {
    name: "invest (recording, slow)",
    query: "?slow",
    steps: [
      { hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" },
      { wait: 4500 },
      { click: "Investir" },
      { keys: "1250" },
      { click: "Revisar" },
      { wait: 4500 },
      { click: "Confirmar e investir" },
      { wait: 13000 },
    ],
  },
  { name: "activity", steps: [{ hash: "#/activity" }] },
  { name: "receipt paid", steps: [{ hash: "#/activity/ext_aaaaaaaaaaaaaaaaaaa2" }] },
  { name: "receipt in flight", steps: [{ hash: "#/activity/ext_aaaaaaaaaaaaaaaaaaa1" }] },
  { name: "receipt refunded", steps: [{ hash: "#/activity/ext_aaaaaaaaaaaaaaaaaaa4" }] },
  { name: "account", steps: [{ hash: "#/account" }] },
  { name: "help", steps: [{ hash: "#/help" }] },
  { name: "not found", steps: [{ hash: "#/nope" }] },
  { name: "add money", steps: [{ hash: "#/add" }] },
  { name: "add money (profile, amount)", query: "?profile", steps: [{ hash: "#/add" }, { keys: "2555" }] },
  {
    name: "add money (Pix code)",
    query: "?profile",
    steps: [{ hash: "#/add" }, { keys: "2555" }, { click: "Gerar o Pix" }],
  },
  {
    name: "add money (Pix received)",
    query: "?profile&funded",
    steps: [{ hash: "#/add" }, { keys: "2555" }, { click: "Gerar o Pix" }, { wait: 2500 }],
  },
  {
    name: "add money (Tesouro review)",
    query: "?profile",
    steps: [{ hash: "#/add" }, { click: "Tesouro" }, { keys: "2555" }, { click: ["Continuar", "Gerar o Pix"] }],
  },
  // The success moments (T-035), measured once the motion has settled.
  {
    name: "add money (landed)",
    query: "?profile&completes",
    steps: [{ hash: "#/add" }, { keys: "2555" }, { click: "Gerar o Pix" }, { wait: 11000 }],
  },
  {
    name: "invest (done)",
    steps: [
      { hash: "#/invest/CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN" },
      { click: "Investir" },
      { keys: "1250" },
      { click: "Revisar" },
      { click: "Confirmar e investir" },
      { wait: 3000 },
    ],
  },
  {
    name: "tesouro (bought)",
    steps: [
      { hash: "#/invest/tesouro" },
      { click: "Investir" },
      { keys: "500" },
      { click: "Revisar" },
      { click: "Confirmar e investir" },
      { wait: 3000 },
    ],
  },
  {
    name: "receipt (paid as you watch)",
    query: "?completes",
    steps: [{ hash: "#/activity/ext_aaaaaaaaaaaaaaaaaaa1" }, { wait: 6000 }],
  },
  { name: "pay (QR)", steps: [{ hash: "#/pay" }] },
  {
    name: "pay (code typed)",
    steps: [{ hash: "#/pay" }, { click: "Digitar o código" }, { type: { sel: "#brcode", text: CODE } }],
  },
  {
    name: "pay (sources)",
    steps: [
      { hash: "#/pay" },
      { click: "Digitar o código" },
      { type: { sel: "#brcode", text: CODE } },
      { click: "Continuar" },
    ],
  },
  {
    name: "pay (sources, editing)",
    steps: [
      { hash: "#/pay" },
      { click: "Digitar o código" },
      { type: { sel: "#brcode", text: CODE } },
      { click: "Continuar" },
      { click: "Alterar" },
    ],
  },
  {
    name: "pay (review)",
    steps: [
      { hash: "#/pay" },
      { click: "Digitar o código" },
      { type: { sel: "#brcode", text: CODE } },
      { click: "Continuar" },
      { click: "Revisar pagamento" },
    ],
  },
  { name: "pay (Pix key)", steps: [{ hash: "#/pay/key" }] },
  { name: "pay (Pix key typed)", steps: [{ hash: "#/pay/key" }, { type: { sel: "input", text: KEY } }] },
  {
    name: "pay (Pix key amount)",
    steps: [{ hash: "#/pay/key" }, { type: { sel: "input", text: KEY } }, { click: "Continuar" }, { keys: "4290" }],
  },
  {
    name: "pay (Pix key review)",
    steps: [
      { hash: "#/pay/key" },
      { type: { sel: "input", text: KEY } },
      { click: "Continuar" },
      { keys: "4290" },
      { click: "Continuar" },
      { click: "Revisar pagamento" },
    ],
  },
];

// ---- in-page audit -------------------------------------------------------------------------------------------------

/** Runs in the page: every visible text run with its colours, or a flag that pixels must decide. */
function audit() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  /** Any CSS colour (oklch included) → sRGB 0..255 and alpha 0..1, as the browser paints it. */
  const rgba = (c: string): number[] => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillStyle = c;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  };
  const over = (top: number[], bottom: number[]): number[] => {
    const a = top[3] ?? 1;
    return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bottom[i] ?? 0) * (1 - a)).concat(1);
  };
  const opacityOf = (el: Element | null): number => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  /** The solid colour behind an element, or null when a photograph, video or gradient is behind it. */
  const backgroundOf = (el: Element, rect: DOMRect, from: Element | null = el): number[] | null => {
    const layers: number[][] = [];
    for (let e: Element | null = from; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== "none") return null;
      const c = rgba(s.backgroundColor);
      if ((c[3] ?? 0) > 0) layers.push(c);
      if ((c[3] ?? 0) >= 1) break;
    }
    // Anything painted under the text that isn't an ancestor: a positioned photograph or a scrim.
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === el || el.contains(hit) || hit.contains(el)) continue;
      const s = getComputedStyle(hit);
      if (/^(IMG|VIDEO|CANVAS)$/.test(hit.tagName) || s.backgroundImage !== "none") return null;
    }
    let bg = [255, 255, 255, 1];
    for (const l of layers.reverse()) bg = over(l, bg);
    return bg;
  };

  const out: {
    i: number;
    text: string;
    where: string;
    px: number;
    weight: number;
    fg: number[];
    bg: number[] | null;
    rect: number[];
    kind: string;
  }[] = [];
  const marks: Element[] = [];
  const where = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && parts.length < 4 && e !== document.body; e = e.parentElement) {
      const cls = typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).join(".")}` : "";
      parts.unshift(`${e.tagName.toLowerCase()}${cls}`);
    }
    return parts.join(" > ");
  };
  const visible = (el: Element, r: DOMRect) => {
    if (r.width <= 1 || r.height <= 1) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === "hidden" || s.display === "none") return false;
    }
    return opacityOf(el) > 0.05;
  };
  const push = (el: Element, text: string, color: string, kind: string, r: DOMRect) => {
    // A mark's own fill is the foreground: what's behind it starts at its parent.
    const behind = kind === "mark" ? el.parentElement : el;
    const s = getComputedStyle(el);
    const fg = rgba(color);
    fg[3] = (fg[3] ?? 1) * opacityOf(el);
    marks.push(el);
    out.push({
      i: marks.length - 1,
      text: text.slice(0, 60),
      where: where(el),
      px: Number.parseFloat(s.fontSize),
      weight: Number(s.fontWeight),
      fg,
      bg: backgroundOf(el, r, behind),
      rect: [r.left + scrollX, r.top + scrollY, r.width, r.height],
      kind,
    });
  };

  // Text runs.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|TITLE)$/.test(el.tagName)) continue;
    seen.add(el);
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (visible(el, r)) push(el, text, getComputedStyle(el).color, "text", r);
  }
  // What people type, and the placeholders that tell them what to type.
  for (const el of document.querySelectorAll("input, textarea")) {
    const f = el as HTMLInputElement;
    const r = f.getBoundingClientRect();
    if (!visible(f, r) || f.type === "hidden" || f.type === "radio" || f.type === "checkbox") continue;
    if (f.value) push(f, f.value, getComputedStyle(f).color, "input", r);
    else if (f.placeholder) push(f, f.placeholder, getComputedStyle(f, "::placeholder").color, "placeholder", r);
  }
  // Progress marks that carry state (WCAG 1.4.11, 3:1 against what's around them).
  for (const el of document.querySelectorAll(".progress .done i, .progress .now i, .progress .bad i, .step.on")) {
    const r = el.getBoundingClientRect();
    if (visible(el, r)) push(el, `[${where(el)}]`, getComputedStyle(el).backgroundColor, "mark", r);
  }
  (window as unknown as { __marks: Element[] }).__marks = marks;
  return out;
}

// ---- Chrome over the DevTools protocol ------------------------------------------------------------------------------

const chromePath = () => {
  const c = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => p && existsSync(p));
  if (!c) throw new Error("Chrome not found: set CHROME_PATH");
  return c;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cdp(port: number) {
  let url: string | undefined;
  for (let i = 0; i < 60 && !url; i++) {
    await sleep(200);
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      url = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting
    }
  }
  if (!url) throw new Error("Chrome did not open a page");
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
  const errors: string[] = [];
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)?.(d);
      pending.delete(d.id);
    }
    if (d.method === "Runtime.exceptionThrown")
      errors.push(d.params.exceptionDetails.exception?.description ?? "error");
  });
  const send = <T>(method: string, params: object = {}): Promise<T> =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (v) => (v.error ? reject(new Error(`${method}: ${v.error.message}`)) : resolve(v.result as T)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send<{ result: { value: T }; exceptionDetails?: { text: string } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, errors, close: () => ws.close() };
}

/** Minimal PNG decoder (8-bit RGB/RGBA, the only kinds Chrome's screenshots produce). */
function decodePng(buf: Buffer): { w: number; h: number; px: Uint8Array; ch: number } {
  let off = 8;
  let w = 0;
  let h = 0;
  let type = 6;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const name = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (name === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9] ?? 6;
    } else if (name === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const ch = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= ch ? (px[y * stride + x - ch] ?? 0) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= ch && y > 0 ? (px[(y - 1) * stride + x - ch] ?? 0) : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f] ?? 0;
      px[y * stride + x] = (v + pred) & 255;
    }
  }
  return { w, h, px, ch };
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: number[]) => 0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const over = (top: number[], bottom: number[]) => {
  const a = top[3] ?? 1;
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bottom[i] ?? 0) * (1 - a));
};
const css = (c: number[]) =>
  `rgb(${c.slice(0, 3).map(Math.round).join(" ")}${(c[3] ?? 1) < 1 ? ` / ${(c[3] ?? 1).toFixed(2)}` : ""})`;

// ---- run ----------------------------------------------------------------------------------------------------------

const root = new URL("..", import.meta.url).pathname;
const server = await createServer({ root, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? "";
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
  chromePath(),
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "vants-contrast-"))}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

// ONLY=substring runs just the matching screens (for iterating on one flow).
const only = process.env.ONLY;
const scenarios = only ? SCENARIOS.filter((x) => x.name.includes(only)) : SCENARIOS;
let failures = 0;
let checked = 0;
try {
  const c = await cdp(port);
  await c.send("Runtime.enable");
  await c.send("Page.enable");
  for (const sc of scenarios) {
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send("Page.navigate", { url: `${base}preview.html${sc.query ?? ""}` });
    await sleep(1800);
    for (const step of sc.steps ?? []) {
      if ("hash" in step) await c.evaluate(`location.hash = ${JSON.stringify(step.hash)}`);
      else if ("wait" in step) await sleep(step.wait);
      else if ("keys" in step)
        await c.evaluate(`(async () => { for (const k of ${JSON.stringify([...step.keys])}) {
          [...document.querySelectorAll(".keypad button")].find((b) => b.textContent.trim() === k)?.click();
          await new Promise((r) => setTimeout(r, 60)); } })()`);
      else if ("type" in step)
        await c.evaluate(`(() => { const f = document.querySelector(${JSON.stringify(step.type.sel)});
          const proto = f instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(f, ${JSON.stringify(step.type.text)});
          f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      else {
        const labels = Array.isArray(step.click) ? step.click : [step.click];
        const ok = await c.evaluate<boolean>(`(() => { const want = ${JSON.stringify(labels)};
          const b = [...document.querySelectorAll("button, a")].find((x) => !x.disabled && want.some((w) => x.textContent.trim().startsWith(w)));
          b?.click(); return !!b; })()`);
        if (!ok) throw new Error(`${sc.name}: nothing to click for ${labels.join(" / ")}`);
      }
      await sleep(900);
    }
    await c.evaluate(`document.querySelectorAll("details").forEach((d) => (d.open = true))`);
    await sleep(300);
    // A viewport as tall as the page, so every run can be hit-tested and screenshotted where it is.
    const h = await c.evaluate<number>("Math.ceil(document.documentElement.scrollHeight)");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: Math.max(844, h),
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(300);
    const runs = await c.evaluate<ReturnType<typeof audit>>(`(${audit.toString()})()`);
    const bad: string[] = [];
    for (const r of runs) {
      checked++;
      const large = r.px >= 24 || (r.px >= 18.66 && r.weight >= 700);
      const need = r.kind === "mark" || large ? 3 : 4.5;
      let got: number;
      let bgText: string;
      if (r.bg) {
        got = ratio(over(r.fg, r.bg), r.bg);
        bgText = css(r.bg);
      } else {
        // Over a photograph or gradient: hide the text, read the pixels behind it.
        await c.evaluate(`(() => { const e = window.__marks[${r.i}]; e.dataset.cx = e.style.cssText;
          e.style.color = "transparent"; e.style.textShadow = "none"; e.style.caretColor = "transparent"; })()`);
        const [x, y, w, hh] = r.rect as [number, number, number, number];
        const shot = await c.send<{ data: string }>("Page.captureScreenshot", {
          format: "png",
          clip: { x, y, width: Math.max(1, w), height: Math.max(1, hh), scale: 1 },
          captureBeyondViewport: true,
        });
        await c.evaluate(`(() => { const e = window.__marks[${r.i}]; e.style.cssText = e.dataset.cx; })()`);
        const img = decodePng(Buffer.from(shot.data, "base64"));
        const ratios: number[] = [];
        for (let p = 0; p < img.w * img.h; p++) {
          const pix = [img.px[p * img.ch] ?? 0, img.px[p * img.ch + 1] ?? 0, img.px[p * img.ch + 2] ?? 0];
          ratios.push(ratio(over(r.fg, pix), pix));
        }
        ratios.sort((p, q) => p - q);
        got = ratios[Math.floor(ratios.length * 0.1)] ?? 0;
        bgText = "pixels";
      }
      if (r.kind !== "mark" && r.px < 12) bad.push(`  ${r.px}px < 12px (readability)  "${r.text}"\n    ${r.where}`);
      if (got + 1e-9 < need)
        bad.push(
          `  ${got.toFixed(2)}:1 < ${need}:1  "${r.text}"  ${r.kind}, ${r.px}px/${r.weight}  fg ${css(r.fg)} on ${bgText}\n    ${r.where}`,
        );
    }
    if (c.errors.length) bad.push(`  console: ${c.errors.splice(0).join(" | ").slice(0, 200)}`);
    failures += bad.length;
    console.log(`${bad.length ? "✗" : "✓"} ${sc.name} (${runs.length} checked)`);
    for (const b of bad) console.log(b);
  }
  c.close();
} finally {
  chrome.kill();
  await server.close();
}
console.log(`\n${checked} text runs and marks on ${scenarios.length} screens: ${failures} below WCAG AA.`);
process.exit(failures ? 1 : 0);
