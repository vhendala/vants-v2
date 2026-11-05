import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setEnvVars } from "./env-file.ts";

describe("setEnvVars", () => {
  it("replaces existing keys, appends new ones and leaves the rest untouched", () => {
    const file = join(mkdtempSync(join(tmpdir(), "vants-env-")), ".env");
    writeFileSync(file, "# comment\nPIER_API_KEY=keep\nPIER_SUBSCRIPTION_ID=\nOTHER=x=y\n");
    setEnvVars(file, { PIER_SUBSCRIPTION_ID: "abc", PIER_WEBHOOK_SECRET: "whsec_1" });
    expect(readFileSync(file, "utf8")).toBe(
      "# comment\nPIER_API_KEY=keep\nPIER_SUBSCRIPTION_ID=abc\nOTHER=x=y\nPIER_WEBHOOK_SECRET=whsec_1\n",
    );
  });
});
