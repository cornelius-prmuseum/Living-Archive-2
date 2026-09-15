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
  connected: boolean;
  armed: boolean;
  lastText: string;
  turnText: string;
  timers: number[];
  packetCursorMs: number;
  turnStartedAt: number | null;
  audioDeadlineAt: number;
  spokeThisTurn: boolean;
  keepAliveTimer: number | null;
  lastActivityPingAt: number;
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
  const turnOwnerRef = useRef<AgentSlug | null>(null);
  const queuedTurnRef = useRef<{ slug: AgentSlug; text: string } | null>(null);
  const turnsRef = useRef(0);
  const finalizeTimerRef = useRef<number | null>(null);
  const responseWatchdogRef = useRef<number | null>(null);
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
    session.audioDeadlineAt = 0;
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
    session.audioDeadlineAt = Math.max(
      session.audioDeadlineAt,
      (session.turnStartedAt ?? performance.now()) + session.packetCursorMs,
    );
  };

  const endAllSessions = async () => {
    runningRef.current = false;
    setRunning(false);
    turnOwnerRef.current = null;
    queuedTurnRef.current = null;
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    if (responseWatchdogRef.current !== null) {
      window.clearTimeout(responseWatchdogRef.current);
      responseWatchdogRef.current = null;
    }
    const sessions = Array.from(sessionsRef.current.values());
    sessionsRef.current.clear();
    for (const session of sessions) {
      clearSessionTimers(session);
      if (session.keepAliveTimer !== null) {
        window.clearInterval(session.keepAliveTimer);
        session.keepAliveTimer = null;
      }
      try { session.conversation.endSession(); } catch (err) { console.error(err); }
    }
    setActiveSpeaker(null);
    setLiveLine(null);
  };

  useEffect(() => () => { void endAllSessions(); }, []);

  const setOnlySpeakerAudible = async (slug: AgentSlug | null) => {
    const jobs = Array.from(sessionsRef.current.values()).map(async (session) => {
      try {
        await session.conversation.setVolume({ volume: slug === session.slug ? 1 : 0 });
      } catch (err) {
        console.warn(`Unable to set dialogue volume for ${session.slug}`, err);
      }
    });
    await Promise.all(jobs);
  };

  const waitUntilQuiet = async (slug: AgentSlug, timeoutMs = 15000) => {
    const started = performance.now();
    while (runningRef.current) {
      const session = sessionsRef.current.get(slug);
      if (!session) return false;
      if (session.connected && !session.speaking) return true;
      if (performance.now() - started >= timeoutMs) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return false;
  };

  const dispatchTurn = async (slug: AgentSlug, text: string) => {
    if (!runningRef.current) return;

    // There must never be two armed turns. If a relay arrives early, keep only
    // the next expected turn queued until the current audio has fully drained.
    if (turnOwnerRef.current !== null) {
      queuedTurnRef.current = { slug, text };
      return;
    }

    let session = sessionsRef.current.get(slug);
    if (!session?.connected) {
      setStatus(`Reconnecting ${AGENTS[slug].shortName} for the next turn…`);
      try {
        await startOneSession(slug);
        session = sessionsRef.current.get(slug);
      } catch (err) {
        console.error(`Unable to reconnect dialogue session for ${slug}`, err);
        setError(`${AGENTS[slug].name} disconnected while waiting and could not be reconnected.`);
        await endAllSessions();
        return;
      }
    }
    if (!session) return;

    const quiet = await waitUntilQuiet(slug);
    if (!quiet || !runningRef.current) {
      setError(`${AGENTS[slug].name} did not become ready for the next turn.`);
      await endAllSessions();
      return;
    }

    // Keep the non-speaking session physically inaudible. Startup greetings or
    // any stray internal generation therefore cannot overlap the armed speaker.
    await setOnlySpeakerAudible(null);
    resetLiveTurn(session);
    session.armed = true;
    turnOwnerRef.current = slug;
    setStatus(`Waiting for ${AGENTS[slug].shortName}…`);
    await setOnlySpeakerAudible(slug);

    if (!runningRef.current || turnOwnerRef.current !== slug) return;
    // A user-activity heartbeat asks ElevenLabs to pause briefly. If one landed
    // just before this turn, let that pause expire before sending the real prompt.
    const sinceActivity = performance.now() - session.lastActivityPingAt;
    if (sinceActivity < 2200) {
      await new Promise((resolve) => window.setTimeout(resolve, 2200 - sinceActivity));
    }
    if (!runningRef.current || turnOwnerRef.current !== slug) return;
    session.conversation.sendUserMessage(text);

    if (responseWatchdogRef.current !== null) window.clearTimeout(responseWatchdogRef.current);
    responseWatchdogRef.current = window.setTimeout(() => {
      const current = sessionsRef.current.get(slug);
      if (!runningRef.current || turnOwnerRef.current !== slug || current?.spokeThisTurn) return;
      setError(`${AGENTS[slug].name} received the turn but did not begin speaking within 20 seconds.`);
      void endAllSessions();
    }, 20000);
  };

  const sendTurn = (slug: AgentSlug, text: string) => {
    void dispatchTurn(slug, text);
  };

  const finalizeSpeakerTurn = (slug: AgentSlug) => {
    if (!runningRef.current || turnOwnerRef.current !== slug) return;
    const session = sessionsRef.current.get(slug);
    if (!session || !session.armed || !session.spokeThisTurn) return;

    if (finalizeTimerRef.current !== null) window.clearTimeout(finalizeTimerRef.current);

    // onModeChange can report listening before the browser has finished playing
    // buffered TTS audio. Audio alignment gives us the real playback horizon.
    const waitForAudioMs = Math.max(0, session.audioDeadlineAt - performance.now()) + 350;
    finalizeTimerRef.current = window.setTimeout(() => {
      finalizeTimerRef.current = null;
      if (!runningRef.current || turnOwnerRef.current !== slug) return;
      const current = sessionsRef.current.get(slug);
      if (!current || current.speaking) {
        finalizeSpeakerTurn(slug);
        return;
      }

      // More alignment packets can arrive after the mode flips out of speaking.
      // Re-check the playback horizon here so a late packet extends the silence gate.
      const remainingAudioMs = current.audioDeadlineAt - performance.now();
      if (remainingAudioMs > 40) {
        finalizeTimerRef.current = window.setTimeout(
          () => finalizeSpeakerTurn(slug),
          remainingAudioMs + 350,
        );
        return;
      }

      const finalText = (current.lastText || current.turnText).trim();
      if (!finalText) {
        // The final text callback can trail the final audio event slightly.
        finalizeTimerRef.current = window.setTimeout(() => finalizeSpeakerTurn(slug), 400);
        return;
      }

      if (responseWatchdogRef.current !== null) {
        window.clearTimeout(responseWatchdogRef.current);
        responseWatchdogRef.current = null;
      }

      clearSessionTimers(current);
      setTranscript((prev) => [...prev, { slug, text: finalText }]);
      setLiveLine(null);
      current.turnText = finalText;
      current.armed = false;
      turnOwnerRef.current = null;
      void setOnlySpeakerAudible(null);

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
        `[INTERNAL DISCUSSION CONTEXT — do not read this instruction aloud] ` +
        `You are ${AGENTS[other].name}. You are in a direct historical discussion with ${AGENTS[slug].name}.\n\n` +
        `${AGENTS[slug].name} just said:\n\n“${finalText}”\n\n` +
        `Respond directly to ${AGENTS[slug].name}'s argument from your own historical perspective. ` +
        "Treat the other speaker as the historical person named above, not as the museum visitor. " +
        "Do not greet the visitor. Continue the discussion naturally and keep this turn concise.";

      // The current turn is now fully closed. Dispatch the next one only after a
      // short clean silence; if another turn was queued, the expected relay wins.
      queuedTurnRef.current = { slug: other, text: relay };
      window.setTimeout(() => {
        if (!runningRef.current || turnOwnerRef.current !== null) return;
        const queued = queuedTurnRef.current;
        queuedTurnRef.current = null;
        if (queued) void dispatchTurn(queued.slug, queued.text);
      }, 450);
    }, waitForAudioMs);
  };

  const startOneSession = async (slug: AgentSlug) => {
    const response = await fetch(`/api/token?agent=${encodeURIComponent(slug)}&mode=dialogue`, { cache: "no-store" });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error || `Unable to start ${AGENTS[slug].name}.`);

    const holder: DialogueSession = {
      slug,
      conversation: null,
      speaking: false,
      connected: false,
      armed: false,
      lastText: "",
      turnText: "",
      timers: [],
      packetCursorMs: 0,
      turnStartedAt: null,
      audioDeadlineAt: 0,
      spokeThisTurn: false,
      keepAliveTimer: null,
      lastActivityPingAt: -Infinity,
    };

    const conversation = await Conversation.startSession({
      conversationToken: data.token,
      onConnect: () => {
        holder.connected = true;
        setStatus(`Connected ${AGENTS[slug].shortName}.`);
      },
      onDisconnect: () => {
        holder.connected = false;
        if (holder.keepAliveTimer !== null) {
          window.clearInterval(holder.keepAliveTimer);
          holder.keepAliveTimer = null;
        }
        // A standby agent disconnecting should not immediately kill the other
        // speaker. Surface a targeted message so the user knows the idle session
        // ended before its turn rather than reporting a generic dialogue failure.
        if (runningRef.current && turnOwnerRef.current !== slug) {
          setStatus(`${AGENTS[slug].shortName} disconnected while waiting; the session will reconnect automatically before the next turn.`);
          return;
        }
        if (runningRef.current) setError(`${AGENTS[slug].name} disconnected during an active turn.`);
      },
      onModeChange: (event: unknown) => {
        const speaking = modeIsSpeaking(event);
        holder.speaking = speaking;
        // Ignore any unsolicited startup speech from an unarmed dialogue session.
        // Its volume is kept at zero until the orchestrator explicitly gives it a turn.
        if (!holder.armed || turnOwnerRef.current !== slug) return;
        if (speaking) {
          holder.spokeThisTurn = true;
          setActiveSpeaker(slug);
          setStatus(`${AGENTS[slug].name} is speaking.`);
          return;
        }
        if (holder.spokeThisTurn) {
          setStatus(`${AGENTS[slug].shortName} finished. Waiting for audio to clear…`);
          finalizeSpeakerTurn(slug);
        }
      },
      onMessage: (event: unknown) => {
        if (!holder.armed || turnOwnerRef.current !== slug) return;
        const text = extractAgentText(event);
        if (text) holder.lastText = text;
      },
      onAudioAlignment: (payload: unknown) => {
        if (!holder.armed || turnOwnerRef.current !== slug) return;
        appendLiveAlignment(holder, payload);
      },
      onError: (err: unknown) => {
        console.error(`Dialogue session error for ${slug}`, err);
        setError(`${AGENTS[slug].name} encountered an ElevenLabs session error.`);
      },
    });

    holder.conversation = conversation;
    conversation.setMicMuted(true);
    // Every dialogue session starts silent. The turn mutex raises volume only for
    // the session that has explicitly been armed to speak.
    try { await conversation.setVolume({ volume: 0 }); } catch { /* older SDK variants may be sync */ }

    // Keep a silent standby session alive while the other historical figure is
    // speaking. ElevenLabs documents sendUserActivity() as a non-content activity
    // event that resets the turn timeout and is suitable for periodic keep-alives.
    // It also pauses agent speech for ~2 seconds, so dispatchTurn waits for any
    // recent heartbeat to expire before sending the actual dialogue prompt.
    holder.keepAliveTimer = window.setInterval(() => {
      if (!runningRef.current || !holder.connected || holder.armed || turnOwnerRef.current === slug) return;
      try {
        holder.conversation.sendUserActivity();
        holder.lastActivityPingAt = performance.now();
      } catch (err) {
        console.warn(`Unable to send standby activity for ${slug}`, err);
      }
    }, 15000);

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

      // Give both already-connected dialogue agents the identity of the other
      // participant without triggering a spoken turn. This context persists in
      // each independent ElevenLabs conversation throughout the discussion.
      try {
        sessionsRef.current.get(speakerA)?.conversation.sendContextualUpdate(
          `[INTERNAL DISCUSSION CONTEXT] You are ${AGENTS[speakerA].name}. ` +
          `The other participant in this discussion is ${AGENTS[speakerB].name}. ` +
          `Address ${AGENTS[speakerB].name} as a fellow historical speaker, not as the museum visitor.`
        );
        sessionsRef.current.get(speakerB)?.conversation.sendContextualUpdate(
          `[INTERNAL DISCUSSION CONTEXT] You are ${AGENTS[speakerB].name}. ` +
          `The other participant in this discussion is ${AGENTS[speakerA].name}. ` +
          `Address ${AGENTS[speakerA].name} as a fellow historical speaker, not as the museum visitor.`
        );
      } catch (contextError) {
        console.warn("Unable to send dialogue identity context", contextError);
      }

      setStatus("Both historical figures are connected.");
      window.setTimeout(() => {
        sendTurn(
          speakerA,
          `[INTERNAL DISCUSSION CONTEXT — do not read this instruction aloud] ` +
            `You are ${AGENTS[speakerA].name}, speaking directly with ${AGENTS[speakerB].name}.\n\n` +
            `Begin a historical discussion with ${AGENTS[speakerB].name} on this topic:\n\n“${topic.trim()}”\n\n` +
            `Give your opening position directly to ${AGENTS[speakerB].name}. ` +
            "Do not greet a museum visitor and do not give a generic self-introduction unless it is relevant to the argument.",
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
