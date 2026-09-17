# Scale pricing

Prices checked 17 September 2026. USD, excluding tax. This estimate covers browser voice, not ordinary phone calls.

## Assumptions per conversation minute

- the user speaks 30 seconds
- the assistant speaks 30 seconds, about 750 characters
- Groq receives 250 input tokens and returns 75 output tokens

| Layer | Current unit price | Estimated cost per conversation minute |
| --- | ---: | ---: |
| Cloudflare Flux STT | $0.0077/audio minute | $0.00385 |
| Cloudflare Aura-1 TTS | $0.015/1,000 characters | $0.01125 |
| Groq GPT-OSS 20B | $0.075/M input, $0.30/M output tokens | $0.000041 |
| **AI total** | | **$0.01514** |

A five-minute conversation is about $0.0757 in AI usage under these assumptions.

| Monthly conversation minutes | Estimated AI usage |
| ---: | ---: |
| 1,000 | $15.14 |
| 10,000 | $151.41 |
| 100,000 | $1,514.06 |

Cloudflare Workers Paid starts at $5/month. After included usage, Workers requests are $0.30/M, Durable Object requests $0.15/M, and Durable Object duration $12.50/M GB-s. Egress has no separate charge. Actual platform cost depends on connection duration, memory, request volume and stored history.

Workers AI includes 10,000 neurons/day at no charge. It is useful for prototypes, not a promise that sustained voice traffic is free. Groq's free tier is also rate-limited.

## Optional phone calls

Browser voice has no carrier charge. Calling ordinary Danish numbers adds a SIP/PSTN provider. Twilio currently lists $0.024/min to Danish landlines and $0.0564/min to mobiles, before number rental and optional features.

## Sources

- https://developers.cloudflare.com/workers-ai/models/flux/
- https://developers.cloudflare.com/workers-ai/models/aura-1/
- https://console.groq.com/docs/model/openai/gpt-oss-20b.md
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://www.twilio.com/en-us/voice/pricing/dk
