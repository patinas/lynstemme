/** Reserve a Gemini Free TTS attempt in Cloudflare D1 before provider use. */
export async function reserveFreeTtsAttempt(text: string, signal?: AbortSignal): Promise<void> {
  const url = process.env.TTS_RESERVATION_URL;
  const secret = process.env.TTS_RESERVATION_SECRET;
  if (!url || !secret) throw new Error("Free TTS reservation is not configured");
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ chars: text.length }),
  });
  if (!response.ok) throw new Error(`Free TTS reservation refused (${response.status})`);
  const body = await response.json() as { reserved?: boolean };
  if (body.reserved !== true) throw new Error("Free TTS reservation refused");
}
