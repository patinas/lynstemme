import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoice, WorkersAINova3STT, type TTSProvider, type VoiceTurnContext } from "@cloudflare/voice";

type AiResponse = Response | { audio?: string; data?: string };
type Env = { AI: Ai; ASSETS?: Fetcher; APP_PASSWORD?: string; LynStemmeAgent: DurableObjectNamespace; GROQ_API_KEY?: string; GROQ_CHAT_MODEL?: string; GROQ_STT_MODEL?: string; AI_BACKEND?: "auto" | "groq" | "workers-ai" | "local"; LOCAL_OPENAI_BASE_URL?: string; LOCAL_OPENAI_API_KEY?: string; LOCAL_MODEL?: string; };
const VoiceAgent = withVoice(Agent);
const SYSTEM_PROMPT = "Du er LynStemme, en dansk AI-stemmeassistent. Du skal altid svare på naturligt dansk, også når brugeren taler et andet sprog, medmindre brugeren udtrykkeligt beder om en oversættelse. Brug korte sætninger, danske ord og dansk talestil.";

function history(context: VoiceTurnContext, transcript: string) { return [{ role: "system", content: SYSTEM_PROMPT }, ...context.messages.map(({ role, content }) => ({ role, content })), { role: "user", content: transcript }]; }
function base64Bytes(value: string) { const raw = atob(value); return Uint8Array.from(raw, c => c.charCodeAt(0)).buffer; }

class DanishTTS implements TTSProvider {
  constructor(private ai: Ai) {}
  async synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const result = await this.ai.run("inworld/tts-2-flash", { text, voice_id: "Sophie", language: "da-DK", output_format: "mp3", timestamp_type: "none" }, { returnRawResponse: true, ...(signal ? { signal } : {}) }) as unknown as AiResponse;
    if (result instanceof Response) return result.ok ? result.arrayBuffer() : null;
    const encoded = result.audio || result.data;
    return encoded ? base64Bytes(encoded) : null;
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
  tts = new DanishTTS(this.env.AI);
  async onTurn(transcript: string, context: VoiceTurnContext) {
    const backend = this.env.AI_BACKEND || "auto";
    if (backend === "local") return openAICompatible(this.env, transcript, context, true);
    if (backend === "groq" || (backend === "auto" && this.env.GROQ_API_KEY)) return openAICompatible(this.env, transcript, context);
    const result = await this.env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages: history(context, transcript), max_tokens: 180 }) as { response?: string };
    return result.response || "Jeg kunne ikke danne et svar.";
  }
  async onCallStart(connection: Connection) { await this.speak(connection, "Hej, du taler med LynStemme. Hvad kan jeg hjælpe dig med i dag?"); }
}

const encoder = new TextEncoder();
function secureEqual(a: string, b: string) {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  if (aa.length !== bb.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aa.length; i++) mismatch |= aa[i] ^ bb[i];
  return mismatch === 0;
}
async function signature(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function authorized(request: Request, secret: string) {
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)lynstemme_session=([^;]+)/)?.[1];
  if (!cookie) return false;
  const [expiry, sig] = cookie.split(".");
  if (!expiry || !sig || Number(expiry) < Date.now()) return false;
  return secureEqual(sig, await signature(secret, expiry));
}
function loginPage(error = false) {
  return new Response(`<!doctype html><html lang="da"><meta name="viewport" content="width=device-width"><title>Privat LynStemme</title><style>body{font:18px system-ui;background:#07111f;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}form{width:min(90vw,360px);padding:2rem;background:#10213a;border-radius:18px}input,button{box-sizing:border-box;width:100%;padding:.9rem;margin-top:1rem;border-radius:10px;border:1px solid #547;background:#fff;color:#111}button{background:#42d3a2;border:0;font-weight:700}p{color:#ff9d9d}</style><form method="post" action="/login"><h1>LynStemme</h1><div>Privat test for Andreas</div>${error ? "<p>Forkert adgangskode.</p>" : ""}<input type="password" name="password" autocomplete="current-password" aria-label="Adgangskode" required autofocus><button>Log ind</button></form></html>`, { status: error ? 401 : 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

export default { async fetch(request: Request, env: Env) {
  if (!env.APP_PASSWORD) return new Response("Private deployment is not configured", { status: 503 });
  const url = new URL(request.url);
  if (url.pathname === "/login" && request.method === "POST") {
    const supplied = String((await request.formData()).get("password") || "");
    if (!secureEqual(supplied, env.APP_PASSWORD)) return loginPage(true);
    const expiry = String(Date.now() + 24 * 60 * 60 * 1000);
    const sig = await signature(env.APP_PASSWORD, expiry);
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `lynstemme_session=${expiry}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`, "cache-control": "no-store" } });
  }
  if (!(await authorized(request, env.APP_PASSWORD))) return loginPage();
  if (url.pathname === "/health") return Response.json({ status: "ok", access: "private", backend: env.AI_BACKEND || (env.GROQ_API_KEY ? "groq" : "workers-ai"), voice: "cloudflare", language: "da-DK", stt: "nova-3", tts: "inworld-tts-2-flash" });
  if (url.pathname === "/stt-check") { let input; try { const qp = url.searchParams.get("p"); input = qp ? JSON.parse(qp) : {}; } catch (e) { return Response.json({ ok: false, parse: String(e) }, { status: 400 }); } const response = await (env.AI as any).run("@cf/deepgram/nova-3", input, { websocket: true }) as Response; const ws = response.webSocket; if (!ws) { const body = await response.text().catch(() => ""); return Response.json({ ok: false, status: response.status, error: body.slice(0, 500) }, { status: 502 }); } ws.accept(); ws.close(); return Response.json({ ok: true, model: "nova-3", input, transport: "websocket" }); }
  if (url.pathname === "/tts-test") { const raw = url.searchParams.get("in"); const model = url.searchParams.get("m") || "inworld/tts-2"; const input = raw ? JSON.parse(raw) : { text: url.searchParams.get("text") || "Hej, mit navn er LynStemme. Jeg taler flydende dansk hver dag." }; let result; try { result = await (env.AI as any).run(model, input, { returnRawResponse: true }) as unknown as AiResponse; } catch (e) { return Response.json({ ok: false, thrown: String(e).slice(0, 900) }, { status: 502 }); } if (result instanceof Response) { if (!result.ok) { const body = await result.text().catch(() => ""); return Response.json({ ok: false, status: result.status, error: body.slice(0, 900) }, { status: 502 }); } return new Response(await result.arrayBuffer(), { headers: { "content-type": "audio/mpeg" } }); } const encoded = result.audio || result.data; if (!encoded) return Response.json({ ok: false, shape: Object.keys(result as object) }, { status: 502 }); return new Response(base64Bytes(encoded), { headers: { "content-type": "audio/mpeg" } }); }
  if (url.pathname === "/stt-audio-test" && request.method === "POST") { try { const pcm = await request.arrayBuffer(); const text = await groqTranscribe(env, pcm); return Response.json({ ok: true, provider: "groq-whisper", bytes: pcm.byteLength, transcript: text }); } catch (e) { return Response.json({ ok: false, error: String(e).slice(0, 400) }, { status: 502 }); } }
  if (url.pathname.startsWith("/agents/")) return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
} } satisfies ExportedHandler<Env>;
