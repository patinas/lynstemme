import { describe, expect, it } from "vitest";
import { danishVoice } from "../src/browser-tts";

const voice = (lang: string, localService = false, name = lang) => ({ lang, localService, name }) as SpeechSynthesisVoice;

describe("Danish browser voice selection", () => {
  it("prefers a local exact da-DK voice", () => {
    const picked = danishVoice([voice("da", true), voice("da-DK"), voice("da_DK", true, "local")]);
    expect(picked?.name).toBe("local");
  });
  it("falls back to another Danish locale", () => {
    expect(danishVoice([voice("en-US", true), voice("da-GL")])?.lang).toBe("da-GL");
  });
  it("returns undefined when Danish is unavailable so utterance lang can request da-DK", () => {
    expect(danishVoice([voice("en-US", true)])).toBeUndefined();
  });
});
