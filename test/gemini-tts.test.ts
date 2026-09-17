import { describe, expect, it } from "vitest";
import fs from "node:fs";
const source = fs.readFileSync("src/voice-gateway.ts", "utf8");
describe("free-only Gemini Danish TTS", () => {
  it("uses only Gemini Flash TTS with natural Danish instructions", () => {
    expect(source).toContain("gemini-2.5-flash-preview-tts:generateContent");
    expect(source).toContain("naturligt dansk");
    expect(source).toContain('voiceName: "Sulafat"');
    expect(source).not.toContain("speechSynthesis");
  });
  it("reserves usage before the network call and hard-caps it", () => {
    expect(source.indexOf("INSERT INTO tts_free_usage")).toBeLessThan(source.indexOf("generativelanguage.googleapis.com"));
    expect(source).toContain("GEMINI_TTS_DAILY_CAP = 10");
    expect(source).toContain("if (!reserved.meta.changes)");
  });
  it("fails closed if the key or usage store is missing", () => {
    expect(source).toContain("!this.env.GEMINI_API_KEY || !this.env.TTS_USAGE");
  });
});
