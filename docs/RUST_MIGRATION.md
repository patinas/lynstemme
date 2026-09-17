# Rust migration

LynStemme is moving to a Rust-first Cloudflare architecture without taking the private TypeScript production app offline.

## Supported boundary

The `rust-worker/` crate owns the public edge: fail-closed password authentication, signed sessions, security headers, health reporting, backend selection, static assets, and routing. It compiles to WebAssembly with Cloudflare `workers-rs`.

Cloudflare's Voice Agents package and the Workers AI streaming STT handshake currently expose JavaScript/TypeScript APIs that have no equivalent in `workers-rs`. A small TypeScript Worker (`wrangler.voice-gateway.jsonc`, with `workers_dev=false` and no route) therefore remains as a private `VOICE_GATEWAY` service binding for `/agents/*`, `/stt-check`, and the Groq Whisper audio route. It is not an independently public application. The browser UI is Svelte/TypeScript.

This split keeps the unsupported API at a narrow adapter instead of pretending the whole voice stack can run in Rust today. It also lets the current private app stay available until parity is proven.

## Verification before cutover

1. `cd rust-worker && cargo test`
2. `cd rust-worker && cargo check --target wasm32-unknown-unknown`
3. Build UI and Rust Worker preview.
4. Run `LYNSTEMME_RUST_URL=... APP_PASSWORD=... node scripts/test-rust-integration.mjs`.
5. From a microphone-capable device, verify Danish STT, Groq reply, TTS, reconnect, and interruption.
6. Confirm anonymous `/`, assets, `/health`, `/agents/*`, and WebSocket upgrades all fail closed.
7. Cut over only after these checks match the existing deployment. Keep rollback available.

Secrets remain Cloudflare secrets and CI secrets. They are never placed in Wrangler config or Git.

## Free-first voice and model policy

- TTS uses Gemini 2.5 Flash Preview TTS on a separate billing-disabled Free Tier project. The gateway atomically reserves a D1 usage row before each request and hard-stops at 10 attempts/day. Missing D1/key or a reached cap fails closed; there is no paid fallback. Free Tier data may be used by Google, which Andreas accepted.
- Danish STT uses Groq Whisper (`whisper-large-v3-turbo`, language `da`) because Cloudflare's streaming Nova-3 endpoint rejected Danish in production tests. Groq's free tier is rate-limited and can change; exhaustion falls back only where the configured local OpenAI-compatible service is reachable.
- Chat uses Groq first, Workers AI only when its included allocation is available, and a configured local OpenAI-compatible endpoint as the no-provider-cost option. Local compute and network access can still have owner costs.
- No paid provider may be enabled without separate approval.

## LiveKit realtime layer

The approved target uses LiveKit Cloud Build for WebRTC media, turn detection, and adaptive interruption. `livekit-agent/` is a Node agent process on LiveKit Cloud; it is deliberately separate from Cloudflare Workers. Svelte connects with LiveKit's web SDK through a signed-token endpoint owned by the private Rust Worker. Groq continues to provide Danish Whisper STT and chat, and the separate billing-disabled Gemini project continues to provide Danish TTS.

LiveKit does not replace Danish TTS. No LiveKit Inference TTS or paid fallback is configured. The Build project must have no payment method, and its live dashboard must show the free hard-cap plan before deployment. Current published Build allowances are 1,000 agent-session minutes, 5,000 WebRTC participant minutes, and $2.50 inference credit; LynStemme does not consume the inference credit for TTS. Build cold starts may take 10-20 seconds and are a production test gate.

The LiveKit agent calls `/internal/tts/reserve` before passing each segment to Gemini. The private gateway atomically consumes the same 10-attempt UTC-day D1 ledger. Missing secrets, unavailable D1, rejection, or exhaustion prevents the Gemini call.
