# LynStemme

A free-first, self-hosted Danish AI voice agent starter. The browser voice path has no telephony fee. Groq can be used for fast speech recognition and chat through its free developer tier, while Ollama and faster-whisper remain local fallbacks.

## What it does

- Accepts Danish audio uploads through a small FastAPI service
- Transcribes with Groq Whisper or local faster-whisper
- Generates a reply with a Groq model or local Ollama
- Returns text now, with a clean adapter point for Piper Danish TTS
- Keeps ordinary phone calling out of the free core because PSTN/SIP carriers charge per minute

## Quick start

1. Copy `.env.example` to `.env`.
2. For Groq, add your own `GROQ_API_KEY`. Groq is optional; no key is committed.
3. Run `docker compose up --build`.
4. Open `http://localhost:8000/docs` and try `POST /v1/turn` with a WAV, MP3, M4A, OGG, or WebM file.

By default, the project uses Groq's OpenAI-compatible API. Set `AI_BACKEND=local` to use Ollama plus faster-whisper on your own machine.

## Free versus paid

The source code and local components are free. Groq's developer free tier has current rate limits and is not a promise of unlimited free usage. Browser/app conversations can be run without a carrier. Calls to ordinary Danish `+45` numbers need a SIP/PSTN provider and are deliberately not included or presented as free.

## Architecture

`browser/app -> FastAPI -> STT adapter -> LLM adapter -> JSON reply`

Next step: connect this service to Pipecat SmallWebRTCTransport and add Piper `da_DK-talesyntese-medium` for streaming Danish speech output. Nordsvar's existing LiveKit/coturn setup can be used later when rooms or screen sharing are needed.

## API

- `GET /health`
- `POST /v1/turn` with multipart field `audio` and optional form field `system_prompt`

## Development

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload
```

## License

MIT
