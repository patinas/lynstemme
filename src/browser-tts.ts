const NATURAL_DANISH_NAMES = [
  "christel", "jeppe", // Microsoft neural Danish voices
  "sara",              // Apple enhanced/premium Danish voice
  "google dansk", "google danish",
];
const QUALITY_MARKERS = ["natural", "neural", "enhanced", "premium"];

function language(voice: SpeechSynthesisVoice) {
  return voice.lang.toLowerCase().replace("_", "-");
}

function qualityScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const exactDanish = language(voice) === "da-dk";
  const danish = exactDanish || language(voice) === "da" || language(voice).startsWith("da-");
  if (!danish) return -1;
  let score = exactDanish ? 100 : 70;
  if (NATURAL_DANISH_NAMES.some(marker => name.includes(marker))) score += 100;
  if (QUALITY_MARKERS.some(marker => name.includes(marker))) score += 80;
  // Browser-provided online voices are often neural. A generic local voice can
  // be the older robotic OS synthesizer, so localService is only a tiebreaker.
  if (!voice.localService) score += 15;
  if (voice.default) score += 2;
  return score;
}

export function danishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return voices
    .map((voice, index) => ({ voice, index, score: qualityScore(voice) }))
    .filter(candidate => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice;
}

async function availableVoices(synth: SpeechSynthesis, waitMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const immediate = synth.getVoices();
  if (immediate.length || typeof synth.addEventListener !== "function") return immediate;
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); synth.removeEventListener("voiceschanged", done); resolve(synth.getVoices()); };
    const timer = setTimeout(done, waitMs);
    synth.addEventListener("voiceschanged", done, { once: true });
  });
}

export async function speakDanish(text: string, synth = window.speechSynthesis): Promise<boolean> {
  if (!text.trim() || !synth || typeof SpeechSynthesisUtterance === "undefined") return false;
  const voice = danishVoice(await availableVoices(synth));
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "da-DK";
  utterance.rate = 0.97;
  utterance.pitch = 1.02;
  synth.speak(utterance);
  return true;
}
