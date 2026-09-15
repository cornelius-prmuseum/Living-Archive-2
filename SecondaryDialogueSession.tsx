"use client";

import { useEffect, useRef } from "react";
import { Conversation } from "@elevenlabs/client";
import type { AgentSlug } from "@/lib/agents";

export type DialogueCommand = {
  id: number;
  text: string;
};

export type SecondaryDialogueStatus =
  | "fetching-token"
  | "connecting"
  | "warming-up"
  | "ready"
  | "relay-queued"
  | "relay-sent"
  | "speaking"
  | "waiting-final"
  | "disconnected"
  | "error";

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
  const value = String((event as Record<string, unknown>).mode ?? "").toLowerCase();
  return value === "speaking";
}

export function SecondaryDialogueSession({
  slug,
  command,
  onReady,
  onSpeakingChange,
  onAlignment,
  onFinalResponse,
  onStatus,
  onError,
}: {
  slug: AgentSlug;
  command: DialogueCommand | null;
  onReady: (ready: boolean) => void;
  onSpeakingChange: (speaking: boolean) => void;
  onAlignment: (payload: unknown) => void;
  onFinalResponse: (text: string) => void;
  onStatus: (status: SecondaryDialogueStatus) => void;
  onError: (message: string) => void;
}) {
  const sessionRef = useRef<any>(null);
  const readyRef = useRef(false);
  const armedRef = useRef(false);
  const speakingRef = useRef(false);
  const lastCommandIdRef = useRef<number | null>(null);
  const pendingCommandRef = useRef<DialogueCommand | null>(null);
  const responseWatchdogRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const sendingRef = useRef(false);

  const clearWatchdog = () => {
    if (responseWatchdogRef.current !== null) {
      window.clearTimeout(responseWatchdogRef.current);
      responseWatchdogRef.current = null;
    }
  };

  const reportOverrideError = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error ?? "");
    const lower = raw.toLowerCase();
    if (lower.includes("override") || lower.includes("first message") || lower.includes("first_message")) {
      return "The second agent could not start silently. In ElevenLabs, open this agent → Security and enable the First message override, then try AI dialogue again.";
    }
    return raw || "Unable to start the second historical figure.";
  };

  const dispatchPendingCommand = async () => {
    if (
      disposedRef.current ||
      sendingRef.current ||
      !readyRef.current ||
      speakingRef.current ||
      !sessionRef.current ||
      !pendingCommandRef.current
    ) {
      return;
    }

    const queued = pendingCommandRef.current;
    if (lastCommandIdRef.current === queued.id) {
      pendingCommandRef.current = null;
      return;
    }

    sendingRef.current = true;
    lastCommandIdRef.current = queued.id;
    pendingCommandRef.current = null;
    armedRef.current = true;

    try {
      const session = sessionRef.current;
      session.setMicMuted(true);
      await session.setVolume({ volume: 1 });
      if (disposedRef.current) return;

      onStatus("relay-sent");
      session.sendUserMessage(queued.text);

      clearWatchdog();
      responseWatchdogRef.current = window.setTimeout(() => {
        responseWatchdogRef.current = null;
        if (!disposedRef.current && !speakingRef.current) {
          onStatus("error");
          onError(
            "The second ElevenLabs session received the relay but did not begin speaking within 15 seconds. Check the agent's response behavior and your ElevenLabs concurrency limit.",
          );
        }
      }, 15_000);
    } catch (error) {
      console.error("Unable to send relay to direct secondary session", error);
      onStatus("error");
      onError("The AI dialogue could not send the next turn to the second historical figure.");
    } finally {
      sendingRef.current = false;
    }
  };

  const markReady = () => {
    if (disposedRef.current || speakingRef.current || !sessionRef.current) return;
    readyRef.current = true;
    onReady(true);
    onStatus("ready");
    void dispatchPendingCommand();
  };

  useEffect(() => {
    disposedRef.current = false;
    readyRef.current = false;
    armedRef.current = false;
    speakingRef.current = false;
    lastCommandIdRef.current = null;
    pendingCommandRef.current = null;
    sendingRef.current = false;
    onReady(false);
    onSpeakingChange(false);

    async function start() {
      try {
        onStatus("fetching-token");
        const response = await fetch(`/api/token?agent=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const data = (await response.json()) as { token?: string; error?: string };
        if (!response.ok || !data.token) {
          throw new Error(data.error || "Unable to create the second conversation token.");
        }
        if (disposedRef.current) return;

        onStatus("connecting");
        const session = await Conversation.startSession({
          conversationToken: data.token,
          // The secondary dialogue session must never emit its normal visitor greeting.
          // ElevenLabs requires Security → Overrides → First message to be enabled
          // for this per-conversation override.
          overrides: {
            agent: {
              firstMessage: "",
            },
          },
          onConnect: () => {
            if (disposedRef.current) return;
            onStatus("warming-up");
          },
          onDisconnect: () => {
            if (disposedRef.current) return;
            readyRef.current = false;
            speakingRef.current = false;
            onReady(false);
            onSpeakingChange(false);
            onStatus("disconnected");
          },
          onModeChange: (event: unknown) => {
            if (disposedRef.current) return;
            const speaking = modeIsSpeaking(event);
            speakingRef.current = speaking;

            if (speaking) {
              clearWatchdog();
              if (armedRef.current) {
                onSpeakingChange(true);
                onStatus("speaking");
              } else {
                // Defensive fallback: if a dashboard greeting somehow still fires,
                // keep it silent and do not treat it as a dialogue turn.
                onStatus("warming-up");
                void sessionRef.current?.setVolume?.({ volume: 0 });
              }
              return;
            }

            if (armedRef.current) {
              onSpeakingChange(false);
              onStatus("waiting-final");
            } else {
              // Any unexpected startup speech has now ended; the relay may proceed.
              markReady();
            }
          },
          onAudioAlignment: (alignment: unknown) => {
            if (armedRef.current && !disposedRef.current) onAlignment(alignment);
          },
          onMessage: (message: unknown) => {
            if (!armedRef.current || disposedRef.current) return;
            const text = extractAgentText(message);
            if (text) onFinalResponse(text);
          },
          onError: (error: unknown) => {
            if (disposedRef.current) return;
            console.error("Secondary dialogue direct session error", error);
            onStatus("error");
            onError(reportOverrideError(error));
          },
        });

        if (disposedRef.current) {
          await session.endSession();
          return;
        }

        sessionRef.current = session;
        session.setMicMuted(true);
        await session.setVolume({ volume: 0 });

        // With firstMessage overridden to blank there is no greeting to wait out.
        // startSession has resolved, so the independent conversation is ready.
        markReady();
      } catch (error) {
        if (disposedRef.current) return;
        console.error("Unable to start direct secondary dialogue session", error);
        onStatus("error");
        onError(reportOverrideError(error));
      }
    }

    void start();

    return () => {
      disposedRef.current = true;
      clearWatchdog();
      readyRef.current = false;
      armedRef.current = false;
      speakingRef.current = false;
      pendingCommandRef.current = null;
      sendingRef.current = false;
      onReady(false);
      onSpeakingChange(false);

      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        try {
          const result = session.endSession();
          if (result && typeof result.catch === "function") {
            result.catch((error: unknown) => console.error("Error ending secondary dialogue session", error));
          }
        } catch (error) {
          console.error("Error ending secondary dialogue session", error);
        }
      }
    };
    // slug defines the lifetime of this completely independent SDK session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!command) return;
    if (lastCommandIdRef.current === command.id) return;

    // Never drop a relay simply because the hidden session is still connecting.
    // Keep only the newest command; dialogue itself is strictly sequential.
    pendingCommandRef.current = command;
    if (!readyRef.current) {
      onStatus("relay-queued");
      return;
    }

    void dispatchPendingCommand();
    // dispatchPendingCommand intentionally reads the latest refs rather than state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  return null;
}
