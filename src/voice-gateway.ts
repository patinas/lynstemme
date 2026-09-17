import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoice, WorkersAINova3STT, type TTSProvider, type VoiceTurnContext } from "@cloudflare/voice";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

type AiResponse = Response | { audio?: string; data?: string };
const textEncoder = new TextEncoder();
function secretEqual(a: string, b: string) { const aa=textEncoder.encode(a), bb=textEncoder.encode(b); if(aa.length!==bb.length) return false; let d=0; for(let i=0;i<aa.length;i++) d |= aa[i]^bb[i]; return d===0; }
type Env = { AI: Ai; TTS_USAGE?: D1Database; GEMINI_API_KEY?: string; TTS_RESERVATION_SECRET?: string; LIVEKIT_URL?: string; LIVEKIT_API_KEY?: string; LIVEKIT_API_SECRET?: string; ASSETS?: Fetcher; APP_PASSWORD?: string; LynStemmeAgent: DurableObjectNamespace; GROQ_API_KEY?: string; GROQ_CHAT_MODEL?: string; GROQ_STT_MODEL?: string; AI_BACKEND?: "auto" | "groq" | "workers-ai" | "local"; LOCAL_OPENAI_BASE_URL?: string; LOCAL_OPENAI_API_KEY?: string; LOCAL_MODEL?: string; };
const VoiceAgent = withVoice(Agent, { audioFormat: "pcm16", sampleRate: 24000 });
const SYSTEM_PROMPT = "Du er LynStemme, en dansk AI-stemmeassistent. Du skal altid svare på naturligt dansk, også når brugeren taler et andet sprog, medmindre brugeren udtrykkeligt beder om en oversættelse. Brug korte sætninger, danske ord og dansk talestil.";

function history(context: VoiceTurnContext, transcript: string) { return [{ role: "system", content: SYSTEM_PROMPT }, ...context.messages.map(({ role, content }) => ({ role, content })), { role: "user", content: transcript }]; }
function base64Bytes(value: string) { const raw = atob(value); return Uint8Array.from(raw, c => c.charCodeAt(0)).buffer; }

const GEMINI_TTS_DAILY_CAP = 10; // Intentionally below the owning free-tier quota.

class GeminiFreeTTS implements TTSProvider {
  constructor(private env: Env) {}
  async synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    if (!this.env.GEMINI_API_KEY || !this.env.TTS_USAGE) throw new Error("Gratis Gemini TTS er ikke konfigureret");
    const bucket = new Date().toISOString().slice(0, 10);
    const id = crypto.randomUUID();
    await this.env.TTS_USAGE.prepare("CREATE TABLE IF NOT EXISTS tts_free_usage (id TEXT PRIMARY KEY, bucket TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL)").run();
    const reserved = await this.env.TTS_USAGE.prepare("INSERT INTO tts_free_usage (id,bucket,created_at,status) SELECT ?1,?2,datetime('now'),'reserved' WHERE (SELECT count(*) FROM tts_free_usage WHERE bucket=?2) < ?3").bind(id, bucket, GEMINI_TTS_DAILY_CAP).run();
    if (!reserved.meta.changes) throw new Error("Den gratis daglige talegrænse er nået");
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", {
        method: "POST", signal,
        headers: { "content-type": "application/json", "x-goog-api-key": this.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Læs dette højt på naturligt dansk med varm, rolig og samtalende stemme. Sig kun teksten: ${text}` }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } } }
        })
      });
      if (!response.ok) throw new Error(`Gemini gratis TTS fejlede (${response.status})`);
      const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
      const audio = body.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
      if (!audio?.data || !audio.mimeType?.includes("rate=24000")) throw new Error("Gemini returnerede ikke 24 kHz PCM-lyd");
      await this.env.TTS_USAGE.prepare("UPDATE tts_free_usage SET status='completed' WHERE id=?1").bind(id).run();
      return base64Bytes(audio.data);
    } catch (error) {
      await this.env.TTS_USAGE.prepare("UPDATE tts_free_usage SET status='failed' WHERE id=?1").bind(id).run().catch(() => {});
      throw error;
    }
  }
}

function wavBytes(pcm: ArrayBuffer, rate = 16000): Uint8Array { const dataLen = pcm.byteLength; const wav = new Uint8Array(44 + dataLen); const dv = new DataView(wav.buffer); const ws = (o: number, t: string) => { for (let i = 0; i < t.length; i++) wav[o + i] = t.charCodeAt(i); }; ws(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); ws(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, dataLen, true); wav.set(new Uint8Array(pcm), 44); return wav; }

async function groqTranscribe(env: Env, pcm: ArrayBuffer): Promise<string> { if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY mangler"); const fd = new FormData(); fd.append("file", new Blob([wavBytes(pcm).buffer as ArrayBuffer], { type: "audio/wav" }), "audio.wav"); fd.append("model", env.GROQ_STT_MODEL || "whisper-large-v3-turbo"); fd.append("language", "da"); const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env.GROQ_API_KEY}` }, body: fd }); if (!response.ok) throw new Error(`Groq STT fejlede (${response.status})`); const body = await response.json() as { text?: string }; return (body.text || "").trim(); }

type STTOptions = { language?: string; onInterim?: (text: string) => void; onSpeechStart?: (text?: string) => void; onUtterance?: (transcript: string) => void; onFatalError?: (error: Error) => void };

class GroqWhisperSession {
  #chunks: ArrayBuffer[] = []; #bytes = 0; #speech = false; #silenceMs = 0; #speechMs = 0; #closed = false; #queue: Promise<void> = Promise.resolve();
  constructor(private env: Env, private options: STTOptions) {}
  feed(chunk: ArrayBuffer): void { if (this.#closed) return; const pcm = new Int16Array(chunk); let sum = 0; for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]; const rms = Math.sqrt(sum / Math.max(1, pcm.length)); const chunkMs = chunk.byteLength / 32; if (!this.#speech) { if (rms > 500) { this.#speech = true; this.#speechMs = chunkMs; this.#silenceMs = 0; this.#chunks = [chunk]; this.#bytes = chunk.byteLength; this.options.onSpeechStart?.(); } return; } this.#chunks.push(chunk); this.#bytes += chunk.byteLength; this.#speechMs += chunkMs; if (rms < 300) { this.#silenceMs += chunkMs; } else { this.#silenceMs = 0; } if (this.#silenceMs >= 700 || this.#speechMs >= 15000) this.#finishUtterance(); }
  #finishUtterance(): void { if (this.#speechMs < 300) { this.#reset(); return; } const total = new Uint8Array(this.#bytes); let off = 0; for (const c of this.#chunks) { total.set(new Uint8Array(c), off); off += c.byteLength; } const pcm = total.buffer; this.#reset(); this.#queue = this.#queue.then(async () => { if (this.#closed) return; try { const text = await groqTranscribe(this.env, pcm); if (text && !this.#closed) this.options.onUtterance?.(text); } catch (e) { if (!this.#closed) this.options.onFatalError?.(e instanceof Error ? e : new Error(String(e))); } }); }
  #reset(): void { this.#chunks = []; this.#bytes = 0; this.#speech = false; this.#silenceMs = 0; this.#speechMs = 0; }
  close(): void { this.#closed = true; this.#reset(); }
}

class GroqWhisperSTT { constructor(private env: Env) {} createSession(options?: STTOptions) { return new GroqWhisperSession(this.env, options || {}); } }

async function openAICompatible(env: Env, transcript: string, context: VoiceTurnContext, local = false) {
  const base = local ? env.LOCAL_OPENAI_BASE_URL : "https://api.groq.com/openai/v1";
  const key = local ? env.LOCAL_OPENAI_API_KEY || "ollama" : env.GROQ_API_KEY;
  const model = local ? env.LOCAL_MODEL || "llama3.2:3b" : env.GROQ_CHAT_MODEL || "openai/gpt-oss-20b";
  if (!base || !key) throw new Error(local ? "LOCAL_OPENAI_BASE_URL mangler" : "GROQ_API_KEY mangler");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: history(context, transcript), temperature: 0.2 }), signal: context.signal });
  if (!response.ok) throw new Error(`Modelkald fejlede (${response.status})`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content || "Jeg kunne ikke danne et svar.";
}

export class LynStemmeAgent extends VoiceAgent<Env> {
  transcriber = new GroqWhisperSTT(this.env) as unknown as WorkersAINova3STT;
  tts = new GeminiFreeTTS(this.env);
  async onTurn(transcript: string, context: VoiceTurnContext) {
    const backend = this.env.AI_BACKEND || "auto";
    if (backend === "local") return openAICompatible(this.env, transcript, context, true);
    if (backend === "groq" || (backend === "auto" && this.env.GROQ_API_KEY)) return openAICompatible(this.env, transcript, context);
    const result = await this.env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages: history(context, transcript), max_tokens: 180 }) as { response?: string };
    return result.response || "Jeg kunne ikke danne et svar.";
  }
  async onCallStart(connection: Connection) { await this.speak(connection, "Hej, du taler med LynStemme. Hvad kan jeg hjælpe dig med i dag?"); }
}


async function reserveTts(env: Env) {
  if (!env.TTS_USAGE) throw new Error("Gratis Gemini TTS ledger mangler");
  const bucket = new Date().toISOString().slice(0, 10);
  const id = crypto.randomUUID();
  await env.TTS_USAGE.prepare("CREATE TABLE IF NOT EXISTS tts_free_usage (id TEXT PRIMARY KEY, bucket TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL)").run();
  const reserved = await env.TTS_USAGE.prepare("INSERT INTO tts_free_usage (id,bucket,created_at,status) SELECT ?1,?2,datetime('now'),'reserved-livekit' WHERE (SELECT count(*) FROM tts_free_usage WHERE bucket=?2) < ?3").bind(id, bucket, GEMINI_TTS_DAILY_CAP).run();
  if (!reserved.meta.changes) throw new Error("Den gratis daglige talegrænse er nået");
  return id;
}

export default { async fetch(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/livekit/token" && request.method === "POST") {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return Response.json({ error: "LiveKit Free is not configured" }, { status: 503 });
    const identity = `andreas-${crypto.randomUUID()}`;
    const roomName = `lynstemme-${crypto.randomUUID()}`;
    const access = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity, ttl: "10m" });
    access.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    access.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: "lynstemme" })] });
    return Response.json({ server_url: env.LIVEKIT_URL, participant_token: await access.toJwt() }, { headers: { "cache-control": "no-store" } });
  }
  if (url.pathname === "/internal/tts/reserve" && request.method === "POST") {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!env.TTS_RESERVATION_SECRET || !token || !secretEqual(token, env.TTS_RESERVATION_SECRET)) return new Response("Forbidden", { status: 403 });
    try { const id = await reserveTts(env); return Response.json({ reserved: true, id }); }
    catch (e) { return Response.json({ reserved: false, error: String(e).slice(0, 300) }, { status: 429 }); }
  }
  if (url.pathname === "/health") return Response.json({ status: "ok", role: "private-voice-gateway", language: "da-DK", stt: "groq-whisper-large-v3-turbo", tts: "gemini-2.5-flash-preview-tts-free-capped" });
  if (url.pathname === "/stt-audio-test" && request.method === "POST") {
    try { const pcm = await request.arrayBuffer(); const text = await groqTranscribe(env, pcm); return Response.json({ ok: true, provider: "groq-whisper", bytes: pcm.byteLength, transcript: text }); }
    catch (e) { return Response.json({ ok: false, error: String(e).slice(0, 400) }, { status: 502 }); }
  }
  if (url.pathname.startsWith("/agents/")) return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  return new Response("Not found", { status: 404 });
} } satisfies ExportedHandler<Env>;
