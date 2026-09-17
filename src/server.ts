import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoice, WorkersAINova3STT, type TTSProvider, type VoiceTurnContext } from "@cloudflare/voice";

type AiResponse = Response | { audio?: string; data?: string };
type Env = { AI: Ai; ASSETS?: Fetcher; APP_PASSWORD?: string; LynStemmeAgent: DurableObjectNamespace; GROQ_API_KEY?: string; GROQ_CHAT_MODEL?: string; AI_BACKEND?: "auto" | "groq" | "workers-ai" | "local"; LOCAL_OPENAI_BASE_URL?: string; LOCAL_OPENAI_API_KEY?: string; LOCAL_MODEL?: string; };
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
  transcriber = new WorkersAINova3STT(this.env.AI, { language: "da", endpointingMs: 400 });
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
  if (url.pathname === "/stt-check") { let input; try { const qp = url.searchParams.get("p"); input = qp ? JSON.parse(qp) : { encoding: "linear16", sample_rate: "16000", language: "da" }; } catch (e) { return Response.json({ ok: false, parse: String(e) }, { status: 400 }); } const response = await (env.AI as any).run("@cf/deepgram/nova-3", input, { websocket: true }) as Response; const ws = response.webSocket; if (!ws) { const body = await response.text().catch(() => ""); return Response.json({ ok: false, status: response.status, error: body.slice(0, 500) }, { status: 502 }); } ws.accept(); ws.close(); return Response.json({ ok: true, model: "nova-3", input, transport: "websocket" }); }
  if (url.pathname === "/tts-test") { const text = url.searchParams.get("text") || "Hej, mit navn er LynStemme. Jeg taler flydende dansk hver dag."; const model = url.searchParams.get("m") || "@cf/inworld/tts-2"; const voice = url.searchParams.get("voice") || "Sophie"; const lang = url.searchParams.get("lang") || "da-DK"; let result; try { result = await (env.AI as any).run(model, { text, voice_id: voice, language: lang, output_format: "mp3", timestamp_type: "none" }, { returnRawResponse: true }) as unknown as AiResponse; } catch (e) { return Response.json({ ok: false, thrown: String(e).slice(0, 400) }, { status: 502 }); } if (result instanceof Response) { if (!result.ok) { const body = await result.text().catch(() => ""); return Response.json({ ok: false, status: result.status, error: body.slice(0, 500) }, { status: 502 }); } return new Response(await result.arrayBuffer(), { headers: { "content-type": "audio/mpeg" } }); } const encoded = result.audio || result.data; if (!encoded) return Response.json({ ok: false, shape: Object.keys(result as object) }, { status: 502 }); return new Response(base64Bytes(encoded), { headers: { "content-type": "audio/mpeg" } }); }
  if (url.pathname === "/stt-audio-test" && request.method === "POST") { const rate = url.searchParams.get("rate") || "16000"; const mode = url.searchParams.get("mode") || "detect"; const input: Record<string, unknown> = { encoding: "linear16", sample_rate: rate, interim_results: "true", vad_events: "true", endpointing: "400", utterance_end_ms: "1000", smart_format: "true", punctuate: "true" }; if (mode === "detect") input.detect_language = "true"; else if (mode !== "none") input.language = mode; const response = await (env.AI as any).run("@cf/deepgram/nova-3", input, { websocket: true }) as Response; const ws = response.webSocket; if (!ws) { const body = await response.text().catch(() => ""); return Response.json({ ok: false, status: response.status, error: body.slice(0, 500) }, { status: 502 }); } const pcm = await request.arrayBuffer(); const results: unknown[] = []; ws.accept(); ws.addEventListener("message", (ev: MessageEvent) => { try { const d = JSON.parse(typeof ev.data === "string" ? ev.data : ""); if (d.type === "Results") { const t = d.channel?.alternatives?.[0]?.transcript; if (t) results.push({ t, final: !!d.speech_final, lang: d.channel?.detected_language }); } else if (d.type && d.type !== "Metadata") results.push({ event: d.type }); } catch { /* ignore */ } }); const CHUNK = 8192; for (let off = 0; off < pcm.byteLength; off += CHUNK) { ws.send(pcm.slice(off, off + CHUNK)); await new Promise((r) => setTimeout(r, 200)); } ws.send(JSON.stringify({ type: "CloseStream" })); await new Promise((r) => setTimeout(r, 9000)); try { ws.close(); } catch { /* ignore */ } return Response.json({ ok: true, mode, bytes: pcm.byteLength, results }); }
  if (url.pathname.startsWith("/agents/")) return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
} } satisfies ExportedHandler<Env>;
