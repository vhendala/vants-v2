// The mini app is served from the API's origin (T-021), and never shadows an API route or leaks files outside dist.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { webApp } from "./web.ts";

const dist = mkdtempSync(join(tmpdir(), "vants-web-"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>Vants</title>");
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
writeFileSync(join(dist, "assets", "photo-abc.jpg"), "jpeg");

describe("webApp", async () => {
  const app = Fastify();
  await app.register(webApp, { dist });

  it("serves the app at / and for client routes, never cached", async () => {
    for (const url of ["/", "/pagar", "/qualquer/coisa"]) {
      const res = await app.inject({ url });
      expect([res.statusCode, res.headers["content-type"], res.headers["cache-control"]]).toEqual([
        200,
        "text/html; charset=utf-8",
        "no-cache",
      ]);
      expect(res.body).toContain("<title>Vants</title>");
    }
  });

  it("caches hashed assets for good, with their type", async () => {
    const res = await app.inject({ url: "/assets/index-abc.js" });
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("serves photographs with their type", async () => {
    expect((await app.inject({ url: "/assets/photo-abc.jpg" })).headers["content-type"]).toBe("image/jpeg");
  });

  it("follows a rebuild without a restart, and never answers a missing asset with the app", async () => {
    // A build replaces index.html and deletes the old hashed files: the page must name the new ones, and a page still
    // open on the old build must get a 404 for its script, not HTML (which browsers refuse as a module).
    rmSync(join(dist, "assets", "index-abc.js"));
    writeFileSync(join(dist, "assets", "index-def.js"), "console.log(2)");
    writeFileSync(join(dist, "index.html"), '<!doctype html><title>Vants</title><script src="/assets/index-def.js">');
    expect((await app.inject({ url: "/" })).body).toContain("index-def.js");
    const stale = await app.inject({ url: "/assets/index-abc.js" });
    expect(stale.statusCode).toBe(404);
    expect(stale.headers["content-type"]).not.toContain("text/html");
  });

  it("never answers an API path with the app, and never reads outside dist", async () => {
    for (const url of ["/app/portfolio", "/auth", "/v0/quotes", "/ingress/pier", "/.well-known/x"]) {
      expect((await app.inject({ url })).statusCode).toBe(404);
    }
    const outside = await app.inject({ url: "/..%2F..%2F..%2Fetc%2Fpasswd" });
    expect(outside.body).not.toContain("root:");
  });
});
