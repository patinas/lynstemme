import "dotenv/config";
import { cli, defineAgent, inference, ServerOptions, voice, type JobContext } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import { EdgeTTS } from "./edge-tts.js";

const INSTRUCTIONS = "Du er LynStemme, en dansk AI-stemmeassistent. Svar altid kort og naturligt på dansk, medmindre brugeren udtrykkeligt beder om en oversættelse.";

export default defineAgent({
  prewarm: async (proc) => { proc.userData.vad = await silero.VAD.load(); },
  entry: async (ctx: JobContext) => {
    if (!process.env.GROQ_API_KEY) throw new Error("Required free-tier provider keys are missing");
    const tts = new EdgeTTS("da-DK-ChristelNeural");
    const agent = voice.Agent.create({
      instructions: INSTRUCTIONS,
    });
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: openai.STT.withGroq({ model: "whisper-large-v3-turbo", language: "da" }),
      llm: openai.LLM.withGroq({ model: "openai/gpt-oss-20b", temperature: 0.2 }),
      tts,
      turnDetection: new inference.TurnDetector(),
      turnHandling: { interruption: { mode: "adaptive" } },
    });
    await session.start({ room: ctx.room, agent });
    await ctx.connect();
    await session.generateReply({ instructions: "Hils kort på dansk og spørg, hvad du kan hjælpe med." });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: "lynstemme" }));
