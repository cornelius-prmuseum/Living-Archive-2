"use client";

import { useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import type { AgentSlug } from "@/lib/agents";

export type DialogueCommand = {
  id: number;
  text: string;
};

function extractAgentText(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const nested = e.agent_response_event as Record<string, unknown> | undefined;
  const candidates = [e.message, e.text, e.transcript, nested?.agent_response];
  const text = candidates.find((value) => typeof value === "string" && value.trim()) as string | undefined;
  if (!text) return null;

  const source = String(e.source ?? e.role ?? e.type ?? "").toLowerCase();
  const isAgent = Boolean(nested) || source.includes("agent") || source.includes("assistant");
  return isAgent ? text.trim() : null;
}

export function SecondaryDialogueSession({
  slug,
  command,
  onReady,
  onSpeakingChange,
  onAlignment,
  onFinalResponse,
  onError,
}: {
  slug: AgentSlug;
  command: DialogueCommand | null;
  onReady: (ready: boolean) => void;
  onSpeakingChange: (speaking: boolean) => void;
  onAlignment: (payload: unknown) => void;
  onFinalResponse: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [initialized, setInitialized] = useState(false);
  const [ready, setReady] = useState(false);
  const armedRef = useRef(false);
  const lastCommandIdRef = useRef<number | null>(null);
  const readyTimerRef = useRef<number | null>(null);

  const conversation = useConversation({
    micMuted: true,
    onConnect: () => {
      setInitialized(true);
    },
    onDisconnect: () => {
      setInitialized(false);
      setReady(false);
      onReady(false);
      onSpeakingChange(false);
    },
    onAudioAlignment: (alignment: unknown) => {
      if (armedRef.current) onAlignment(alignment);
    },
    onMessage: (message: unknown) => {
      if (!armedRef.current) return;
      const text = extractAgentText(message);
      if (text) onFinalResponse(text);
    },
    onError: (error) => {
      console.error("Secondary dialogue session error", error);
      onError(typeof error === "string" ? error : "The second historical figure's dialogue session encountered an error.");
    },
  });


  useEffect(() => {
    if (!initialized || conversation.status !== "connected") return;
    // Silence any configured First Message while this hidden session warms up.
    // The first real dialogue response is unmuted immediately before it is sent.
    void conversation.setVolume({ volume: 0 });
    conversation.setMuted(true);
  }, [conversation, conversation.status, initialized]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const response = await fetch(`/api/token?agent=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const data = (await response.json()) as { token?: string; error?: string };
        if (!response.ok || !data.token) throw new Error(data.error || "Unable to create the second conversation token.");
        if (cancelled) return;
        await conversation.startSession({ conversationToken: data.token });
      } catch (error) {
        if (cancelled) return;
        console.error("Unable to start secondary dialogue session", error);
        onError(error instanceof Error ? error.message : "Unable to start the second historical figure.");
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current);
      void conversation.endSession().catch(() => undefined);
    };
    // slug intentionally defines the lifetime of this independent session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    onSpeakingChange(armedRef.current && conversation.isSpeaking);
  }, [conversation.isSpeaking, onSpeakingChange]);

  useEffect(() => {
    if (!initialized || ready || armedRef.current || conversation.status !== "connected") return;

    if (readyTimerRef.current !== null) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }

    // If a First Message exists, it is playing silently at volume 0. Wait until
    // the session has remained quiet before declaring it ready for the relay.
    if (conversation.isSpeaking) return;

    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null;
      setReady(true);
      onReady(true);
    }, 1200);

    return () => {
      if (readyTimerRef.current !== null) {
        window.clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
  }, [conversation.isSpeaking, conversation.status, initialized, onReady, ready]);

  useEffect(() => {
    if (!ready || !command || conversation.status !== "connected") return;
    if (lastCommandIdRef.current === command.id) return;

    lastCommandIdRef.current = command.id;
    armedRef.current = true;

    async function send() {
      try {
        await conversation.setVolume({ volume: 1 });
        conversation.setMuted(true);
        conversation.sendUserMessage(command.text);
      } catch (error) {
        console.error("Unable to send AI dialogue relay to secondary agent", error);
        onError("The AI dialogue could not send the next turn to the second historical figure.");
      }
    }

    void send();
  }, [command, conversation, onError, ready]);

  return null;
}
