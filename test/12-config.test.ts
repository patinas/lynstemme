import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("deployment safety", () => {
  it("keeps secrets out of tracked config", () => {
    const config = fs.readFileSync("wrangler.jsonc", "utf8");
    expect(config).not.toContain("GROQ_API_KEY\"");
    expect(fs.readFileSync(".gitignore", "utf8")).toContain(".dev.vars");
  });
  it("uses the official Cloudflare voice pipeline and fallback", () => {
    const source = fs.readFileSync("src/server.ts", "utf8");
    expect(source).toContain("withVoice");
    expect(source).toContain("WorkersAIFluxSTT");
    expect(source).toContain("WorkersAITTS");
    expect(source).toContain("@cf/meta/llama-3.1-8b-instruct");
  });
});
