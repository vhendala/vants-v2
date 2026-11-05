// T-023: choosing how much of the payment comes from each position.
import { describe, expect, it } from "vitest";
import {
  add,
  type Candidate,
  compatible,
  complete,
  covered,
  format7,
  maxCents,
  parse7,
  room,
  set,
  setDivider,
  type Source,
  suggest,
  toPicks,
  chooseSource,
} from "./allocation.ts";

const CIRCLE = "USDC:GBBD47";
const BLEND = "USDC:GATALT";
// R$ 600,00 at 5.4 = 111.1111112 USDC (the quote rounds the asset amount up).
const bill = { totalCents: 600_00, total7: 111_1111112n };
const sources: Source[] = [
  { id: "vault", currency: BLEND, available7: 96_2962962n },
  { id: "xlm", currency: null, available7: 10_000_0000000n },
  { id: "blend", currency: BLEND, available7: 20_0000000n },
  { id: "circle", currency: CIRCLE, available7: 50_0000000n },
];

describe("allocation", () => {
  it("adds a position filling what's left, up to its ceiling in reais", () => {
    expect(maxCents(sources[0] as Source, bill)).toBe(519_99); // 96.30 USDC ≈ R$ 519,99, rounded down
    let slices = add("vault", [], sources, bill);
    expect(slices).toEqual([{ id: "vault", cents: 519_99 }]);
    slices = add("xlm", slices, sources, bill);
    expect(slices).toEqual([
      { id: "vault", cents: 519_99 },
      { id: "xlm", cents: 80_01 },
    ]);
    expect(covered(slices)).toBe(bill.totalCents);
  });

  it("never lets the shares pass the bill, nor a position its ceiling", () => {
    let slices = add("xlm", [], sources, bill); // XLM covers everything
    slices = add("vault", slices, sources, bill);
    expect(slices[1]).toEqual({ id: "vault", cents: 0 }); // nothing left
    slices = set("xlm", 100_00, slices, sources, bill);
    expect(room("vault", slices, sources, bill)).toBe(500_00);
    slices = set("vault", 999_99, slices, sources, bill);
    expect(slices[1]).toEqual({ id: "vault", cents: 500_00 });
    expect(set("blend", -5, add("blend", [], sources, bill), sources, bill)[0]?.cents).toBe(0);
  });

  it("keeps stablecoins apart: Circle USDC can't join a Blend USDC payment; XLM joins anything", () => {
    const slices = add("vault", [], sources, bill);
    expect(compatible(sources[3] as Source, slices, sources)).toBe(false);
    expect(compatible(sources[1] as Source, slices, sources)).toBe(true);
    expect(compatible(sources[3] as Source, add("xlm", [], sources, bill), sources)).toBe(true);
  });

  it("turns a covered allocation into picks that sum to the asset total exactly, none above its balance", () => {
    const slices = [
      { id: "vault", cents: 333_33 },
      { id: "blend", cents: 100_01 },
      { id: "xlm", cents: 166_66 },
    ];
    const picks = toPicks(slices, sources, bill);
    expect(picks.reduce((sum, p) => sum + parse7(p.amount), 0n)).toBe(bill.total7);
    for (const p of picks) {
      expect(parse7(p.amount)).toBeLessThanOrEqual((sources.find((s) => s.id === p.id) as Source).available7);
    }
  });

  it("gives the rounding remainder to a position with room, not one at its ceiling", () => {
    const tight = [
      { id: "vault", cents: 519_99 },
      { id: "xlm", cents: 80_01 },
    ];
    const picks = toPicks(tight, sources, bill);
    expect(parse7(picks[0]?.amount ?? "0")).toBeLessThanOrEqual(96_2962962n);
    expect(picks.reduce((sum, p) => sum + parse7(p.amount), 0n)).toBe(bill.total7);
  });

  it("drops positions set to zero, and formats 7-decimal amounts", () => {
    expect(toPicks([{ id: "blend", cents: 0 }], sources, bill)).toEqual([]);
    expect(format7(12_3400000n)).toBe("12.34");
    expect(format7(5_0000000n)).toBe("5");
    expect(parse7("0.0000001")).toBe(1n);
  });
});

describe("dragging the split (T-026)", () => {
  // vault R$ 519,99 | xlm R$ 80,01, then the tail (nothing left).
  const two = add("xlm", add("vault", [], sources, bill), sources, bill);

  it("moves money between two neighbours, never past either one's ceiling", () => {
    const moved = setDivider(0, 300_00, two, sources, bill);
    expect(moved).toEqual([
      { id: "vault", cents: 300_00 },
      { id: "xlm", cents: 300_00 },
    ]);
    expect(covered(moved)).toBe(bill.totalCents);
    // past the vault's ceiling: stops there
    expect(setDivider(0, 590_00, moved, sources, bill)[0]).toEqual({ id: "vault", cents: 519_99 });
    // below zero: stops at zero, the neighbour takes it all
    expect(setDivider(0, -50_00, moved, sources, bill)).toEqual([
      { id: "vault", cents: 0 },
      { id: "xlm", cents: 600_00 },
    ]);
  });

  it("the last divider grows or shrinks the last share against what's left", () => {
    const one = add("blend", [], sources, bill); // R$ 107,99 (20 USDC, rounded down)
    expect(setDivider(0, 50_00, one, sources, bill)).toEqual([{ id: "blend", cents: 50_00 }]);
    expect(setDivider(0, 400_00, one, sources, bill)).toEqual([{ id: "blend", cents: 107_99 }]);
  });
});

describe("suggestions (T-026)", () => {
  const candidates: Candidate[] = [
    { ...(sources[0] as Source), role: "earning" },
    { ...(sources[1] as Source), role: "lumens" },
    { ...(sources[2] as Source), role: "dollar" },
    { ...(sources[3] as Source), role: "dollar" },
  ];

  it("keeps what earns for last: dollars, then lumens, the investment only if needed", () => {
    const s = suggest("keep-earning", candidates, bill);
    expect(covered(s)).toBe(bill.totalCents);
    expect(s.map((x) => x.id)).not.toContain("vault");
    expect(s[0]?.id).toMatch(/blend|circle/);
    expect(s.at(-1)?.id).toBe("xlm");
  });

  it("the simplest is one source when one covers the whole bill", () => {
    expect(suggest("simplest", candidates, bill)).toEqual([{ id: "xlm", cents: 600_00 }]);
  });

  it("splits evenly among sources that can pay together, capped by each one's ceiling", () => {
    const s = suggest("even", candidates, bill);
    expect(covered(s)).toBe(bill.totalCents);
    // Blend's group (vault, xlm, blend) has the most sources: blend is capped at R$ 107,99, the others share the rest.
    expect(s).toContainEqual({ id: "blend", cents: 107_99 });
    const others = s.filter((x) => x.id !== "blend").map((x) => x.cents);
    expect(Math.abs((others[0] ?? 0) - (others[1] ?? 0))).toBeLessThanOrEqual(1);
    expect(new Set(s.map((x) => sources.find((y) => y.id === x.id)?.currency).values()).size).toBeLessThanOrEqual(2);
  });

  it("covers as much as it can when nothing covers the whole bill", () => {
    const small: Candidate[] = [{ id: "circle", currency: CIRCLE, available7: 5_0000000n, role: "dollar" }];
    expect(suggest("keep-earning", small, bill)).toEqual([{ id: "circle", cents: 26_99 }]);
  });
});

describe("completing (T-026)", () => {
  const candidates: Candidate[] = [
    { ...(sources[0] as Source), role: "earning" },
    { ...(sources[1] as Source), role: "lumens" },
    { ...(sources[2] as Source), role: "dollar" },
    { ...(sources[3] as Source), role: "dollar" },
  ];

  it("grows the chosen dollars before the chosen investment", () => {
    const done = complete(
      [
        { id: "vault", cents: 100_00 },
        { id: "blend", cents: 50_00 },
      ],
      candidates,
      bill,
    );
    expect(done).toContainEqual({ id: "blend", cents: 107_99 });
    expect(done).toContainEqual({ id: "vault", cents: 492_01 });
  });

  it("fills what's missing from the chosen sources first, then the next one that can join", () => {
    const partial = [{ id: "blend", cents: 50_00 }];
    const done = complete(partial, candidates, bill);
    expect(covered(done)).toBe(bill.totalCents);
    expect(done[0]).toEqual({ id: "blend", cents: 107_99 }); // grown to its ceiling first
    expect(done[1]?.id).toBe("xlm"); // then lumens (Circle's dollars can't join Blend's), before the investment
  });
});

describe("one investment per payment (T-026)", () => {
  // Lumens invested join any dollar, like lumens; but the router takes from one vault per payment.
  const both: Candidate[] = [
    { id: "vault", currency: BLEND, available7: 96_2962962n, role: "earning", vault: true },
    { id: "lumens-vault", currency: null, available7: 200_0000000n, role: "earning", vault: true },
    { id: "blend", currency: BLEND, available7: 20_0000000n, role: "dollar" },
  ];

  it("a second investment can't join the first", () => {
    const withVault = [{ id: "vault", cents: 100_00 }];
    expect(compatible(both[1] as Candidate, withVault, both)).toBe(false);
    expect(compatible(both[2] as Candidate, withVault, both)).toBe(true);
  });

  it("no suggestion ever takes from two investments", () => {
    for (const st of ["keep-earning", "simplest", "even"] as const) {
      const s = suggest(st, both, bill);
      expect(s.filter((x) => x.id.includes("vault")).length).toBeLessThanOrEqual(1);
      expect(covered(s)).toBe(bill.totalCents);
    }
  });
});

describe("using a source when the bill is already covered (T-026)", () => {
  it("the new source takes what it can, and the others shrink to fit, in their order", () => {
    const full = [
      { id: "blend", cents: 107_99 },
      { id: "xlm", cents: 492_01 },
    ];
    const next = chooseSource("vault", full, sources, bill); // vault holds R$ 519,99
    expect(covered(next)).toBe(bill.totalCents);
    expect(next[0]).toEqual({ id: "vault", cents: 519_99 });
    expect(next).toContainEqual({ id: "blend", cents: 80_01 });
    expect(next.some((s) => s.id === "xlm")).toBe(false);
  });

  it("with room left, it just fills what's missing", () => {
    expect(chooseSource("xlm", [{ id: "blend", cents: 100_00 }], sources, bill)).toEqual([
      { id: "blend", cents: 100_00 },
      { id: "xlm", cents: 500_00 },
    ]);
  });
});

describe("allocation: Tesouro, sold on the order book (T-029)", () => {
  const withTesouro: Candidate[] = [
    { id: "vault", currency: BLEND, available7: 96_2962962n, vault: true, role: "earning" },
    { id: "tesouro", currency: null, available7: 59_3100000n, orderBook: true, role: "earning" },
    { id: "circle", currency: CIRCLE, available7: 50_0000000n, role: "dollar" },
  ];

  it("goes with any dollar, like lumens, but never with money invested in a vault", () => {
    expect(compatible(withTesouro[1] as Source, [{ id: "circle", cents: 100_00 }], withTesouro)).toBe(true);
    expect(compatible(withTesouro[1] as Source, [{ id: "vault", cents: 100_00 }], withTesouro)).toBe(false);
    expect(compatible(withTesouro[0] as Source, [{ id: "tesouro", cents: 100_00 }], withTesouro)).toBe(false);
  });

  it("suggestions never put Tesouro and a vault in the same payment", () => {
    for (const st of ["keep-earning", "simplest", "even"] as const) {
      const ids = suggest(st, withTesouro, bill).map((s) => s.id);
      expect(ids.includes("tesouro") && ids.includes("vault")).toBe(false);
    }
  });
});
