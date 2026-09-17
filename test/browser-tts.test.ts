import { describe, expect, it } from "vitest";
import { danishVoice } from "../src/browser-tts";

const voice = (lang: string, localService = false, name = lang, isDefault = false) => ({ lang, localService, name, default: isDefault }) as SpeechSynthesisVoice;

describe("natural Danish browser voice selection", () => {
  it("prefers a named neural Danish voice over a generic local voice", () => {
    const picked = danishVoice([voice("da-DK", true, "Dansk"), voice("da-DK", false, "Microsoft Christel Online (Natural) - Danish")]);
    expect(picked?.name).toContain("Christel");
  });
  it("prefers a quality-marked Danish voice", () => {
    const picked = danishVoice([voice("da-DK", true, "Generic"), voice("da-DK", true, "Sara Enhanced")]);
    expect(picked?.name).toBe("Sara Enhanced");
  });
  it("falls back to an exact Danish network voice before a generic local one", () => {
    expect(danishVoice([voice("da-DK", true, "Local"), voice("da-DK", false, "Online")])?.name).toBe("Online");
  });
  it("falls back to another Danish locale", () => {
    expect(danishVoice([voice("en-US", true), voice("da-GL")])?.lang).toBe("da-GL");
  });
  it("never selects a non-Danish voice", () => {
    expect(danishVoice([voice("en-US", true)])).toBeUndefined();
  });
});
