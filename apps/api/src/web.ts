// Serves the built mini app (apps/web/dist) from the API's own origin (T-021), so wallets reach the app, SEP-10 and /app
// through one public URL without CORS. Hashed assets are cached for good; index.html never is, and it is read on every
// request so a rebuild shows without restarting the API (a stale index.html named scripts the build had deleted, T-026).
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { FastifyPluginAsync } from "fastify";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
/** Paths that belong to the API: never answered with the app. */
const API_PREFIXES = ["/v0", "/app/", "/auth", "/ingress", "/.well-known"];

export const webApp: FastifyPluginAsync<{ dist: string }> = async (app, opts) => {
  const root = resolve(opts.dist);
  await readFile(join(root, "index.html")); // fail at start if the build is missing

  app.get("/*", async (req, reply) => {
    const path = decodeURIComponent((req.url.split("?")[0] ?? "/").replace(/^\/+/, ""));
    if (API_PREFIXES.some((p) => `/${path}`.startsWith(p))) return reply.code(404).send({ error: "not found" });
    const file = resolve(root, normalize(path));
    if (path && (file === root || file.startsWith(root + sep))) {
      try {
        const body = await readFile(file);
        const immutable = path.startsWith("assets/");
        return reply
          .type(TYPES[extname(file)] ?? "application/octet-stream")
          .header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
          .send(body);
      } catch {
        // A hashed asset that isn't there is gone (an older build): 404, never the app, which a browser would refuse
        // as a script. Anything else is a client route: fall through to the app.
        if (path.startsWith("assets/")) return reply.code(404).send({ error: "not found" });
      }
    }
    return reply
      .type(TYPES[".html"] ?? "text/html")
      .header("cache-control", "no-cache")
      .send(await readFile(join(root, "index.html")));
  });
};
