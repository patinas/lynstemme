export function danishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const language = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().replace("_", "-");
  return voices.find(voice => language(voice) === "da-dk" && voice.localService)
    || voices.find(voice => language(voice) === "da-dk")
    || voices.find(voice => language(voice).startsWith("da-") && voice.localService)
    || voices.find(voice => language(voice).startsWith("da-"));
}

export function speakDanish(text: string, synth = window.speechSynthesis): boolean {
  if (!text.trim() || !synth || typeof SpeechSynthesisUtterance === "undefined") return false;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = danishVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "da-DK";
  utterance.rate = 1;
  synth.speak(utterance);
  return true;
}
