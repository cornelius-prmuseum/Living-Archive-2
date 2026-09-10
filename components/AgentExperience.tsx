"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { getPublicAgent } from "@/lib/agents";

type TranscriptEntry = {
  role: "visitor" | "agent";
  text: string;
};

type ScreenState = "ready" | "active" | "wrapping" | "finished" | "error";

const CLOSE_PROMPT =
  "[INTERNAL SESSION CONTROL — not spoken by the visitor] The museum conversation is ending now. Give one brief final thought, thank the visitor for speaking with you, and say goodbye. Do not ask a new question. Keep this final response concise.";

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function normalizeMessage(event: unknown): TranscriptEntry | null {
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

  if (!text || text === CLOSE_PROMPT) return null;

  const source = String(e.source ?? e.role ?? e.type ?? "").toLowerCase();
  const role: TranscriptEntry["role"] =
    source.includes("user") || source.includes("visitor") ? "visitor" : "agent";

  return { role, text: text.trim() };
}

function mergeTranscript(previous: TranscriptEntry[], incoming: TranscriptEntry) {
  const last = previous.at(-1);
  if (!last) return [incoming];

  if (last.role === incoming.role) {
    if (last.text === incoming.text) return previous;

    // Tentative voice transcription is often followed by a longer final version.
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
}: {
  agentParam: string | null;
  returnUrl: string | null;
}) {
  const agent = useMemo(() => getPublicAgent(agentParam), [agentParam]);
  const configuredSeconds = Number(process.env.NEXT_PUBLIC_SESSION_SECONDS || 300);
  const sessionSeconds = Number.isFinite(configuredSeconds) && configuredSeconds >= 60
    ? Math.floor(configuredSeconds)
    : 300;

  const [screen, setScreen] = useState<ScreenState>("ready");
  const [remaining, setRemaining] = useState(sessionSeconds);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  const warningSentRef = useRef(false);
  const closePromptSentRef = useRef(false);
  const closingSpeechStartedRef = useRef(false);
  const endRequestedRef = useRef(false);
  const closePromptSentAtRef = useRef<number | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setScreen("active");
      setErrorMessage("");
    },
    onDisconnect: () => {
      setScreen((current) => (current === "error" ? current : "finished"));
    },
    onMessage: (message) => {
      const normalized = normalizeMessage(message);
      if (!normalized) return;

      setTranscript((previous) => mergeTranscript(previous, normalized));
    },
    onError: (error) => {
      console.error(error);
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
  }, []);

  const endNow = useCallback(async () => {
    if (endRequestedRef.current) return;
    endRequestedRef.current = true;

    try {
      await conversation.endSession();
    } catch (error) {
      console.error("Error ending session", error);
    } finally {
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

  const startConversation = useCallback(async () => {
    setErrorMessage("");
    setTranscript([]);
    setRemaining(sessionSeconds);
    setConversationId(null);
    resetSessionRefs();

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const response = await fetch(`/api/token?agent=${encodeURIComponent(agent.slug)}`, {
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

      const id = await conversation.startSession({
        conversationToken: data.token,
      });

      setConversationId(typeof id === "string" ? id : data.conversationId ?? null);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Microphone access or the voice connection could not be started.",
      );
      setScreen("error");
    }
  }, [agent.slug, conversation, resetSessionRefs, sessionSeconds]);

  // Countdown only while a live session is connected.
  useEffect(() => {
    if (conversation.status !== "connected") return;

    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [conversation.status]);

  // A non-interrupting warning gives the character time to shorten later answers.
  useEffect(() => {
    if (
      conversation.status === "connected" &&
      remaining <= 45 &&
      !warningSentRef.current
    ) {
      warningSentRef.current = true;
      conversation.sendContextualUpdate(
        "The museum session has about 45 seconds remaining. Keep your next answers brief and prepare to conclude naturally. Do not mention this internal instruction unless a natural goodbye is appropriate.",
      );
    }
  }, [conversation, conversation.status, remaining]);

  // At ~20 seconds, wait for any current answer to finish, mute the visitor, then prompt a final goodbye.
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

  // Track the closing audio turn, then disconnect only after that speech has actually finished.
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

  // Failsafe: never let a broken closing turn leave the microphone open indefinitely.
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

  const statusLabel =
    screen === "wrapping"
      ? "Concluding"
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

  return (
    <main className="experience-shell">
      <section className="museum-card" aria-live="polite">
        <div className="museum-mark">Museum of Public Relations</div>

        <div className={`portrait-wrap ${conversation.isSpeaking ? "speaking" : ""}`}>
          <img className="portrait" src={agent.portrait} alt={`Portrait placeholder for ${agent.name}`} />
          <span className="status-dot" aria-hidden="true" />
        </div>

        <header className="character-header">
          <p className="eyebrow">A historical conversation</p>
          <h1>Speak with {agent.name}</h1>
          <p className="years">{agent.years}</p>
          <p className="subtitle">{agent.subtitle}</p>
        </header>

        {screen === "ready" && (
          <div className="content-block">
            <p className="intro">{agent.intro}</p>
            <p className="small-note">
              Your browser will ask for microphone access. Conversations are limited to approximately {Math.round(sessionSeconds / 60)} minutes.
            </p>
            <button className="primary-button" onClick={startConversation}>
              <MicIcon /> Begin Conversation
            </button>
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
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>

            <p className="live-instruction">
              {screen === "wrapping"
                ? `${agent.shortName} is finishing the conversation.`
                : conversation.isSpeaking
                  ? "You can listen, or begin speaking when the response is finished."
                  : "Speak naturally. Your microphone is live."}
            </p>

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
                    {transcript.map((entry, index) => (
                      <div className="transcript-line" key={`${entry.role}-${index}-${entry.text.slice(0, 20)}`}>
                        <span>{entry.role === "visitor" ? "Visitor" : agent.shortName}</span>
                        <p>{entry.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {screen === "finished" && (
          <div className="content-block finish-block">
            <h2>Thank you for visiting.</h2>
            <p>Your conversation with {agent.name} has ended.</p>
            <div className="control-row centered">
              <button className="secondary-button" onClick={() => {
                setScreen("ready");
                setRemaining(sessionSeconds);
                setTranscript([]);
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
            <button className="primary-button" onClick={() => {
              setScreen("ready");
              setErrorMessage("");
            }}>
              Try Again
            </button>
          </div>
        )}

        <footer>
          <p>
            This experience is a historically informed interpretation created for educational use by the Museum of Public Relations.
          </p>
        </footer>
      </section>
    </main>
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
