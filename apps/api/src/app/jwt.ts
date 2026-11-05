// A minimal HS256 JWT (RFC 7519) for the mini app's SEP-10 session (DEC-011). Only HS256 is accepted, the signature is compared
// in constant time, and `iss` and `exp` are always checked.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionClaims {
  iss: string;
  /** The authenticated account (G…). */
  sub: string;
  iat: number;
  exp: number;
  /** The challenge's hash: one token per challenge. */
  jti: string;
  /** The host wallet's home domain, when it attested the challenge (SEP-10 client_domain). */
  client_domain?: string;
}

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const mac = (input: string, secret: string) => createHmac("sha256", Buffer.from(secret, "hex")).update(input).digest();

export function signJwt(claims: SessionClaims, secret: string): string {
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${body}.${mac(body, secret).toString("base64url")}`;
}

/** The claims, or null if the token is malformed, not HS256, forged, from another issuer, or expired. */
export function verifyJwt(
  token: string,
  secret: string,
  opts: { iss: string; nowSeconds: number },
): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h = "", p = "", s = ""] = parts;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: unknown };
    if (header.alg !== "HS256") return null;
    const expected = mac(`${h}.${p}`, secret);
    const given = Buffer.from(s, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as SessionClaims;
    if (claims.iss !== opts.iss || typeof claims.exp !== "number" || claims.exp <= opts.nowSeconds) return null;
    if (typeof claims.sub !== "string" || typeof claims.jti !== "string") return null;
    return claims;
  } catch {
    return null;
  }
}
