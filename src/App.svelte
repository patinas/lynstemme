<script lang="ts">
  import { onMount } from "svelte";
  import { VoiceClient, type TranscriptMessage, type VoiceStatus } from "@cloudflare/voice/client";

  let client: VoiceClient;
  let status: VoiceStatus = "idle";
  let transcript: TranscriptMessage[] = [];
  let interimTranscript: string | null = null;
  let audioLevel = 0;
  let connected = false;
  let error: string | null = null;
  let isMuted = false;
  let text = "";

  const active = () => status !== "idle";
  const statusText = () => error || ({ idle: "Klar", listening: "Lytter...", thinking: "Tænker...", speaking: "Taler..." } as Record<string,string>)[status];

  onMount(() => {
    let session = localStorage.getItem("lynstemme-session");
    if (!session) { session = crypto.randomUUID(); localStorage.setItem("lynstemme-session", session); }
    client = new VoiceClient({ agent: "LynStemmeAgent", name: session });
    const sync = () => {
      status = client.status; transcript = client.transcript; interimTranscript = client.interimTranscript;
      audioLevel = client.audioLevel; connected = client.connected; error = client.error; isMuted = client.isMuted;
    };
    const events = ["statuschange", "transcriptchange", "interimtranscript", "audiolevelchange", "connectionchange", "error", "mutechange"] as const;
    events.forEach(event => client.addEventListener(event, sync));
    client.connect(); sync();
    return () => { events.forEach(event => client.removeEventListener(event, sync)); client.disconnect(); };
  });

  async function toggleCall() {
    if (active()) client.endCall();
    else await client.startCall();
  }
  function send() { const value = text.trim(); if (!value) return; client.sendText(value); text = ""; }
</script>

<svelte:head><title>LynStemme · Dansk AI voice agent</title></svelte:head>
<main>
  <section class="hero">
    <div class="brand"><img src="/logo.svg" alt=""/> LynStemme <small>Rust · Cloudflare Voice · Groq</small></div>
    <h1>Tal naturligt.<br/><em>Få svar med det samme.</em></h1>
    <p>Dansk AI-stemmeagent med realtidslyd, afbrydelser og samtalehistorik.</p>
    <div class:idle={status === "idle"} class:listening={status === "listening"} class:thinking={status === "thinking"} class:speaking={status === "speaking"} class="orb" style={`--level:${Math.max(0.14, audioLevel)}`}>
      <button aria-label={active() ? "Afslut samtale" : "Start samtale"} onclick={toggleCall}>{active() ? "■" : "●"}</button>
    </div>
    <div class="status"><i class:online={connected}></i>{statusText()}</div>
    {#if active()}<button class="mute" onclick={() => client.toggleMute()}>{isMuted ? "Slå mikrofon til" : "Slå mikrofon fra"}</button>{/if}
  </section>
  <section class="conversation" aria-label="Samtale">
    <h2>Samtale</h2>
    <div class="messages" aria-live="polite">
      {#if transcript.length === 0}<p class="empty">Start en samtale eller skriv en besked for at teste agenten.</p>{/if}
      {#each transcript as message, index (`${index}-${message.role}-${message.text}`)}
        <article class:user={message.role === "user"} class:assistant={message.role !== "user"}><b>{message.role === "user" ? "Dig" : "LynStemme"}</b><p>{message.text}</p></article>
      {/each}
      {#if interimTranscript}<article class="user interim"><b>Dig</b><p>{interimTranscript}</p></article>{/if}
    </div>
    <form onsubmit={(event) => { event.preventDefault(); send(); }}><input aria-label="Skriv til LynStemme" bind:value={text} placeholder="Skriv en testbesked..."/><button>Send</button></form>
    <footer><span>Rust-first · Svelte</span><span>Groq primær · Workers AI fallback</span></footer>
  </section>
</main>
