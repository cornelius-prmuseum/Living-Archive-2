"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";
import { AGENTS, type AgentSlug } from "@/lib/agents";

type TranscriptEntry = {
  slug: AgentSlug;
  text: string;
};

type DialogueSession = {
  slug: AgentSlug;
  conversation: any;
  speaking: boolean;
  lastText: string;
  turnText: string;
  timers: number[];
  packetCursorMs: number;
  turnStartedAt: number | null;
  spokeThisTurn: boolean;
};

type AudioAlignment = {
  chars: string[];
  starts: number[];
  durations: number[];
};

function normalizeAudioAlignment(payload: unknown): AudioAlignment | null {
  if (!payload || typeof payload !== "object") return null;
  const outer = payload as Record<string, unknown>;
  const source = outer.alignment && typeof outer.alignment === "object"
    ? outer.alignment as Record<string, unknown>
    : outer;
  const chars = source.chars;
  const starts = source.char_start_times_ms ?? source.charStartTimesMs;
  const durations = source.char_durations_ms ?? source.charDurationsMs;
  if (!Array.isArray(chars) || !Array.isArray(starts)) return null;
  if (!chars.every((value) => typeof value === "string")) return null;
  if (!starts.every((value) => typeof value === "number")) return null;
  return {
    chars: chars as string[],
    starts: starts as number[],
    durations: Array.isArray(durations) && durations.every((value) => typeof value === "number")
      ? durations as number[]
      : [],
  };
}

function extractAgentText(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const nested = e.agent_response_event as Record<string, unknown> | undefined;
  const candidates = [e.message, e.text, e.transcript, nested?.agent_response];
  const text = candidates.find((value) => typeof value === "string" && value.trim()) as string | undefined;
  if (!text) return null;
  const source = String(e.source ?? e.role ?? e.type ?? "").toLowerCase();
  const isAgent = Boolean(nested) || source === "ai" || source.includes("agent") || source.includes("assistant");
  return isAgent ? text.trim() : null;
}

function modeIsSpeaking(event: unknown): boolean {
  if (typeof event === "string") return event.toLowerCase() === "speaking";
  if (!event || typeof event !== "object") return false;
  return String((event as Record<string, unknown>).mode ?? "").toLowerCase() === "speaking";
}

export function DialogueArena({
  enabledAgentSlugs,
  maxTurns,
  onExit,
}: {
  enabledAgentSlugs: AgentSlug[];
  maxTurns: number;
  onExit: () => void;
}) {
  const [speakerA, setSpeakerA] = useState<AgentSlug>(enabledAgentSlugs[0] ?? "bernays");
  const [speakerB, setSpeakerB] = useState<AgentSlug>(enabledAgentSlugs.find((slug) => slug !== (enabledAgentSlugs[0] ?? "bernays")) ?? "arthur-page");
  const [topic, setTopic] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Choose two historical figures and a topic.");
  const [activeSpeaker, setActiveSpeaker] = useState<AgentSlug | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [liveLine, setLiveLine] = useState<TranscriptEntry | null>(null);
  const [turnsCompleted, setTurnsCompleted] = useState(0);
  const [error, setError] = useState("");

  const sessionsRef = useRef<Map<AgentSlug, DialogueSession>>(new Map());
  const runningRef = useRef(false);
  const nextSpeakerRef = useRef<AgentSlug | null>(null);
  const turnsRef = useRef(0);
  const finalizeTimerRef = useRef<number | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  const choices = useMemo(() => enabledAgentSlugs.filter((slug) => Boolean(AGENTS[slug])), [enabledAgentSlugs]);

  useEffect(() => {
    transcriptScrollRef.current?.scrollTo({ top: transcriptScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, liveLine]);

  const clearSessionTimers = (session: DialogueSession) => {
    session.timers.forEach((timer) => window.clearTimeout(timer));
    session.timers = [];
  };

  const resetLiveTurn = (session: DialogueSession) => {
    clearSessionTimers(session);
    session.turnText = "";
    session.lastText = "";
    session.packetCursorMs = 0;
    session.turnStartedAt = null;
    session.spokeThisTurn = false;
  };

  const appendLiveAlignment = (session: DialogueSession, payload: unknown) => {
    const alignment = normalizeAudioAlignment(payload);
    if (!alignment || !alignment.chars.length) return;
    if (session.turnStartedAt === null) session.turnStartedAt = performance.now();

    const packetStart = session.packetCursorMs;
    const lastIndex = alignment.chars.length - 1;
    const packetEnd = Math.max(
      alignment.starts[lastIndex] ?? 0,
      (alignment.starts[lastIndex] ?? 0) + (alignment.durations[lastIndex] ?? 0),
    );

    alignment.chars.forEach((char, index) => {
      const targetMs = packetStart + (alignment.starts[index] ?? 0);
      const elapsed = performance.now() - (session.turnStartedAt ?? performance.now());
      const delay = Math.max(0, targetMs - elapsed);
      const timer = window.setTimeout(() => {
        session.turnText += char;
        setLiveLine({ slug: session.slug, text: session.turnText });
      }, delay);
      session.timers.push(timer);
    });

    session.packetCursorMs += packetEnd;
  };

  const endAllSessions = async () => {
    runningRef.current = false;
    setRunning(false);
    nextSpeakerRef.current = null;
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    const sessions = Array.from(sessionsRef.current.values());
    sessionsRef.current.clear();
    for (const session of sessions) {
      clearSessionTimers(session);
      try { session.conversation.endSession(); } catch (err) { console.error(err); }
    }
    setActiveSpeaker(null);
    setLiveLine(null);
  };

  useEffect(() => () => { void endAllSessions(); }, []);

  const sendTurn = (slug: AgentSlug, text: string) => {
    const session = sessionsRef.current.get(slug);
    if (!session || !runningRef.current) return;
    resetLiveTurn(session);
    nextSpeakerRef.current = slug;
    setStatus(`Waiting for ${AGENTS[slug].shortName}…`);
    session.conversation.sendUserMessage(text);
  };

  const finalizeSpeakerTurn = (slug: AgentSlug) => {
    if (!runningRef.current) return;
    const session = sessionsRef.current.get(slug);
    if (!session || !session.spokeThisTurn) return;

    if (finalizeTimerRef.current !== null) window.clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = window.setTimeout(() => {
      finalizeTimerRef.current = null;
      if (!runningRef.current) return;
      const current = sessionsRef.current.get(slug);
      if (!current || current.speaking) return;
      const finalText = (current.lastText || current.turnText).trim();
      if (!finalText) {
        setError(`No completed response was received from ${AGENTS[slug].name}.`);
        void endAllSessions();
        return;
      }

      clearSessionTimers(current);
      setTranscript((prev) => [...prev, { slug, text: finalText }]);
      setLiveLine(null);
      current.turnText = finalText;

      const completed = turnsRef.current + 1;
      turnsRef.current = completed;
      setTurnsCompleted(completed);
      if (completed >= maxTurns) {
        setStatus("Discussion complete.");
        void endAllSessions();
        return;
      }

      const other = slug === speakerA ? speakerB : speakerA;
      const relay =
        `The other historical speaker just said:\n\n“${finalText}”\n\n` +
        "Respond directly to the argument they made from your own historical perspective. " +
        "Do not greet or address a museum visitor. Continue the discussion naturally and keep this turn concise.";
      window.setTimeout(() => sendTurn(other, relay), 250);
    }, 500);
  };

  const startOneSession = async (slug: AgentSlug) => {
    const response = await fetch(`/api/token?agent=${encodeURIComponent(slug)}&mode=dialogue`, { cache: "no-store" });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error || `Unable to start ${AGENTS[slug].name}.`);

    const holder: DialogueSession = {
      slug,
      conversation: null,
      speaking: false,
      lastText: "",
      turnText: "",
      timers: [],
      packetCursorMs: 0,
      turnStartedAt: null,
      spokeThisTurn: false,
    };

    const conversation = await Conversation.startSession({
      conversationToken: data.token,
      onConnect: () => setStatus(`Connected ${AGENTS[slug].shortName}.`),
      onDisconnect: () => {
        if (runningRef.current) setError(`${AGENTS[slug].name} disconnected during the discussion.`);
      },
      onModeChange: (event: unknown) => {
        const speaking = modeIsSpeaking(event);
        holder.speaking = speaking;
        if (speaking) {
          holder.spokeThisTurn = true;
          setActiveSpeaker(slug);
          setStatus(`${AGENTS[slug].name} is speaking.`);
          return;
        }
        if (holder.spokeThisTurn) {
          setStatus(`${AGENTS[slug].shortName} finished. Preparing the next turn…`);
          finalizeSpeakerTurn(slug);
        }
      },
      onMessage: (event: unknown) => {
        const text = extractAgentText(event);
        if (text) holder.lastText = text;
      },
      onAudioAlignment: (payload: unknown) => appendLiveAlignment(holder, payload),
      onError: (err: unknown) => {
        console.error(`Dialogue session error for ${slug}`, err);
        setError(`${AGENTS[slug].name} encountered an ElevenLabs session error.`);
      },
    });

    holder.conversation = conversation;
    conversation.setMicMuted(true);
    try { await conversation.setVolume({ volume: 1 }); } catch { /* older SDK variants may be sync */ }
    sessionsRef.current.set(slug, holder);
  };

  const startDiscussion = async (event: FormEvent) => {
    event.preventDefault();
    if (running || speakerA === speakerB || !topic.trim()) return;
    setError("");
    setTranscript([]);
    setLiveLine(null);
    setTurnsCompleted(0);
    turnsRef.current = 0;
    setActiveSpeaker(null);
    setRunning(true);
    runningRef.current = true;
    setStatus("Opening two independent historical voice sessions…");

    try {
      await Promise.all([startOneSession(speakerA), startOneSession(speakerB)]);
      if (!runningRef.current) return;
      setStatus("Both historical figures are connected.");
      window.setTimeout(() => {
        sendTurn(
          speakerA,
          `Begin a historical discussion on this topic:\n\n“${topic.trim()}”\n\n` +
            "Give your opening position. Do not greet a museum visitor and do not introduce yourself unless it is relevant to the argument.",
        );
      }, 250);
    } catch (err) {
      console.error("Unable to start AI discussion", err);
      setError(err instanceof Error ? err.message : "Unable to start the AI discussion.");
      await endAllSessions();
    }
  };

  const portraitSlug = activeSpeaker ?? speakerA;
  const portraitAgent = AGENTS[portraitSlug];

  return (
    <div className="dialogue-mode-shell">
      <div className="dialogue-mode-topbar">
        <button type="button" className="secondary-button" onClick={async () => { await endAllSessions(); onExit(); }}>
          ← Visitor conversation
        </button>
        <span>AI Discussion</span>
      </div>

      <div className="dialogue-mode-card">
        <section className="dialogue-stage">
          <div className={`portrait-wrap ${activeSpeaker ? "speaking" : ""}`}>
            <img className="portrait" src={portraitAgent.portrait} alt={portraitAgent.name} />
            {activeSpeaker && <span className="status-dot" />}
          </div>
          <p className="eyebrow">{activeSpeaker ? "Currently speaking" : "AI discussion"}</p>
          <h1>{portraitAgent.name}</h1>
          <p className="years">{portraitAgent.years}</p>
          <p className="subtitle">{portraitAgent.subtitle}</p>
          <p className="dialogue-status">{status}</p>
          {running && <p className="dialogue-turn-count">Turn {Math.min(turnsCompleted + 1, maxTurns)} of {maxTurns}</p>}
        </section>

        {!running ? (
          <form className="dialogue-setup-card" onSubmit={startDiscussion}>
            <h2>Historical Roundtable</h2>
            <p>Two independent ElevenLabs agents stay connected at the same time. The app relays each completed response to the other speaker.</p>
            <div className="dialogue-pair-grid">
              <label>
                <span>First speaker</span>
                <select value={speakerA} onChange={(e) => setSpeakerA(e.target.value as AgentSlug)}>
                  {choices.map((slug) => <option key={slug} value={slug}>{AGENTS[slug].name}</option>)}
                </select>
              </label>
              <label>
                <span>Second speaker</span>
                <select value={speakerB} onChange={(e) => setSpeakerB(e.target.value as AgentSlug)}>
                  {choices.map((slug) => <option key={slug} value={slug}>{AGENTS[slug].name}</option>)}
                </select>
              </label>
            </div>
            <label className="dialogue-topic-field">
              <span>Discussion topic</span>
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Should corporations attempt to shape public opinion?" rows={3} />
            </label>
            {speakerA === speakerB && <p className="dialogue-form-error">Choose two different historical figures.</p>}
            <button className="primary-button" type="submit" disabled={!topic.trim() || speakerA === speakerB || choices.length < 2}>
              Start discussion
            </button>
          </form>
        ) : (
          <div className="dialogue-running-controls">
            <button className="end-button" type="button" onClick={() => void endAllSessions()}>Stop discussion</button>
          </div>
        )}

        {error && <div className="error-block dialogue-error"><p>{error}</p></div>}

        <section className="dialogue-transcript-section">
          <div className="dialogue-transcript-heading">
            <strong>Live transcript</strong>
            <span>{transcript.length} completed turns</span>
          </div>
          <div className="dialogue-transcript" ref={transcriptScrollRef}>
            {!transcript.length && !liveLine && <p className="dialogue-empty">The discussion transcript will appear here as the voices speak.</p>}
            {transcript.map((entry, index) => (
              <div className="dialogue-transcript-line" key={`${entry.slug}-${index}`}>
                <span>{AGENTS[entry.slug].name}</span>
                <p>{entry.text}</p>
              </div>
            ))}
            {liveLine && (
              <div className="dialogue-transcript-line live">
                <span>{AGENTS[liveLine.slug].name}</span>
                <p>{liveLine.text}<span className="typing-caret">▌</span></p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
