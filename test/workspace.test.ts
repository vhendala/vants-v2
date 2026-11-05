// Workspace rules from the spec: the packages of §3.2, exact pins (DEC-013) and the dependency boundaries of §3.8.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** §3.2: every component, by directory and package name. */
const EXPECTED: Record<string, string> = {
  "apps/api": "@vants/api",
  "apps/worker": "@vants/worker",
  "apps/web": "@vants/web",
  "packages/config": "@vants/config",
  "packages/domain": "@vants/domain",
  "packages/pix": "@vants/pix",
  "packages/db": "@vants/db",
  "packages/adapters/hodle": "@vants/adapter-hodle",
  "packages/adapters/pier": "@vants/adapter-pier",
  "packages/adapters/stellar": "@vants/adapter-stellar",
  "packages/adapters/defindex": "@vants/adapter-defindex",
  "packages/adapters/cctp": "@vants/adapter-cctp",
};

/** Adapters that talk to Hodle, Pier or CCTP: only the worker may use them (§3.8). */
const WORKER_ONLY = ["@vants/adapter-hodle", "@vants/adapter-pier", "@vants/adapter-cctp"];
/** Worker-only adapters whose `/webhook` subpath (signature checks, no network) api may import for ingress (DEC-021). */
const WEBHOOK_SUBPATH_ADAPTERS = ["@vants/adapter-hodle", "@vants/adapter-pier"];

const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
const deps = (m: Manifest) => ({ ...m.dependencies, ...m.devDependencies });
const internal = (m: Manifest) => Object.keys(deps(m)).filter((d) => d.startsWith("@vants/"));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (entry === "node_modules" || entry === "dist") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const present = Object.keys(EXPECTED).filter((dir) => existsSync(join(ROOT, dir, "package.json")));
const manifests = new Map(present.map((dir) => [dir, readManifest(dir)]));
const byName = (name: string) => [...manifests.values()].find((m) => m.name === name);

describe("§3.2 components", () => {
  it.each(Object.entries(EXPECTED))("%s exists as %s", (dir, name) => {
    expect(existsSync(join(ROOT, dir, "package.json")), `${dir}/package.json`).toBe(true);
    expect(readManifest(dir).name).toBe(name);
  });
});

describe("DEC-013 exact pins", () => {
  it("every dependency is an exact version or a workspace link", () => {
    const loose: string[] = [];
    for (const [dir, m] of [[".", readManifest(".")] as const, ...manifests]) {
      for (const [dep, spec] of Object.entries(deps(m))) {
        if (!/^\d+\.\d+\.\d+$/.test(spec) && spec !== "workspace:*") loose.push(`${dir}: ${dep}@${spec}`);
      }
    }
    expect(loose).toEqual([]);
  });
});

describe("§3.8 dependency boundaries", () => {
  it("domain is pure: it may depend only on pix", () => {
    expect(internal(byName("@vants/domain") ?? { name: "" }).filter((d) => d !== "@vants/pix")).toEqual([]);
    expect(Object.keys(byName("@vants/domain")?.dependencies ?? {}).filter((d) => !d.startsWith("@vants/"))).toEqual(
      [],
    );
  });

  it("pix depends on nothing", () => {
    expect(Object.keys(byName("@vants/pix")?.dependencies ?? {})).toEqual([]);
  });

  it("adapters never import each other", () => {
    for (const m of manifests.values()) {
      if (!m.name.startsWith("@vants/adapter-")) continue;
      expect(
        internal(m).filter((d) => d.startsWith("@vants/adapter-")),
        m.name,
      ).toEqual([]);
    }
  });

  it("only the worker uses the Hodle, Pier and CCTP adapters; api may declare Hodle and Pier for webhook checks only", () => {
    for (const m of manifests.values()) {
      if (m.name === "@vants/worker") continue;
      const allowed = m.name === "@vants/api" ? WEBHOOK_SUBPATH_ADAPTERS : [];
      expect(
        internal(m).filter((d) => WORKER_ONLY.includes(d) && !allowed.includes(d)),
        m.name,
      ).toEqual([]);
    }
  });

  it("api imports worker-only adapters only through their network-free /webhook subpath (DEC-021)", () => {
    const offending: string[] = [];
    for (const file of sourceFiles(join(ROOT, "apps/api/src"))) {
      for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+["'](@vants\/[a-z-]+(?:\/[a-z-]+)?)/g)) {
        const pkg = spec?.split("/").slice(0, 2).join("/") ?? "";
        if (WORKER_ONLY.includes(pkg) && spec !== `${pkg}/webhook`)
          offending.push(`${file.slice(ROOT.length + 1)} → ${spec}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it("the /webhook subpaths import nothing that talks to the network", () => {
    for (const pkg of WEBHOOK_SUBPATH_ADAPTERS) {
      const dir = Object.entries(EXPECTED).find(([, name]) => name === pkg)?.[0];
      const file = join(ROOT, dir ?? "", "src/webhook.ts");
      if (!existsSync(file)) continue;
      const imports = [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect(
        imports.filter((i) => !["node:crypto", "standardwebhooks"].includes(i ?? "")),
        pkg,
      ).toEqual([]);
    }
  });

  it("only api and worker read configuration; everything else takes settings as parameters (DEC-019)", () => {
    for (const m of manifests.values()) {
      if (m.name === "@vants/api" || m.name === "@vants/worker") continue;
      expect(internal(m).includes("@vants/config"), m.name).toBe(false);
    }
  });

  it("web uses no backend package", () => {
    const web = byName("@vants/web");
    expect(web ? internal(web).filter((d) => d === "@vants/db" || d.startsWith("@vants/adapter-")) : []).toEqual([]);
  });

  it("source files import only the @vants packages their manifest declares", () => {
    const undeclared: string[] = [];
    for (const [dir, m] of manifests) {
      const allowed = new Set([m.name, ...internal(m)]);
      for (const file of sourceFiles(join(ROOT, dir, "src"))) {
        for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+["'](@vants\/[a-z-]+)/g)) {
          // @vants/x/sub resolves to package @vants/x, which the regex captures without the subpath
          if (spec && !allowed.has(spec)) undeclared.push(`${file.slice(ROOT.length + 1)} → ${spec}`);
        }
      }
    }
    expect(undeclared).toEqual([]);
  });
});
