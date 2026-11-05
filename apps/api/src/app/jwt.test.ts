// The mini app's session token (SEP-10 JWT, DEC-011): HS256 only, short-lived, bound to one issuer.
import { describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "./jwt.ts";

const SECRET = "ab".repeat(32);
const ISS = "https://vants.example.com/auth";
const claims = {
  iss: ISS,
  sub: "GCLFUKIR3AW6NIRV7VEAYGO527YRONFEWL5V4HJBTOQRQ6R64U6UOYTT",
  iat: 1_000,
  exp: 1_900,
  jti: "abc",
};
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("jwt", () => {
  it("round-trips its claims", () => {
    expect(verifyJwt(signJwt(claims, SECRET), SECRET, { iss: ISS, nowSeconds: 1_500 })).toEqual(claims);
  });

  it("refuses expired tokens, and tokens from another issuer or secret", () => {
    const t = signJwt(claims, SECRET);
    expect(verifyJwt(t, SECRET, { iss: ISS, nowSeconds: 1_900 })).toBeNull();
    expect(verifyJwt(t, SECRET, { iss: "https://other.example/auth", nowSeconds: 1_500 })).toBeNull();
    expect(verifyJwt(t, "cd".repeat(32), { iss: ISS, nowSeconds: 1_500 })).toBeNull();
  });

  it("refuses a tampered payload, alg none, other algorithms and garbage", () => {
    const [h, , s] = signJwt(claims, SECRET).split(".");
    const forged = `${h}.${b64({ ...claims, sub: "GOTHER" })}.${s}`;
    expect(verifyJwt(forged, SECRET, { iss: ISS, nowSeconds: 1_500 })).toBeNull();
    expect(
      verifyJwt(`${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`, SECRET, { iss: ISS, nowSeconds: 1_500 }),
    ).toBeNull();
    expect(
      verifyJwt(`${b64({ alg: "HS512", typ: "JWT" })}.${b64(claims)}.${s}`, SECRET, { iss: ISS, nowSeconds: 1_500 }),
    ).toBeNull();
    for (const junk of ["", "a.b", "a.b.c.d", "!!!.###.$$$"])
      expect(verifyJwt(junk, SECRET, { iss: ISS, nowSeconds: 1_500 })).toBeNull();
  });
});
