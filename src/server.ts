import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from "@cloudflare/voice";

type Env = { AI: Ai; LynStemmeAgent: DurableObjectNamespace; GROQ_API_KEY?: string; GROQ_CHAT_MODEL?: string; AI_BACKEND?: "auto" | "groq" | "workers-ai" | "local"; LOCAL_OPENAI_BASE_URL?: string; LOCAL_OPENAI_API_KEY?: string; LOCAL_MODEL?: string; };
const VoiceAgent = withVoice(Agent);
const SYSTEM_PROMPT = "Du er LynStemme, en hjælpsom dansk AI-stemmeassistent. Svar kort, naturligt og på dansk.";
function history(context: VoiceTurnContext, transcript: string) { return [{ role: "system", content: SYSTEM_PROMPT }, ...context.messages.map(({ role, content }) => ({ role, content })), { role: "user", content: transcript }]; }
async function openAICompatible(env: Env, transcript: string, context: VoiceTurnContext, local = false) {
  const base = local ? env.LOCAL_OPENAI_BASE_URL : "https://api.groq.com/openai/v1";
  const key = local ? env.LOCAL_OPENAI_API_KEY || "ollama" : env.GROQ_API_KEY;
  const model = local ? env.LOCAL_MODEL || "llama3.2:3b" : env.GROQ_CHAT_MODEL || "openai/gpt-oss-20b";
  if (!base || !key) throw new Error(local ? "LOCAL_OPENAI_BASE_URL mangler" : "GROQ_API_KEY mangler");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: history(context, transcript), temperature: 0.3 }), signal: context.signal });
  if (!response.ok) throw new Error(`Modelkald fejlede (${response.status})`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content || "Jeg kunne ikke danne et svar.";
}
export class LynStemmeAgent extends VoiceAgent<Env> {
  transcriber = new WorkersAIFluxSTT(this.env.AI, { keyterms: ["LynStemme", "Nordsvar", "Danmark"] });
  tts = new WorkersAITTS(this.env.AI, { speaker: "luna" });
  async onTurn(transcript: string, context: VoiceTurnContext) {
    const backend = this.env.AI_BACKEND || "auto";
    if (backend === "local") return openAICompatible(this.env, transcript, context, true);
    if (backend === "groq" || (backend === "auto" && this.env.GROQ_API_KEY)) return openAICompatible(this.env, transcript, context);
    const result = await this.env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages: history(context, transcript), max_tokens: 180 }) as { response?: string };
    return result.response || "Jeg kunne ikke danne et svar.";
  }
  async onCallStart(connection: Connection) { await this.speak(connection, "Hej, du taler med LynStemme. Hvad kan jeg hjælpe med?"); }
}
export default { async fetch(request: Request, env: Env) { const url = new URL(request.url); if (url.pathname === "/health") { const backend = env.AI_BACKEND || (env.GROQ_API_KEY ? "groq" : "workers-ai"); return Response.json({ status: "ok", backend, voice: "cloudflare" }); } return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 }); } } satisfies ExportedHandler<Env>;
