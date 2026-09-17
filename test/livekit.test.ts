import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("LiveKit free-only realtime layer", () => {
  const agent = fs.readFileSync("livekit-agent/src/agent.ts", "utf8");
  const guard = fs.readFileSync("livekit-agent/src/free-guard.ts", "utf8");
  const client = fs.readFileSync("src/App.svelte", "utf8");
  const gateway = fs.readFileSync("src/voice-gateway.ts", "utf8");
  it("uses LiveKit turn detection and adaptive interruption", () => {
    expect(agent).toContain("new inference.TurnDetector()");
    expect(agent).toContain('mode: "adaptive"');
  });
  it("uses private Rust-routed tokens and WebRTC in Svelte", () => {
    expect(client).toContain("/livekit/token");
    expect(client).toContain("new Room(");
    expect(gateway).toContain("new AccessToken");
    expect(gateway).toContain("RoomAgentDispatch");
  });
  it("retains Danish Groq STT/chat and Gemini TTS", () => {
    expect(agent).toContain('language: "da"');
    expect(agent).toContain('model: "openai/gpt-oss-20b"');
    expect(agent).toContain('model: "gemini-2.5-flash-preview-tts"');
    expect(agent).toContain('voiceName: "Sulafat"');
  });
  it("reserves before each text segment and fails closed", () => {
    expect(agent.indexOf("reserveFreeTtsAttempt(segment)")).toBeLessThan(agent.indexOf("yield segment"));
    expect(guard).toContain("if (!url || !secret) throw");
    expect(guard).toContain("if (!response.ok) throw");
  });
});
