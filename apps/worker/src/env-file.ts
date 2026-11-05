// Writes values the setup scripts own into the git-ignored .env, replacing their lines and leaving everything else as is.
import { readFileSync, writeFileSync } from "node:fs";

export function setEnvVars(file: string, values: Record<string, string>): void {
  let content = readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, "m");
    content = line.test(content)
      ? content.replace(line, () => `${key}=${value}`)
      : `${content.replace(/\n?$/, "\n")}${key}=${value}\n`;
  }
  writeFileSync(file, content);
}
