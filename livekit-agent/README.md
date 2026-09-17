# LynStemme LiveKit agent

Optional realtime conversation layer approved for LynStemme. LiveKit carries WebRTC media, turn detection and interruption. Groq retains Danish Whisper STT and chat. Gemini Flash Preview TTS retains the Danish voice.

## Free-only safety

- Use only a LiveKit **Build** project with no payment method. Its included allowances are hard caps.
- Use only the separate billing-disabled Google AI Studio project.
- `TTS_RESERVATION_URL` points to the private Rust/Cloudflare endpoint. Every TTS request must reserve one of 10 daily attempts in D1 before Gemini is called. Missing configuration or any reservation failure stops speech.
- There is no LiveKit Inference TTS and no paid fallback.

Do not deploy until LiveKit Build status, no-payment-method state, current hard caps, Google billing-disabled state and Gemini quota have been inspected in their owning dashboards.
