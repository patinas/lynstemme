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
  transcriber = new WorkersAINova3STT(this.env.AI, { language: "da", endpointingMs: 400, keyterms: ["LynStemme", "Nordsvar", "Danmark"] });
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
  if (url.pathname === "/stt-check") { const result = await (env.AI as any).run("@cf/deepgram/nova-3", { encoding: "linear16", sample_rate: "16000", language: "da" }, { websocket: true }) as unknown as { webSocket?: WebSocket }; if (!result.webSocket) return Response.json({ ok: false }, { status: 502 }); result.webSocket.accept(); result.webSocket.close(); return Response.json({ ok: true, model: "nova-3", language: "da", transport: "websocket" }); }
  if (url.pathname.startsWith("/agents/")) return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
} } satisfies ExportedHandler<Env>;
