import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from openai import OpenAI

app = FastAPI(title="LynStemme", version="0.1.0")

ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".webm"}
DEFAULT_PROMPT = "Du er en hjælpsom dansk AI-stemmeassistent. Svar kort og naturligt på dansk."


def _client() -> tuple[OpenAI, str]:
    backend = os.getenv("AI_BACKEND", "groq").lower()
    if backend == "groq":
        key = os.getenv("GROQ_API_KEY")
        if not key:
            raise HTTPException(503, "GROQ_API_KEY mangler. Brug en nøgle eller vælg AI_BACKEND=local.")
        return OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1"), os.getenv(
            "GROQ_CHAT_MODEL", "llama-3.3-70b-versatile"
        )
    return OpenAI(api_key="ollama", base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")), os.getenv(
        "OLLAMA_MODEL", "llama3.2:3b"
    )


def _transcribe(path: str) -> str:
    backend = os.getenv("AI_BACKEND", "groq").lower()
    if backend == "groq":
        client, _ = _client()
        with open(path, "rb") as audio:
            result = client.audio.transcriptions.create(
                model=os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"), file=audio, language="da"
            )
        return result.text

    from faster_whisper import WhisperModel

    model = WhisperModel(os.getenv("LOCAL_WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(path, language="da")
    return " ".join(segment.text.strip() for segment in segments).strip()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "backend": os.getenv("AI_BACKEND", "groq")}


@app.post("/v1/turn")
async def turn(
    audio: UploadFile = File(...),
    system_prompt: str = Form(DEFAULT_PROMPT),
) -> dict[str, str]:
    suffix = Path(audio.filename or "audio.wav").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(415, f"Ikke-understøttet lydformat: {suffix}")

    data = await audio.read()
    if not data or len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "Lydfilen skal være mellem 1 byte og 25 MB.")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        transcript = _transcribe(tmp.name)

    client, model = _client()
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcript},
        ],
        temperature=0.4,
    )
    reply = completion.choices[0].message.content or ""
    return {"transcript": transcript, "reply": reply, "model": model}
