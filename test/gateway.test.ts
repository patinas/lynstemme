import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("private voice gateway", () => {
  const config = fs.readFileSync("wrangler.voice-gateway.jsonc", "utf8");
  const source = fs.readFileSync("src/voice-gateway.ts", "utf8");
  it("has no public workers.dev endpoint or assets", () => {
    expect(config).toContain('"workers_dev": false');
    expect(config).not.toContain('"assets"');
  });
  it("retains verified Danish Groq Whisper and free browser TTS contract", () => {
    expect(source).toContain("GroqWhisperSTT");
    expect(source).toContain('fd.append("language", "da")');
    expect(source).toContain("BrowserTTS");
    expect(source).not.toContain("inworld/tts");
  });
  it("only exposes voice and diagnostic handlers", () => {
    expect(source).toContain('url.pathname.startsWith("/agents/")');
    expect(source).not.toContain("loginPage");
    expect(source).not.toContain("ASSETS.fetch");
  });
});
