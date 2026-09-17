import { FormEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVoiceAgent } from "@cloudflare/voice/react";
import "./styles.css";

function App() {
  const session = useMemo(() => localStorage.getItem("lynstemme-session") || crypto.randomUUID(), []);
  localStorage.setItem("lynstemme-session", session);
  const voice = useVoiceAgent({ agent: "LynStemmeAgent", name: session });
  const [text, setText] = useState("");
  const active = voice.status !== "idle";
  const send = (e: FormEvent) => { e.preventDefault(); if (text.trim()) { voice.sendText(text.trim()); setText(""); } };
  return <main>
    <section className="hero">
      <div className="brand"><span className="bolt">ϟ</span> LynStemme <small>Cloudflare Voice + Groq</small></div>
      <h1>Tal naturligt.<br/><em>Få svar med det samme.</em></h1>
      <p>Dansk AI-stemmeagent med realtidslyd, afbrydelser og samtalehistorik.</p>
      <div className={`orb ${voice.status}`} style={{"--level": Math.max(0.14, voice.audioLevel) } as React.CSSProperties}>
        <button aria-label={active ? "Afslut samtale" : "Start samtale"} onClick={active ? voice.endCall : voice.startCall}>
          {active ? "■" : "●"}
        </button>
      </div>
      <div className="status"><i className={voice.connected ? "online" : ""}/>{voice.error || ({idle:"Klar",listening:"Lytter...",thinking:"Tænker...",speaking:"Taler..."}[voice.status])}</div>
      {active && <button className="mute" onClick={voice.toggleMute}>{voice.isMuted ? "Slå mikrofon til" : "Slå mikrofon fra"}</button>}
    </section>
    <section className="conversation" aria-label="Samtale">
      <h2>Samtale</h2>
      <div className="messages">
        {voice.transcript.length === 0 && <p className="empty">Start en samtale eller skriv en besked for at teste agenten.</p>}
        {voice.transcript.map((m, i) => <article className={m.role} key={i}><b>{m.role === "user" ? "Dig" : "LynStemme"}</b><p>{m.text}</p></article>)}
        {voice.interimTranscript && <article className="user interim"><b>Dig</b><p>{voice.interimTranscript}</p></article>}
      </div>
      <form onSubmit={send}><input aria-label="Skriv til LynStemme" value={text} onChange={e=>setText(e.target.value)} placeholder="Skriv en testbesked..."/><button>Send</button></form>
      <footer><span>Cloudflare Voice beta</span><span>Groq primær · Workers AI fallback</span></footer>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App/>);
