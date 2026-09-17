<p align="center"><img src="logo.svg" width="180" alt="LynStemme - lyn og dansk lydbølge"></p>
<h1 align="center">LynStemme</h1>
<p align="center"><strong>Privat dansk AI-stemmeagent på Cloudflare Voice Agents, med Groq som hurtig model og Workers AI eller lokal OpenAI-kompatibel model som fallback.</strong></p>

## Status

Den nuværende stabile version kører på `https://lynstemme.andreas-patinas.workers.dev`. Produktionen er privat: anonyme forespørgsler får HTTP 403 og kun login-siden. Alle app-, health-, asset- og WebSocket-ruter kræver en gyldig, signeret session.

## Arkitektur

- **UI:** Svelte 5 + den framework-uafhængige `@cloudflare/voice/client`
- **Runtime:** Cloudflare Worker + Agents SDK + SQLite Durable Object
- **Transport:** WebSocket via `/agents/*`
- **STT:** Groq Whisper `whisper-large-v3-turbo` med `language=da` (Cloudflare Nova-3 streaming afviser dansk, verificeret mod live runtime 2026-09-17). Energi-baseret VAD udløser barge-in og utterance-grænser
- **LLM:** Groq OpenAI-kompatibelt API, model `openai/gpt-oss-20b`
- **Fallback:** Workers AI `@cf/meta/llama-3.2-3b-instruct`
- **Valgfri lokal fallback:** Ollama eller anden netværkstilgængelig OpenAI-kompatibel server
- **TTS:** browserens indbyggede Web Speech API, som vælger lokal `da-DK` først og derefter en anden dansk stemme. Ingen betalt Inworld-afhængighed
- **Deployment:** GitHub Actions, Wrangler og krypterede repository secrets

## Privat adgang og sikkerhed

LynStemme bruger et stærkt ejer-password gemt uden for Git. Ved korrekt login udstedes en HMAC-signeret cookie med `HttpOnly`, `Secure`, `SameSite=Strict`, path `/` og 24 timers udløb. Sammenligninger er constant-time. Login-siden bruger `no-store` og `noindex`; deployment fejler lukket med 503, hvis adgangs-secret mangler.

Ingen API-nøgler, adgangskoder eller cookies må commits. Brug `.dev.vars` lokalt (ignoreret af Git) og GitHub Actions secrets i produktion.

Påkrævede produktions-secrets:

- `CLOUDFLARE_API_TOKEN` - Worker deployment og secrets
- `GROQ_API_KEY` - primær model
- `LYNSTEMME_PASSWORD` - privat ejerlogin

Workflowet finder selv det ene Cloudflare-account-id, som tokenet giver adgang til. Tokenet skal mindst kunne administrere Workers scripts og Worker secrets. Cloudflare Access er ikke en skjult afhængighed; privat adgang håndteres i Worker-koden.

## Opsætning

```bash
npm ci --legacy-peer-deps
cp .dev.vars.example .dev.vars
# udfyld kun lokale secrets i .dev.vars
npm run dev
```

Byg og test:

```bash
npm test
npm run typecheck
npm run build
```

Deploy manuelt med et scoped Cloudflare-token:

```bash
npm run build
npx wrangler secret put GROQ_API_KEY --config dist/lynstemme/wrangler.json
npx wrangler secret put APP_PASSWORD --config dist/lynstemme/wrangler.json
npx wrangler deploy --config dist/lynstemme/wrangler.json
```

Standard er `AI_BACKEND=auto`. Vælg `groq`, `workers-ai` eller `local` efter behov. Lokal fallback kræver `LOCAL_OPENAI_BASE_URL`; en lokal maskine bag NAT er ikke direkte tilgængelig fra Cloudflare uden en sikker tunnel.

## Verificeret produktion

- 2/2 Vitest-tests og produktionsbuild består
- anonym `/` returnerer 403
- ejerlogin åbner den rigtige app
- WebSocket, Durable Object, Groq-secret og modelsvar er verificeret med præcist dansk svar
- desktop og 390 x 844 mobil er kontrolleret uden vandret overflow
- talt dansk lyd (5,2 s, syntetiseret) transskriberet korrekt gennem produktionsendpointet `/stt-audio-test`: "Hej, mit navn er Lynstemme. Jeg taler flydende dansk hver eneste dag."
- Browser-TTS-valget er dækket af tests. Den faktiske stemmekvalitet afhænger af browseren og enhedens installerede danske stemmer

Den tilgængelige cloud-testbrowser afviser mikrofontilladelse. Derfor er ægte mikrofonoptagelse fra en browser og barge-in/afbrydelse ikke mærket som bestået. Talt dansk STT er verificeret med reel lydfil gennem produktionen. De kræver en manuel test fra en telefon eller browser med mikrofon tilladt.

## Rust-first migration

Cloudflare understøtter Rust Workers, men deres Voice Agents-SDK og Workers AI streaming-STT-handshake findes endnu ikke i `workers-rs`. Derfor flyttes edge, login, sessions, sikkerhed og routing til Rust/Wasm, mens den mindst mulige TypeScript-gateway beholder Voice Agent/Durable Object-integrationen. Svelte erstatter React. Den eksisterende private produktion bliver stående, indtil Rust/Svelte-versionen har bestået de samme live tests. Se [docs/RUST_MIGRATION.md](docs/RUST_MIGRATION.md).

## Pris og gratis/betalt grænse

Browserens indbyggede danske TTS har ingen LynStemme-forbrugspris. Browserstemme har ingen telefon- eller operatørudgift. Cloudflare Workers, Durable Objects og Workers AI samt Groq har gratis niveauer, men forbrug over deres aktuelle kvoter er betalt. Se den kildebaserede skalaoversigt i [docs/PRICING.md](docs/PRICING.md). PSTN/SIP-opkald til almindelige telefonnumre er en separat, betalt carrier-integration og er ikke del af denne browseragent.

Ingen skjulte betalte services er nødvendige. Lokal model kan reducere LLM-udgift, men kræver egen drift og en sikker, netværkstilgængelig endpoint.

## Begrænsninger

- Cloudflare Voice er stadig beta og API-adfærd kan ændre sig.
- Lokal fallback fra en Worker kræver et offentligt/sikkert endpoint, ikke `localhost`.
- Talt STT og afbrydelse skal genkontrolleres på en mikrofon-kompatibel klient efter større Voice SDK-opdateringer.
- Priser og gratis kvoter ændrer sig; verificér de officielle kilder før større skalering.

## Filer

- `rust-worker/` - Rust/Wasm edge, privat auth, routing og tests
- `src/server.ts` - smal TypeScript voice-gateway med Groq Whisper STT og model-routing
- `src/App.svelte` - Svelte-realtidsinterface og gratis browser-TTS
- `src/client.tsx` - voice UI og teksttest
- `wrangler.jsonc` - bindings, Durable Object, assets og runtime
- `.github/workflows/deploy.yml` - tests, build, secrets og deploy
- `docs/PRICING.md` - pris- og skalaestimat med kilder
