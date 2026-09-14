"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useConversation } from "@elevenlabs/react";
import {
  AGENTS,
  getPublicAgent,
  isAgentSlug,
  type AgentSlug,
} from "@/lib/agents";

type TranscriptEntry = {
  role: "visitor" | "agent";
  text: string;
  speakerSlug?: AgentSlug;
};

type SubtitleLine = {
  text: string;
  speakerSlug: AgentSlug;
};

type ScreenState = "ready" | "active" | "wrapping" | "finished" | "error";

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

const CLOSE_PROMPT =
  "[INTERNAL SESSION CONTROL — not spoken by the visitor] The museum conversation is ending now. Give one brief final thought, thank the visitor for speaking with you, and say goodbye. Do not ask a new question. Keep this final response concise.";

const SWITCH_PROMPT_PREFIX = "[MUSEUM UI AGENT SWITCH — not spoken by the visitor]";

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function normalizeMessage(event: unknown, activeSpeaker: AgentSlug): TranscriptEntry | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;

  const nestedUser = e.user_transcription_event as Record<string, unknown> | undefined;
  const nestedAgent = e.agent_response_event as Record<string, unknown> | undefined;

  const textCandidates = [
    e.message,
    e.text,
    e.transcript,
    nestedUser?.user_transcript,
    nestedAgent?.agent_response,
  ];

  const text = textCandidates.find((value) => typeof value === "string" && value.trim()) as
    | string
    | undefined;

  if (!text || text === CLOSE_PROMPT || text.startsWith(SWITCH_PROMPT_PREFIX)) return null;

  const source = String(e.source ?? e.role ?? e.type ?? "").toLowerCase();
  const isUser = Boolean(nestedUser) || source.includes("user") || source.includes("visitor");
  const isAgent = Boolean(nestedAgent) || source.includes("agent") || source.includes("assistant");
  const role: TranscriptEntry["role"] = isUser && !isAgent ? "visitor" : "agent";

  return {
    role,
    text: text.trim(),
    speakerSlug: role === "agent" ? activeSpeaker : undefined,
  };
}

function mergeTranscript(previous: TranscriptEntry[], incoming: TranscriptEntry) {
  const last = previous.at(-1);
  if (!last) return [incoming];

  if (last.role === incoming.role && last.speakerSlug === incoming.speakerSlug) {
    if (last.text === incoming.text) return previous;

    if (incoming.text.startsWith(last.text) || last.text.startsWith(incoming.text)) {
      const replacement = incoming.text.length >= last.text.length ? incoming : last;
      return [...previous.slice(0, -1), replacement];
    }
  }

  return [...previous, incoming];
}

export function AgentExperience({
  agentParam,
  returnUrl,
  enabledAgentSlugs,
}: {
  agentParam: string | null;
  returnUrl: string | null;
  enabledAgentSlugs: AgentSlug[];
}) {
  const enabledAgents = useMemo(() => enabledAgentSlugs.filter((slug) => Boolean(AGENTS[slug])), [enabledAgentSlugs]);
  const initialAgent = useMemo(() => getPublicAgent(agentParam, enabledAgents), [agentParam, enabledAgents]);
  const [activeAgentSlug, setActiveAgentSlug] = useState<AgentSlug>(initialAgent.slug);
  const [pendingTransferSlug, setPendingTransferSlug] = useState<AgentSlug | null>(null);
  const activeAgentSlugRef = useRef<AgentSlug>(initialAgent.slug);
  const agent = AGENTS[activeAgentSlug];
  const noAgentsAvailable = enabledAgents.length === 0;

  const configuredSeconds = Number(process.env.NEXT_PUBLIC_SESSION_SECONDS || 600);
  const sessionSeconds = Number.isFinite(configuredSeconds) && configuredSeconds >= 60
    ? Math.floor(configuredSeconds)
    : 600;

  const [screen, setScreen] = useState<ScreenState>(noAgentsAvailable ? "error" : "ready");
  const [remaining, setRemaining] = useState(sessionSeconds);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    noAgentsAvailable ? "No historical voice agents are currently enabled on the server." : "",
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [textQuestion, setTextQuestion] = useState("");
  const [subtitle, setSubtitle] = useState<SubtitleLine | null>(null);

  const warningSentRef = useRef(false);
  const closePromptSentRef = useRef(false);
  const closingSpeechStartedRef = useRef(false);
  const endRequestedRef = useRef(false);
  const closePromptSentAtRef = useRef<number | null>(null);
  const wasSpeakingRef = useRef(false);
  const subtitleTimersRef = useRef<number[]>([]);
  const subtitleBufferRef = useRef("");
  const subtitleTurnActiveRef = useRef(false);
  const alignmentSeenInTurnRef = useRef(false);
  // ElevenLabs emits audio alignment in multiple packets. The character timing
  // inside each packet is local to that packet, so we keep a cumulative speech
  // cursor to prevent separate packets from being revealed on top of each other.
  const subtitlePacketCursorMsRef = useRef(0);
  const subtitleTurnStartedAtRef = useRef<number | null>(null);

  const clearSubtitleTimers = useCallback(() => {
    subtitleTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    subtitleTimersRef.current = [];
  }, []);

  const resetSubtitleStream = useCallback((clearVisible = true) => {
    clearSubtitleTimers();
    subtitleBufferRef.current = "";
    subtitleTurnActiveRef.current = false;
    alignmentSeenInTurnRef.current = false;
    subtitlePacketCursorMsRef.current = 0;
    subtitleTurnStartedAtRef.current = null;
    if (clearVisible) setSubtitle(null);
  }, [clearSubtitleTimers]);

  const updateAgentUrl = useCallback((slug: AgentSlug) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("agent", slug);
    window.history.replaceState({}, "", url.toString());
  }, []);

  const confirmActiveAgent = useCallback((slug: AgentSlug) => {
    if (!enabledAgents.includes(slug)) return;
    activeAgentSlugRef.current = slug;
    setActiveAgentSlug(slug);
    setPendingTransferSlug(null);
    resetSubtitleStream(true);
    updateAgentUrl(slug);
  }, [enabledAgents, resetSubtitleStream, updateAgentUrl]);

  const confirmActiveAgentId = useCallback(async (agentId: string) => {
    const clean = agentId.trim();
    if (!clean) return "No active ElevenLabs Agent ID was provided.";

    try {
      const response = await fetch(`/api/resolve-agent?agent_id=${encodeURIComponent(clean)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { slug?: string; error?: string };

      if (!response.ok || !isAgentSlug(data.slug) || !enabledAgents.includes(data.slug)) {
        return data.error || "The active ElevenLabs agent is not available in this PRMuseum interface.";
      }

      confirmActiveAgent(data.slug);
      return `PRMuseum display synchronized to ${AGENTS[data.slug].name}.`;
    } catch (error) {
      console.error("Unable to resolve active ElevenLabs agent", error);
      return "The PRMuseum display could not synchronize with the active agent.";
    }
  }, [confirmActiveAgent, enabledAgents]);

  const scheduleAlignedSubtitle = useCallback((payload: unknown) => {
    const alignment = normalizeAudioAlignment(payload);
    if (!alignment || alignment.chars.length === 0) return;

    const now = performance.now();

    if (!subtitleTurnActiveRef.current) {
      clearSubtitleTimers();
      subtitleBufferRef.current = "";
      subtitleTurnActiveRef.current = true;
      alignmentSeenInTurnRef.current = true;
      subtitlePacketCursorMsRef.current = 0;
      subtitleTurnStartedAtRef.current = now;
      setSubtitle(null);
    } else {
      alignmentSeenInTurnRef.current = true;
    }

    const chars = alignment.chars;
    const starts = alignment.starts;
    const durations = alignment.durations;
    const speakerSlug = activeAgentSlugRef.current;
    const turnStartedAt = subtitleTurnStartedAtRef.current ?? now;
    const elapsedMs = Math.max(0, now - turnStartedAt);

    // IMPORTANT: char_start_times_ms is local to each alignment packet, not one
    // global clock for the entire answer. Queue this packet after the prior one.
    // If a packet arrives late, start it immediately rather than trying to catch up
    // by interleaving its words with text that is already on screen.
    const firstStartMs = Number(starts[0] ?? 0);
    const packetBaseMs = Math.max(subtitlePacketCursorMsRef.current, elapsedMs);

    let packetEndMs = 0;
    for (let i = 0; i < chars.length; i += 1) {
      const localStart = Math.max(0, Number(starts[i] ?? firstStartMs) - firstStartMs);
      const duration = Math.max(0, Number(durations[i] ?? 0));
      packetEndMs = Math.max(packetEndMs, localStart + duration);
    }

    // Some payloads omit durations. Give the final character a small tail so the
    // next packet cannot begin at exactly the same instant as the last word.
    if (packetEndMs <= 0) {
      packetEndMs = Math.max(0, Number(starts.at(-1) ?? firstStartMs) - firstStartMs) + 40;
    }
    subtitlePacketCursorMsRef.current = packetBaseMs + packetEndMs;

    // Reveal word/space runs using the timing inside this packet, offset by the
    // cumulative packet cursor established above.
    let index = 0;
    while (index < chars.length) {
      const whitespace = /\s/.test(chars[index]);
      let end = index + 1;
      while (end < chars.length && /\s/.test(chars[end]) === whitespace) end += 1;

      const chunk = chars.slice(index, end).join("");
      const localStart = Math.max(0, Number(starts[index] ?? firstStartMs) - firstStartMs);
      const targetMs = packetBaseMs + localStart;
      const delay = Math.max(0, targetMs - elapsedMs);

      const timer = window.setTimeout(() => {
        subtitleBufferRef.current += chunk;
        setSubtitle({ text: subtitleBufferRef.current, speakerSlug });
      }, delay);
      subtitleTimersRef.current.push(timer);
      index = end;
    }
  }, [clearSubtitleTimers]);

  const conversation = useConversation({
    clientTools: {
      // Preferred identity sync. Configure the tool's agent_id parameter in
      // ElevenLabs from the system__current_agent_id dynamic variable.
      syncActiveAgent: async (parameters: { agent_id?: string }) => {
        return confirmActiveAgentId(parameters?.agent_id || "");
      },

      // Backward-compatible with the v3 setup. The new syncActiveAgent tool is
      // more reliable because it maps the actual ElevenLabs Agent ID.
      setActiveAgent: (parameters: { agent_slug?: string }) => {
        const requested = parameters?.agent_slug;
        if (!isAgentSlug(requested)) return "Unknown historical figure.";
        if (!enabledAgents.includes(requested)) {
          return "That historical figure is currently disabled in the PRMuseum interface.";
        }
        confirmActiveAgent(requested);
        return `PRMuseum display synchronized to ${AGENTS[requested].name}.`;
      },
    },
    onConnect: () => {
      setScreen("active");
      setErrorMessage("");
    },
    onDisconnect: () => {
      setPendingTransferSlug(null);
      resetSubtitleStream(false);
      setScreen((current) => (current === "error" ? current : "finished"));
    },
    onAudioAlignment: (alignment: unknown) => {
      scheduleAlignedSubtitle(alignment);
    },
    onMessage: (message) => {
      const normalized = normalizeMessage(message, activeAgentSlugRef.current);
      if (!normalized) return;

      setTranscript((previous) => mergeTranscript(previous, normalized));

      // Fallback for an agent where audio-alignment client events have not yet
      // been enabled. When alignment is available, do not jump ahead to the
      // completed response text.
      if (
        normalized.role === "agent" &&
        normalized.speakerSlug &&
        !alignmentSeenInTurnRef.current
      ) {
        setSubtitle({ text: normalized.text, speakerSlug: normalized.speakerSlug });
      }
    },
    onError: (error) => {
      console.error(error);
      setPendingTransferSlug(null);
      resetSubtitleStream(false);
      setErrorMessage(typeof error === "string" ? error : "The voice connection encountered an error.");
      setScreen("error");
    },
  });

  const resetSessionRefs = useCallback(() => {
    warningSentRef.current = false;
    closePromptSentRef.current = false;
    closingSpeechStartedRef.current = false;
    endRequestedRef.current = false;
    closePromptSentAtRef.current = null;
    wasSpeakingRef.current = false;
    resetSubtitleStream(true);
  }, [resetSubtitleStream]);

  const endNow = useCallback(async () => {
    if (endRequestedRef.current) return;
    endRequestedRef.current = true;

    try {
      await conversation.endSession();
    } catch (error) {
      console.error("Error ending session", error);
    } finally {
      setPendingTransferSlug(null);
      setScreen("finished");
    }
  }, [conversation]);

  const requestGracefulClose = useCallback(() => {
    if (closePromptSentRef.current || conversation.status !== "connected") return;

    closePromptSentRef.current = true;
    closePromptSentAtRef.current = Date.now();
    setScreen("wrapping");

    try {
      conversation.setMuted(true);
      conversation.sendUserMessage(CLOSE_PROMPT);
    } catch (error) {
      console.error("Unable to send closing prompt", error);
      void endNow();
    }
  }, [conversation, endNow]);

  const startConversation = useCallback(async (initialQuestion?: string) => {
    if (noAgentsAvailable) return;

    setErrorMessage("");
    setTranscript([]);
    setRemaining(sessionSeconds);
    setConversationId(null);
    setPendingTransferSlug(null);
    resetSessionRefs();

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const response = await fetch(`/api/token?agent=${encodeURIComponent(activeAgentSlug)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        token?: string;
        conversationId?: string | null;
        error?: string;
      };

      if (!response.ok || !data.token) {
        throw new Error(data.error || "Unable to create a conversation token.");
      }

      const id = await conversation.startSession({ conversationToken: data.token });
      setConversationId(typeof id === "string" ? id : data.conversationId ?? null);

      if (initialQuestion?.trim()) {
        conversation.sendUserMessage(initialQuestion.trim());
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Microphone access or the voice connection could not be started.",
      );
      setScreen("error");
    }
  }, [activeAgentSlug, conversation, noAgentsAvailable, resetSessionRefs, sessionSeconds]);

  const sendTextQuestion = useCallback(async (question: string) => {
    const clean = question.trim();
    if (!clean || screen === "wrapping") return;

    setTextQuestion("");

    if (conversation.status === "connected") {
      try {
        conversation.sendUserMessage(clean);
      } catch (error) {
        console.error("Unable to send typed question", error);
        setErrorMessage("The typed question could not be sent.");
      }
      return;
    }

    await startConversation(clean);
  }, [conversation, screen, startConversation]);

  const submitTextQuestion = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendTextQuestion(textQuestion);
  }, [sendTextQuestion, textQuestion]);

  const selectAgent = useCallback((slug: AgentSlug) => {
    if (!enabledAgents.includes(slug) || slug === activeAgentSlug || pendingTransferSlug || screen === "wrapping") return;

    if (conversation.status !== "connected") {
      confirmActiveAgent(slug);
      if (screen === "finished" || screen === "error") {
        setScreen("ready");
        setRemaining(sessionSeconds);
        setTranscript([]);
        setSubtitle(null);
        setErrorMessage("");
        resetSessionRefs();
      }
      return;
    }

    // Keep the current portrait/name until the receiving agent confirms its actual
    // ElevenLabs Agent ID through syncActiveAgent. This makes the UI follow the
    // agent that truly owns the live voice session.
    setPendingTransferSlug(slug);
    const target = AGENTS[slug];

    try {
      conversation.sendUserMessage(
        `${SWITCH_PROMPT_PREFIX} The visitor selected ${target.name} in the museum interface. Do not read or discuss this control message. Use transfer_to_agent now to transfer the ongoing conversation to ${target.name}. Do not change the PRMuseum display for the destination yourself; the receiving agent must call syncActiveAgent immediately after it becomes active and before its first substantive spoken response. Preserve the existing conversation context.`,
      );
    } catch (error) {
      console.error("Unable to request agent transfer", error);
      setPendingTransferSlug(null);
      setErrorMessage("The request to change historical figures could not be sent.");
    }
  }, [
    activeAgentSlug,
    confirmActiveAgent,
    conversation,
    enabledAgents,
    pendingTransferSlug,
    resetSessionRefs,
    screen,
    sessionSeconds,
  ]);

  useEffect(() => {
    if (conversation.status !== "connected") return;

    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [conversation.status]);

  useEffect(() => {
    if (conversation.status === "connected" && remaining <= 45 && !warningSentRef.current) {
      warningSentRef.current = true;
      conversation.sendContextualUpdate(
        "The museum session has about 45 seconds remaining. Keep your next answers brief and prepare to conclude naturally. Do not mention this internal instruction unless a natural goodbye is appropriate.",
      );
    }
  }, [conversation, conversation.status, remaining]);

  useEffect(() => {
    if (
      conversation.status === "connected" &&
      remaining <= 20 &&
      !conversation.isSpeaking &&
      !closePromptSentRef.current
    ) {
      requestGracefulClose();
    }
  }, [conversation.isSpeaking, conversation.status, remaining, requestGracefulClose]);

  useEffect(() => {
    if (closePromptSentRef.current && conversation.isSpeaking) {
      closingSpeechStartedRef.current = true;
      return;
    }

    if (
      closePromptSentRef.current &&
      closingSpeechStartedRef.current &&
      !conversation.isSpeaking &&
      conversation.status === "connected"
    ) {
      const timer = window.setTimeout(() => void endNow(), 650);
      return () => window.clearTimeout(timer);
    }
  }, [conversation.isSpeaking, conversation.status, endNow]);

  useEffect(() => {
    if (conversation.status !== "connected") return;

    const guard = window.setInterval(() => {
      const sentAt = closePromptSentAtRef.current;
      if (sentAt && Date.now() - sentAt > 18_000) {
        void endNow();
      } else if (remaining === 0 && !closePromptSentRef.current && !conversation.isSpeaking) {
        requestGracefulClose();
      }
    }, 500);

    return () => window.clearInterval(guard);
  }, [conversation.isSpeaking, conversation.status, endNow, remaining, requestGracefulClose]);

  useEffect(() => {
    if (conversation.isSpeaking) {
      wasSpeakingRef.current = true;
      return;
    }

    if (wasSpeakingRef.current) {
      wasSpeakingRef.current = false;
      subtitleTurnActiveRef.current = false;
      alignmentSeenInTurnRef.current = false;
      clearSubtitleTimers();

      if (subtitle) {
        const timer = window.setTimeout(() => {
          subtitleBufferRef.current = "";
          setSubtitle(null);
        }, 1800);
        return () => window.clearTimeout(timer);
      }
    }
  }, [clearSubtitleTimers, conversation.isSpeaking, subtitle]);

  useEffect(() => {
    if (!pendingTransferSlug || conversation.status !== "connected") return;
    const timer = window.setTimeout(() => {
      setPendingTransferSlug(null);
      setErrorMessage("The agent transfer did not complete. You can try selecting the figure again.");
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [conversation.status, pendingTransferSlug]);

  useEffect(() => {
    return () => clearSubtitleTimers();
  }, [clearSubtitleTimers]);

  const statusLabel =
    screen === "wrapping"
      ? "Concluding"
      : pendingTransferSlug
        ? `Connecting to ${AGENTS[pendingTransferSlug].shortName}`
        : conversation.status === "connecting"
          ? "Connecting"
          : conversation.isSpeaking
            ? `${agent.shortName} is speaking`
            : conversation.status === "connected"
              ? "Listening"
              : "Ready";

  const safeReturnUrl = useMemo(() => {
    if (!returnUrl) return null;
    try {
      const parsed = new URL(returnUrl);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }, [returnUrl]);

  const textDisabled = screen === "wrapping" || conversation.status === "connecting" || noAgentsAvailable;

  return (
    <main className="experience-shell">
      <div className="experience-layout">
        <section className="museum-card" aria-live="polite">
          <div className="museum-mark">Museum of Public Relations</div>

          <div
            className={`portrait-wrap ${conversation.isSpeaking ? "speaking" : ""}`}
            key={agent.slug}
          >
            <img className="portrait" src={agent.portrait} alt={`Portrait of ${agent.name}`} />
            <span className="status-dot" aria-hidden="true" />
          </div>

          <header className="character-header" key={`header-${agent.slug}`}>
            <p className="eyebrow">A historical conversation</p>
            <h1>Speak with {agent.name}</h1>
            <p className="years">{agent.years}</p>
            <p className="subtitle">{agent.subtitle}</p>
          </header>

          {screen === "ready" && (
            <div className="content-block">
              <p className="intro">{agent.intro}</p>
              <p className="small-note">
                Ask by voice or type a question below. Conversations are limited to approximately {Math.round(sessionSeconds / 60)} minutes.
              </p>

              <SuggestedQuestions
                questions={agent.recommendedQuestions}
                onAsk={(question) => void sendTextQuestion(question)}
                disabled={textDisabled}
              />

              <button className="primary-button" onClick={() => void startConversation()} disabled={noAgentsAvailable}>
                <MicIcon /> Begin Conversation
              </button>

              <QuestionComposer
                value={textQuestion}
                onChange={setTextQuestion}
                onSubmit={submitTextQuestion}
                disabled={textDisabled}
                placeholder={`Type a question for ${agent.shortName}…`}
                buttonLabel="Ask"
              />
            </div>
          )}

          {(screen === "active" || screen === "wrapping") && (
            <div className="live-panel">
              <div className="live-meta">
                <div>
                  <span className="meta-label">Status</span>
                  <strong>{statusLabel}</strong>
                </div>
                <div className="timer" aria-label={`${remaining} seconds remaining`}>
                  <span className="meta-label">Time</span>
                  <strong>{formatClock(remaining)}</strong>
                </div>
              </div>

              <div className={`voice-orb ${conversation.isSpeaking ? "agent-speaking" : "listening"}`} aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>

              <div className={`live-subtitles ${subtitle ? "visible" : ""}`} aria-live="polite" aria-atomic="true">
                {subtitle ? (
                  <>
                    <span>{AGENTS[subtitle.speakerSlug].name}</span>
                    <p>{subtitle.text}</p>
                  </>
                ) : (
                  <p className="subtitle-placeholder">Subtitles will appear here while the historical figure speaks.</p>
                )}
              </div>

              <p className="live-instruction">
                {screen === "wrapping"
                  ? `${agent.shortName} is finishing the conversation.`
                  : pendingTransferSlug
                    ? `Transferring the conversation to ${AGENTS[pendingTransferSlug].name}…`
                    : conversation.isSpeaking
                      ? "Listen to the response, or type your next question below."
                      : "Speak naturally or type a question below."}
              </p>

              <QuestionComposer
                value={textQuestion}
                onChange={setTextQuestion}
                onSubmit={submitTextQuestion}
                disabled={textDisabled}
                placeholder={`Type a question for ${agent.shortName}…`}
                buttonLabel="Send"
              />

              <SuggestedQuestions
                questions={agent.recommendedQuestions}
                onAsk={(question) => void sendTextQuestion(question)}
                disabled={textDisabled}
                compact
              />

              <div className="control-row">
                <button
                  className="secondary-button"
                  onClick={() => conversation.setMuted(!conversation.isMuted)}
                  disabled={screen === "wrapping"}
                >
                  {conversation.isMuted ? <MicIcon /> : <MuteIcon />}
                  {conversation.isMuted ? "Unmute" : "Mute"}
                </button>
                <button className="end-button" onClick={() => void endNow()}>
                  End Conversation
                </button>
              </div>

              {transcript.length > 0 && (
                <div className="transcript-wrap">
                  <button className="text-button" onClick={() => setTranscriptOpen((open) => !open)}>
                    {transcriptOpen ? "Hide transcript" : "Show transcript"}
                  </button>
                  {transcriptOpen && (
                    <div className="transcript" role="log">
                      {transcript.map((entry, index) => {
                        const speaker = entry.speakerSlug ? AGENTS[entry.speakerSlug].shortName : agent.shortName;
                        return (
                          <div className="transcript-line" key={`${entry.role}-${index}-${entry.text.slice(0, 20)}`}>
                            <span>{entry.role === "visitor" ? "Visitor" : speaker}</span>
                            <p>{entry.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {screen === "finished" && (
            <div className="content-block finish-block">
              <h2>Thank you for visiting.</h2>
              <p>Your historical conversation has ended.</p>
              <div className="control-row centered">
                <button className="secondary-button" onClick={() => {
                  setScreen("ready");
                  setRemaining(sessionSeconds);
                  setTranscript([]);
                  setSubtitle(null);
                  resetSessionRefs();
                }}>
                  Start Another Conversation
                </button>
                {safeReturnUrl && (
                  <a className="primary-button link-button" href={safeReturnUrl} target="_top">
                    Return to PRMuseum
                  </a>
                )}
              </div>
              {conversationId && <p className="conversation-id">Session: {conversationId}</p>}
            </div>
          )}

          {screen === "error" && (
            <div className="content-block error-block">
              <h2>Conversation unavailable</h2>
              <p>{errorMessage || "The voice conversation could not be started."}</p>
              {!noAgentsAvailable && (
                <button className="primary-button" onClick={() => {
                  setScreen("ready");
                  setErrorMessage("");
                }}>
                  Try Again
                </button>
              )}
            </div>
          )}

          <footer>
            <p>
              This experience is a historically informed interpretation created for educational use by the Museum of Public Relations.
            </p>
          </footer>
        </section>

        <aside className="agent-rail" aria-label="Historical figures">
          <div className="agent-rail-heading">
            <p className="rail-eyebrow">Historical figures</p>
            <h2>Who’s on the line?</h2>
          </div>

          <div className="agent-list">
            {enabledAgents.map((slug) => {
              const candidate = AGENTS[slug];
              const isActive = slug === activeAgentSlug;
              const isPending = slug === pendingTransferSlug;
              const disabled = screen === "wrapping" || (!!pendingTransferSlug && !isPending);

              return (
                <button
                  className={`agent-choice ${isActive ? "active" : ""} ${isPending ? "pending" : ""}`}
                  key={slug}
                  onClick={() => selectAgent(slug)}
                  disabled={disabled || (isActive && !isPending)}
                  aria-current={isActive ? "true" : undefined}
                >
                  <img src={candidate.portrait} alt="" aria-hidden="true" />
                  <span className="agent-choice-copy">
                    <strong>{candidate.name}</strong>
                    <small>{candidate.years}</small>
                  </span>
                  <span className="agent-choice-state">
                    {isPending ? "Connecting…" : isActive ? "On line" : "Select"}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="rail-note">
            The main portrait is synchronized to the active ElevenLabs Agent ID, including transfers requested by voice, typed question, or the menu.
          </p>
        </aside>
      </div>
    </main>
  );
}

function SuggestedQuestions({
  questions,
  onAsk,
  disabled,
  compact = false,
}: {
  questions: readonly [string, string, string];
  onAsk: (question: string) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`suggested-questions ${compact ? "compact" : ""}`}>
      <p>Not sure what to ask?</p>
      <div className="suggested-question-list">
        {questions.map((question) => (
          <button key={question} type="button" onClick={() => onAsk(question)} disabled={disabled}>
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestionComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  buttonLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
  placeholder: string;
  buttonLabel: string;
}) {
  return (
    <form className="question-composer" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="typed-question">Type your question</label>
      <input
        id="typed-question"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={500}
        autoComplete="off"
      />
      <button type="submit" disabled={disabled || !value.trim()}>{buttonLabel}</button>
    </form>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v4M9 22h6" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-7.2-2.4M8 8v3a4 4 0 0 0 6.8 2.8M5 11a7 7 0 0 0 11.1 5.7M19 11a7 7 0 0 1-.7 3.1M12 18v4M9 22h6M3 3l18 18" />
    </svg>
  );
}
