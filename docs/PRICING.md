# Pricing and free-tier boundary

Checked 17 September 2026. LynStemme is free-first. No paid provider may be enabled without separate owner approval.

## Default browser voice path

| Layer | Default | LynStemme usage price |
| --- | --- | ---: |
| Danish TTS | Browser/device Web Speech API, local `da-DK` preferred | $0 |
| Danish STT | Groq Whisper `whisper-large-v3-turbo`, `language=da` | $0 while inside Groq's free-tier limits |
| Chat | Groq `openai/gpt-oss-20b` | $0 while inside Groq's free-tier limits |
| Local fallback | Owner-hosted OpenAI-compatible endpoint | No provider charge; the owner's compute/network may cost money |
| Edge and state | Cloudflare Workers and Durable Objects | $0 while inside current included allowances |

The browser TTS voice and quality depend on the device. Groq's free tier is rate-limited and its limits can change. It is not an unlimited free service. Workers AI includes 10,000 neurons per day at no charge, but use above the current allocation is billable. Cloudflare Workers and Durable Objects also have plan and usage limits. Check current dashboards and official pricing before scaling.

The previous paid Inworld TTS path is removed. It returned HTTP 402 without an AI Gateway balance and is not part of the default design.

## If free quotas are exhausted

LynStemme should fail clearly or use a configured local OpenAI-compatible service. It must not silently turn on billable AI or telephony. Calling ordinary Danish phone numbers remains a separate SIP/PSTN product and requires separate approval.

## Sources

- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/model/openai/gpt-oss-20b.md
- https://console.groq.com/docs/speech-to-text
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
