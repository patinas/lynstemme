import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoice, WorkersAINova3STT, type TTSProvider, type VoiceTurnContext } from "@cloudflare/voice";

type AiResponse = Response | { audio?: string; data?: string };
type Env = { AI: Ai; LynStemmeAgent: DurableObjectNamespace; GROQ_API_KEY?: string; GROQ_CHAT_MODEL?: string; AI_BACKEND?: "auto" | "groq" | "workers-ai" | "local"; LOCAL_OPENAI_BASE_URL?: string; LOCAL_OPENAI_API_KEY?: string; LOCAL_MODEL?: string; };
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
  transcriber = new WorkersAINova3STT(this.env.AI, { language: "da-DK", endpointingMs: 400, keyterms: ["LynStemme", "Nordsvar", "Danmark"] });
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

export default { async fetch(request: Request, env: Env) { const url = new URL(request.url); if (url.pathname === "/health") return Response.json({ status: "ok", backend: env.AI_BACKEND || (env.GROQ_API_KEY ? "groq" : "workers-ai"), voice: "cloudflare", language: "da-DK", stt: "nova-3", tts: "inworld-tts-2-flash" }); return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 }); } } satisfies ExportedHandler<Env>;
