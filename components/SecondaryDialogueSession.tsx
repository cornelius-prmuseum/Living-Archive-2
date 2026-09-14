"use client";

import { useEffect, useRef } from "react";
import { Conversation } from "@elevenlabs/react";
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
  const readyTimerRef = useRef<number | null>(null);
  const responseWatchdogRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const clearReadyTimer = () => {
    if (readyTimerRef.current !== null) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  };

  const clearWatchdog = () => {
    if (responseWatchdogRef.current !== null) {
      window.clearTimeout(responseWatchdogRef.current);
      responseWatchdogRef.current = null;
    }
  };

  const scheduleReady = () => {
    if (disposedRef.current || readyRef.current || armedRef.current || speakingRef.current) return;
    clearReadyTimer();
    onStatus("warming-up");
    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null;
      if (disposedRef.current || speakingRef.current || armedRef.current || !sessionRef.current) return;
      readyRef.current = true;
      onReady(true);
      onStatus("ready");
    }, 1200);
  };

  useEffect(() => {
    disposedRef.current = false;
    readyRef.current = false;
    armedRef.current = false;
    speakingRef.current = false;
    lastCommandIdRef.current = null;
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
              clearReadyTimer();
              clearWatchdog();
              if (armedRef.current) {
                onSpeakingChange(true);
                onStatus("speaking");
              } else {
                // A configured First Message may play while the hidden session warms up.
                onStatus("warming-up");
              }
              return;
            }

            if (armedRef.current) {
              onSpeakingChange(false);
              onStatus("waiting-final");
            } else {
              scheduleReady();
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
            onError(
              typeof error === "string"
                ? error
                : "The second historical figure's ElevenLabs session encountered an error.",
            );
          },
        });

        if (disposedRef.current) {
          await session.endSession();
          return;
        }

        sessionRef.current = session;
        session.setMicMuted(true);
        await session.setVolume({ volume: 0 });

        // If there is no First Message, no mode transition may follow connection.
        // This timer makes the session ready after a short quiet warm-up. If a
        // First Message begins, onModeChange cancels/restarts it.
        scheduleReady();
      } catch (error) {
        if (disposedRef.current) return;
        console.error("Unable to start direct secondary dialogue session", error);
        onStatus("error");
        onError(error instanceof Error ? error.message : "Unable to start the second historical figure.");
      }
    }

    void start();

    return () => {
      disposedRef.current = true;
      clearReadyTimer();
      clearWatchdog();
      readyRef.current = false;
      armedRef.current = false;
      speakingRef.current = false;
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
    if (!command || !readyRef.current || !sessionRef.current) return;
    if (lastCommandIdRef.current === command.id) return;

    lastCommandIdRef.current = command.id;
    armedRef.current = true;
    const commandText = command.text;
    const session = sessionRef.current;

    async function send() {
      try {
        await session.setVolume({ volume: 1 });
        session.setMicMuted(true);
        onStatus("relay-sent");
        session.sendUserMessage(commandText);

        clearWatchdog();
        responseWatchdogRef.current = window.setTimeout(() => {
          responseWatchdogRef.current = null;
          if (!disposedRef.current && !speakingRef.current) {
            onStatus("error");
            onError(
              "The second ElevenLabs session is connected and received the relay, but it did not enter speaking mode within 15 seconds. Check the agent's text-response behavior and your ElevenLabs concurrency limit.",
            );
          }
        }, 15_000);
      } catch (error) {
        console.error("Unable to send relay to direct secondary session", error);
        onStatus("error");
        onError("The AI dialogue could not send the next turn to the second historical figure.");
      }
    }

    void send();
  }, [command, onError, onStatus]);

  return null;
}
