<script lang="ts">
  import { onMount } from "svelte";
  import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant, type TranscriptionSegment } from "livekit-client";

  type Message = { role: "user" | "assistant"; text: string };
  let room: Room | null = null;
  let status: "idle" | "connecting" | "listening" | "thinking" | "speaking" = "idle";
  let transcript: Message[] = [];
  let interimTranscript: string | null = null;
  let audioLevel = 0;
  let connected = false;
  let error: string | null = null;
  let isMuted = false;
  let text = "";
  let audioElements: HTMLMediaElement[] = [];

  const active = () => status !== "idle";
  const statusText = () => error || ({ idle: "Klar", connecting: "Forbinder...", listening: "Lytter...", thinking: "Tænker...", speaking: "Taler..." } as const)[status];

  function addFinal(role: "user" | "assistant", value: string) {
    if (!value.trim()) return;
    transcript = [...transcript, { role, text: value.trim() }];
  }

  async function startCall() {
    error = null; status = "connecting";
    try {
      const response = await fetch("/livekit/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(`LiveKit Free kunne ikke startes (${response.status})`);
      const { server_url, participant_token } = await response.json() as { server_url: string; participant_token: string };
      const next = new Room({ adaptiveStream: true, dynacast: true });
      next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) { const element = track.attach(); element.autoplay = true; document.body.appendChild(element); audioElements.push(element); }
      });
      next.on(RoomEvent.ActiveSpeakersChanged, speakers => {
        const agent = speakers.find(p => p.identity !== next.localParticipant.identity);
        audioLevel = agent?.audioLevel || next.localParticipant.audioLevel || 0;
        status = agent ? "speaking" : "listening";
      });
      next.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant) => {
        const role = participant?.identity === next.localParticipant.identity ? "user" : "assistant";
        const final = segments.filter(s => s.final).map(s => s.text).join(" ");
        const partial = segments.filter(s => !s.final).map(s => s.text).join(" ");
        interimTranscript = role === "user" && partial ? partial : null;
        if (final) { addFinal(role, final); if (role === "user") status = "thinking"; }
      });
      next.on(RoomEvent.Disconnected, () => { connected = false; status = "idle"; });
      next.on(RoomEvent.Reconnecting, () => { status = "connecting"; });
      next.on(RoomEvent.Reconnected, () => { status = "listening"; });
      await next.connect(server_url, participant_token);
      await next.localParticipant.setMicrophoneEnabled(true);
      room = next; connected = true; status = "listening";
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); status = "idle"; await endCall(); }
  }

  async function endCall() {
    if (room) { await room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); room.disconnect(); room = null; }
    for (const element of audioElements) element.remove();
    audioElements = []; connected = false; status = "idle"; audioLevel = 0;
  }

  async function toggleCall() { if (active()) await endCall(); else await startCall(); }
  async function toggleMute() { if (!room) return; isMuted = !isMuted; await room.localParticipant.setMicrophoneEnabled(!isMuted); }
  async function send() {
    const value = text.trim(); if (!value) return;
    if (!room || !connected) await startCall();
    if (!room || !connected) return;
    await room.localParticipant.sendText(value, { topic: "lk.chat" });
    addFinal("user", value); text = ""; status = "thinking";
  }
  onMount(() => () => { void endCall(); });
</script>

<svelte:head><title>LynStemme · Dansk AI voice agent</title></svelte:head>
<main>
  <section class="hero">
    <div class="brand"><img src="/logo.svg" alt=""/> LynStemme <small>Rust · LiveKit · Gemini Free</small></div>
    <h1>Tal naturligt.<br/><em>Få svar med det samme.</em></h1>
    <p>Dansk AI-stemmeagent med WebRTC, naturlige afbrydelser og samtalehistorik.</p>
    <div class:idle={status === "idle"} class:listening={status === "listening"} class:thinking={status === "thinking" || status === "connecting"} class:speaking={status === "speaking"} class="orb" style={`--level:${Math.max(0.14, audioLevel)}`}>
      <button aria-label={active() ? "Afslut samtale" : "Start samtale"} onclick={toggleCall}>{active() ? "■" : "●"}</button>
    </div>
    <div class="status"><i class:online={connected}></i>{statusText()}</div>
    {#if active()}<button class="mute" onclick={toggleMute}>{isMuted ? "Slå mikrofon til" : "Slå mikrofon fra"}</button>{/if}
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
    <form onsubmit={(event) => { event.preventDefault(); void send(); }}><input aria-label="Skriv til LynStemme" bind:value={text} placeholder="Skriv en testbesked..."/><button>Send</button></form>
    <footer><span>Rust · Svelte · LiveKit</span><span>Groq · Gemini Free</span></footer>
  </section>
</main>
