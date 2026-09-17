import "dotenv/config";
import { cli, defineAgent, inference, ServerOptions, voice, type JobContext } from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import { reserveFreeTtsAttempt } from "./free-guard.js";

const INSTRUCTIONS = "Du er LynStemme, en dansk AI-stemmeassistent. Svar altid kort og naturligt på dansk, medmindre brugeren udtrykkeligt beder om en oversættelse.";

export default defineAgent({
  prewarm: async (proc) => { proc.userData.vad = await silero.VAD.load(); },
  entry: async (ctx: JobContext) => {
    if (!process.env.GOOGLE_API_KEY || !process.env.GROQ_API_KEY) throw new Error("Required free-tier provider keys are missing");
    const tts = new google.beta.TTS({
      model: "gemini-2.5-flash-preview-tts",
      voiceName: "Sulafat",
      instructions: "Læs teksten på naturligt dansk med en varm, rolig og samtalende stemme. Sig kun teksten.",
      apiKey: process.env.GOOGLE_API_KEY,
    });
    const agent = voice.Agent.create({
      instructions: INSTRUCTIONS,
      async *ttsNode(nodeCtx, text, modelSettings) {
        async function* guardedText() {
          for await (const segment of text) {
            await reserveFreeTtsAttempt(segment);
            yield segment;
          }
        }
        const audio = await voice.Agent.default.ttsNode(nodeCtx.agent, guardedText(), modelSettings);
        if (!audio) throw new Error("Gemini TTS produced no audio stream");
        for await (const frame of audio) yield frame;
      },
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
