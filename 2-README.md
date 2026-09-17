<p align="center"><img src="logo.svg" width="180" alt="LynStemme - lyn og dansk lydbølge"></p>
<h1 align="center">LynStemme</h1>
<p align="center"><strong>Privat dansk AI-stemmeagent på Cloudflare Voice Agents, med Groq som hurtig model og Workers AI eller lokal OpenAI-kompatibel model som fallback.</strong></p>

## Status

LynStemme er opdateret til Cloudflares aktuelle Voice Agents-arkitektur og kører på `https://lynstemme.andreas-patinas.workers.dev`. Produktionen er privat: anonyme forespørgsler får HTTP 403 og kun login-siden. Alle app-, health-, asset- og WebSocket-ruter kræver en gyldig, signeret session.

## Arkitektur

- **UI:** React + `@cloudflare/voice/react`
- **Runtime:** Cloudflare Worker + Agents SDK + SQLite Durable Object
- **Transport:** WebSocket via `/agents/*`
- **STT:** Workers AI Nova-3 med `da-DK`, 400 ms endpointing og danske nøgleord
- **LLM:** Groq OpenAI-kompatibelt API, model `openai/gpt-oss-20b`
- **Fallback:** Workers AI `@cf/meta/llama-3.2-3b-instruct`
- **Valgfri lokal fallback:** Ollama eller anden netværkstilgængelig OpenAI-kompatibel server
- **TTS:** Cloudflare Workers AI, `inworld/tts-2-flash`, dansk `da-DK`, stemmen Sophie
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
- health-metadata: `da-DK`, Nova-3 og Inworld TTS
- desktop og 390 x 844 mobil er kontrolleret uden vandret overflow
- TTS-pipelinen returnerede en færdig velkomstturn

Den tilgængelige cloud-testbrowser afviser mikrofontilladelse. Derfor er ægte mikrofonoptagelse, talt dansk STT og barge-in/afbrydelse ikke mærket som bestået. De kræver en manuel test fra en telefon eller browser med mikrofon tilladt.

## Pris og gratis/betalt grænse

Browserstemme har ingen telefon- eller operatørudgift. Cloudflare Workers, Durable Objects og Workers AI samt Groq har gratis niveauer, men forbrug over deres aktuelle kvoter er betalt. Se den kildebaserede skalaoversigt i [docs/PRICING.md](docs/PRICING.md). PSTN/SIP-opkald til almindelige telefonnumre er en separat, betalt carrier-integration og er ikke del af denne browseragent.

Ingen skjulte betalte services er nødvendige. Lokal model kan reducere LLM-udgift, men kræver egen drift og en sikker, netværkstilgængelig endpoint.

## Begrænsninger

- Cloudflare Voice er stadig beta og API-adfærd kan ændre sig.
- Lokal fallback fra en Worker kræver et offentligt/sikkert endpoint, ikke `localhost`.
- Talt STT og afbrydelse skal genkontrolleres på en mikrofon-kompatibel klient efter større Voice SDK-opdateringer.
- Priser og gratis kvoter ændrer sig; verificér de officielle kilder før større skalering.

## Filer

- `src/server.ts` - voice agent, dansk STT/LLM/TTS og privat auth
- `src/client.tsx` - voice UI og teksttest
- `wrangler.jsonc` - bindings, Durable Object, assets og runtime
- `.github/workflows/deploy.yml` - tests, build, secrets og deploy
- `docs/PRICING.md` - pris- og skalaestimat med kilder
