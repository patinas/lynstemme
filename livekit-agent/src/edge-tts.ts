/**
 * Free Danish neural TTS through the Microsoft Edge read-aloud endpoint.
 * Zero cost, no API key, no billing. Returns raw PCM16 24 kHz mono audio.
 * Protocol mirrors the widely used edge-tts client.
 */
import { AudioByteStream, shortuuid, tts } from "@livekit/agents";
import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { AudioFrame } from "@livekit/rtc-node";
import { MPEGDecoder } from "mpg123-decoder";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const WIN_EPOCH_SECONDS = 11644473600;
const SAMPLE_RATE = 24000;
const CHANNELS = 1;

function secMsGec(): string {
  let ticks = Date.now() / 1000 + WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 1e7;
  return createHash("sha256").update(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii").digest("hex").toUpperCase();
}
function connectId(): string { return randomUUID().replace(/-/g, ""); }
function dateToString(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}
function escapeSsml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function synthesizeEdgePcm(text: string, voice: string, signal?: AbortSignal): Promise<Buffer> {
  const url = `${WSS_URL}&ConnectionId=${connectId()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='da-DK'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeSsml(text)}</prosody></voice></speak>`;
  return await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const ws = new WebSocket(url, {
      headers: {
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": `muid=${randomUUID().replace(/-/g, "").toUpperCase()};`,
      },
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      try { ws.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else if (chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error("Edge TTS returnerede ingen lyd"));
    };
    const onAbort = () => finish(new Error("Edge TTS afbrudt"));
    const timeout = setTimeout(() => finish(new Error("Edge TTS timeout")), 20000);
    signal?.addEventListener("abort", onAbort);
    ws.on("open", () => {
      ws.send(`X-Timestamp:${dateToString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      ws.send(`X-RequestId:${connectId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateToString()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      try {
        if (!isBinary) {
          const head = data.toString("utf8");
          if (/^Path:turn\.end$/m.test(head)) finish();
          return;
        }
        if (data.length < 2) return;
        const headerLength = data.readUInt16BE(0);
        if (headerLength > data.length - 2) return;
        const headersText = data.subarray(2, 2 + headerLength).toString("utf8");
        const body = data.subarray(2 + headerLength);
        if (!/^Path:audio$/m.test(headersText)) return;
        if (!/Content-Type:/m.test(headersText)) return; // stream termination marker
        if (body.length) chunks.push(body);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    ws.on("error", (error: Error) => finish(error));
    ws.on("close", () => finish());
  });
}


async function decodeMp3ToPcm16(mp3: Buffer): Promise<Buffer> {
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const { channelData, sampleRate } = decoder.decode(new Uint8Array(mp3));
    if (sampleRate !== SAMPLE_RATE) throw new Error(`Edge TTS løb ind i uventet sample rate ${sampleRate}`);
    const mono = channelData[0] || new Float32Array(0);
    const pcm = new Int16Array(mono.length);
    for (let i = 0; i < mono.length; i++) {
      const clamped = Math.max(-1, Math.min(1, mono[i]));
      pcm[i] = Math.round(clamped * 32767);
    }
    return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  } finally {
    decoder.free();
  }
}

export class EdgeTTS extends tts.TTS {
  label = "lynstemme.EdgeTTS";
  #voice: string;
  constructor(voice = "da-DK-ChristelNeural") {
    super(SAMPLE_RATE, CHANNELS, { streaming: false });
    this.#voice = voice;
  }
  synthesize(text: string, connOptions?: never, abortSignal?: AbortSignal): tts.ChunkedStream {
    return new EdgeChunkedStream(this, text, this.#voice, connOptions, abortSignal);
  }
  stream(): never {
    throw new Error("Streaming understøttes ikke af Edge TTS");
  }
}

class EdgeChunkedStream extends tts.ChunkedStream {
  label = "lynstemme.EdgeChunkedStream";
  #voice: string;
  constructor(ttsInstance: EdgeTTS, text: string, voice: string, connOptions?: never, abortSignal?: AbortSignal) {
    super(text, ttsInstance, connOptions, abortSignal);
    this.#voice = voice;
  }
  protected async run(): Promise<void> {
    try {
      const mp3 = await synthesizeEdgePcm(this.inputText, this.#voice, this.abortSignal);
      const pcm = await decodeMp3ToPcm16(mp3);
      const requestId = shortuuid();
      const audioByteStream = new AudioByteStream(SAMPLE_RATE, CHANNELS);
      const frames = audioByteStream.write(pcm);
      frames.push(...audioByteStream.flush());
      let lastFrame: AudioFrame | undefined;
      const sendLastFrame = (segmentId: string, final: boolean) => {
        if (lastFrame) {
          this.queue.put({ requestId, segmentId, frame: lastFrame, final });
          lastFrame = undefined;
        }
      };
      for (const frame of frames) {
        sendLastFrame(requestId, false);
        lastFrame = frame;
      }
      sendLastFrame(requestId, true);
      this.queue.close();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    } finally {
      this.queue.close();
    }
  }
    }
