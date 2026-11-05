import { describe, expect, it } from "vitest";
import { hrefOf, parseRoute } from "./router.ts";

const VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";

describe("routes (T-026)", () => {
  it("reads every page from the hash and writes it back", () => {
    for (const hash of ["#/", "#/pay", "#/pay/key", "#/activity", "#/account", "#/invest", "#/add", "#/help"])
      expect(hrefOf(parseRoute(hash))).toBe(hash);
    expect(parseRoute(`#/invest/${VAULT}`)).toEqual({ name: "vault", id: VAULT });
    expect(hrefOf({ name: "vault", id: VAULT })).toBe(`#/invest/${VAULT}`);
    expect(parseRoute("#/activity/ext_0123456789abcdef0123")).toEqual({
      name: "receipt",
      id: "ext_0123456789abcdef0123",
    });
  });

  it("opens home for an empty hash and the not-found page for an unknown one", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/nope")).toEqual({ name: "notfound" });
    expect(parseRoute("#/invest/not-a-vault")).toEqual({ name: "notfound" });
  });
});
