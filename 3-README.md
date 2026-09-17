# LynStemme

Free-first Danish browser voice agent on Cloudflare Voice Agents (beta), with Groq as the fast LLM and Workers AI as the no-secret fallback.

## Included
- continuous browser microphone audio over WebSocket
- Cloudflare Flux STT with automatic Danish turn detection
- Groq chat when `GROQ_API_KEY` is set
- automatic Workers AI Llama fallback when it is not
- Cloudflare Aura TTS, interruption handling and Durable Object conversation history
- responsive Danish React client, text fallback, health endpoint and tests

## Run
```bash
npm install
cp .dev.vars.example .dev.vars
npm test
npm run dev
```
Open the local HTTPS URL, allow microphone access and press the glowing button. Set the production secret with `npx wrangler secret put GROQ_API_KEY`, then `npm run deploy`. `GET /health` reports the selected backend without exposing keys.

## Backends
`AI_BACKEND=auto` uses Groq when its secret exists, otherwise Workers AI. `AI_BACKEND=workers-ai` forces the Cloudflare fallback. `AI_BACKEND=local` calls a network-reachable OpenAI-compatible endpoint configured by `LOCAL_OPENAI_BASE_URL`. A Worker cannot call `localhost` on the u3 server, so exposing Ollama needs an authenticated private tunnel; do not publish Ollama directly.

## Cost boundary
The repository is open source. Cloudflare Workers, Durable Objects and Workers AI have free allocations, but scale beyond them is paid. Groq's developer tier is rate-limited and not unlimited. Ordinary +45 calls are not included: Twilio/Telnyx/SIP adds per-minute carrier cost. Browser-to-browser voice needs no PSTN carrier.

See [Cloudflare's current Voice documentation](https://developers.cloudflare.com/agents/communication-channels/voice/) and [Voice Agent guide](https://developers.cloudflare.com/agents/guides/build-a-voice-agent/). The API is beta and is pinned to `@cloudflare/voice` 0.4.x.

## Tests
`npm test` checks config/secret safety and the Cloudflare voice pipeline. `npm run build` runs TypeScript and a production Workers bundle. A real voice test still needs a Cloudflare deployment because STT/TTS use the remote Workers AI binding.

## License
MIT
