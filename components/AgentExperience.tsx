"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { SecondaryDialogueSession, type DialogueCommand } from "@/components/SecondaryDialogueSession";
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
const DIALOGUE_PROMPT_PREFIX = "[PRMUSEUM AI DIALOGUE CONTROL — not spoken by the visitor]";


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

  if (
    !text ||
    text === CLOSE_PROMPT ||
    text.startsWith(SWITCH_PROMPT_PREFIX) ||
    text.startsWith(DIALOGUE_PROMPT_PREFIX)
  ) return null;

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
  aiDialogueEnabled,
  aiDialogueMaxTurns,
}: {
  agentParam: string | null;
  returnUrl: string | null;
  enabledAgentSlugs: AgentSlug[];
  aiDialogueEnabled: boolean;
  aiDialogueMaxTurns: number;
}) {
  const enabledAgents = useMemo(() => enabledAgentSlugs.filter((slug) => Boolean(AGENTS[slug])), [enabledAgentSlugs]);
  const initialAgent = useMemo(() => getPublicAgent(agentParam, enabledAgents), [agentParam, enabledAgents]);
  const [activeAgentSlug, setActiveAgentSlug] = useState<AgentSlug>(initialAgent.slug);
  const [pendingTransferSlug, setPendingTransferSlug] = useState<AgentSlug | null>(null);
  const activeAgentSlugRef = useRef<AgentSlug>(initialAgent.slug);
  // ElevenLabs emits transfer_to_agent as a real system-tool request/response.
  // Track the destination by tool_call_id and only switch the portrait after
  // ElevenLabs reports that the transfer itself succeeded.
  const transferTargetByCallRef = useRef<Map<string, Promise<AgentSlug | null>>>(new Map());
  const noAgentsAvailable = enabledAgents.length === 0;

  const configuredSeconds = Number(process.env.NEXT_PUBLIC_SESSION_SECONDS || 600);
  const sessionSeconds = Number.isFinite(configuredSeconds) && configuredSeconds >= 60
    ? Math.floor(configuredSeconds)
    : 600;

  const [screen, setScreen] = useState<ScreenState>(noAgentsAvailable ? "error" : "ready");
  const [remaining, setRemaining] = useState(sessionSeconds);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState(
    noAgentsAvailable ? "No historical voice agents are currently enabled on the server." : "",
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [textQuestion, setTextQuestion] = useState("");
  const [liveAgentLine, setLiveAgentLine] = useState<TranscriptEntry | null>(null);
  const [dialoguePartnerSlug, setDialoguePartnerSlug] = useState<AgentSlug | null>(
    enabledAgents.find((slug) => slug !== initialAgent.slug) ?? null,
  );
  const [dialogueTopic, setDialogueTopic] = useState("");
  const [dialogueActive, setDialogueActive] = useState(false);
  const [dialoguePair, setDialoguePair] = useState<[AgentSlug, AgentSlug] | null>(null);
  const [dialogueTurnsCompleted, setDialogueTurnsCompleted] = useState(0);
  const [dialogueSecondaryReady, setDialogueSecondaryReady] = useState(false);
  const [dialogueSecondarySpeaking, setDialogueSecondarySpeaking] = useState(false);
  const [dialogueSpeakerSlug, setDialogueSpeakerSlug] = useState<AgentSlug | null>(null);
  const [dialogueCommand, setDialogueCommand] = useState<DialogueCommand | null>(null);

  const displayAgentSlug = dialogueActive && dialogueSpeakerSlug ? dialogueSpeakerSlug : activeAgentSlug;
  const agent = AGENTS[displayAgentSlug];

  const warningSentRef = useRef(false);
  const closePromptSentRef = useRef(false);
  const closingSpeechStartedRef = useRef(false);
  const endRequestedRef = useRef(false);
  const closePromptSentAtRef = useRef<number | null>(null);
  const wasSpeakingRef = useRef(false);
  const alignmentTimersRef = useRef<number[]>([]);
  const liveAgentBufferRef = useRef("");
  const alignmentTurnActiveRef = useRef(false);
  const alignmentSeenInTurnRef = useRef(false);
  // ElevenLabs emits audio alignment in multiple packets whose timestamps are
  // local to each packet. Keep a cumulative cursor so the live transcript grows
  // in the same order the audio is played.
  const alignmentPacketCursorMsRef = useRef(0);
  const alignmentTurnStartedAtRef = useRef<number | null>(null);
  const pendingAgentFinalRef = useRef<TranscriptEntry | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  const dialogueActiveRef = useRef(false);
  const dialoguePairRef = useRef<[AgentSlug, AgentSlug] | null>(null);
  const dialogueTurnsRef = useRef(0);
  const dialogueWasMutedRef = useRef(false);
  const dialoguePrimarySlugRef = useRef<AgentSlug | null>(null);
  const dialoguePhaseRef = useRef<"idle" | "starting-secondary" | "awaiting-primary" | "awaiting-secondary">("idle");
  const dialogueCommandIdRef = useRef(0);
  const secondaryFinalRef = useRef<string | null>(null);
  const secondaryWasSpeakingRef = useRef(false);
  const primaryFinalizeTimerRef = useRef<number | null>(null);
  const secondaryFinalizeTimerRef = useRef<number | null>(null);

  const clearAlignmentTimers = useCallback(() => {
    alignmentTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    alignmentTimersRef.current = [];
  }, []);


  const resetAlignmentStream = useCallback((clearVisible = true) => {
    clearAlignmentTimers();
    liveAgentBufferRef.current = "";
    alignmentTurnActiveRef.current = false;
    alignmentSeenInTurnRef.current = false;
    alignmentPacketCursorMsRef.current = 0;
    alignmentTurnStartedAtRef.current = null;
    pendingAgentFinalRef.current = null;
    if (clearVisible) setLiveAgentLine(null);
  }, [clearAlignmentTimers]);

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
    resetAlignmentStream(true);
    updateAgentUrl(slug);
  }, [enabledAgents, resetAlignmentStream, updateAgentUrl]);

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

  const resolveTransferTarget = useCallback(async (
    sourceSlug: AgentSlug,
    parameters: Record<string, unknown>,
  ): Promise<AgentSlug | null> => {
    // Some future/current payloads may expose an Agent ID directly. Prefer it.
    const directAgentId = typeof parameters.agent_id === "string"
      ? parameters.agent_id.trim()
      : "";

    try {
      if (directAgentId) {
        const directResponse = await fetch(
          `/api/resolve-agent?agent_id=${encodeURIComponent(directAgentId)}`,
          { cache: "no-store" },
        );
        const directData = (await directResponse.json()) as { slug?: string };
        if (directResponse.ok && isAgentSlug(directData.slug) && enabledAgents.includes(directData.slug)) {
          return directData.slug;
        }
      }

      const rawNumber = parameters.agent_number;
      const agentNumber = typeof rawNumber === "number"
        ? rawNumber
        : typeof rawNumber === "string" && rawNumber.trim() !== ""
          ? Number(rawNumber)
          : NaN;

      if (!Number.isInteger(agentNumber) || agentNumber < 0) return null;

      const response = await fetch(
        `/api/resolve-transfer?source=${encodeURIComponent(sourceSlug)}&agent_number=${agentNumber}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { slug?: string; error?: string };

      if (!response.ok || !isAgentSlug(data.slug) || !enabledAgents.includes(data.slug)) {
        console.warn("Unable to resolve transfer destination", data.error || data);
        return null;
      }

      return data.slug;
    } catch (error) {
      console.error("Unable to resolve transfer destination", error);
      return null;
    }
  }, [enabledAgents]);

  const scheduleAlignedTranscript = useCallback((payload: unknown, speakerSlugOverride?: AgentSlug) => {
    const alignment = normalizeAudioAlignment(payload);
    if (!alignment || alignment.chars.length === 0) return;

    const now = performance.now();

    if (!alignmentTurnActiveRef.current) {
      clearAlignmentTimers();
      liveAgentBufferRef.current = "";
      alignmentTurnActiveRef.current = true;
      alignmentSeenInTurnRef.current = true;
      alignmentPacketCursorMsRef.current = 0;
      alignmentTurnStartedAtRef.current = now;
      pendingAgentFinalRef.current = null;
      setLiveAgentLine(null);
    } else {
      alignmentSeenInTurnRef.current = true;
    }

    const chars = alignment.chars;
    const starts = alignment.starts;
    const durations = alignment.durations;
    const speakerSlug = speakerSlugOverride ?? activeAgentSlugRef.current;
    const turnStartedAt = alignmentTurnStartedAtRef.current ?? now;
    const elapsedMs = Math.max(0, now - turnStartedAt);

    const firstStartMs = Number(starts[0] ?? 0);
    const packetBaseMs = Math.max(alignmentPacketCursorMsRef.current, elapsedMs);

    let packetEndMs = 0;
    for (let i = 0; i < chars.length; i += 1) {
      const localStart = Math.max(0, Number(starts[i] ?? firstStartMs) - firstStartMs);
      const duration = Math.max(0, Number(durations[i] ?? 0));
      packetEndMs = Math.max(packetEndMs, localStart + duration);
    }

    if (packetEndMs <= 0) {
      packetEndMs = Math.max(0, Number(starts.at(-1) ?? firstStartMs) - firstStartMs) + 40;
    }
    alignmentPacketCursorMsRef.current = packetBaseMs + packetEndMs;

    // Reveal the current agent turn directly inside the full transcript. This
    // uses audio timing rather than the completed LLM response, so words appear
    // when they are actually spoken.
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
        liveAgentBufferRef.current += chunk;
        const visibleText = liveAgentBufferRef.current.trimStart();
        setLiveAgentLine({ role: "agent", text: visibleText, speakerSlug });
      }, delay);
      alignmentTimersRef.current.push(timer);
      index = end;
    }
  }, [clearAlignmentTimers]);

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
      transferTargetByCallRef.current.clear();
      setPendingTransferSlug(null);
      resetAlignmentStream(false);
      dialogueActiveRef.current = false;
      dialoguePairRef.current = null;
      dialoguePrimarySlugRef.current = null;
      dialoguePhaseRef.current = "idle";
      setDialogueActive(false);
      setDialoguePair(null);
      setDialogueSecondaryReady(false);
      setDialogueSecondarySpeaking(false);
      setDialogueSpeakerSlug(null);
      setDialogueCommand(null);
      setScreen((current) => (current === "error" ? current : "finished"));
    },
    onAgentToolRequest: (request: any) => {
      if (request?.tool_name !== "transfer_to_agent" || request?.tool_type !== "system") return;

      const toolCallId = String(request?.tool_call_id || "");
      if (!toolCallId) return;

      const sourceSlug = activeAgentSlugRef.current;
      const parameters = request?.parameters && typeof request.parameters === "object"
        ? request.parameters as Record<string, unknown>
        : {};

      const targetPromise = resolveTransferTarget(sourceSlug, parameters).then((slug) => {
        if (slug) setPendingTransferSlug(slug);
        return slug;
      });

      transferTargetByCallRef.current.set(toolCallId, targetPromise);
    },
    onAgentToolResponse: async (response: any) => {
      if (response?.tool_name !== "transfer_to_agent" || response?.tool_type !== "system") return;

      const toolCallId = String(response?.tool_call_id || "");
      const targetPromise = transferTargetByCallRef.current.get(toolCallId);
      transferTargetByCallRef.current.delete(toolCallId);

      if (response?.is_error) {
        setPendingTransferSlug(null);
        return;
      }

      const target = targetPromise ? await targetPromise : null;
      if (target) {
        // Normal visitor mode uses ElevenLabs' successful transfer event as the
        // authoritative boundary for changing the displayed historical figure.
        confirmActiveAgent(target);
      } else {
        setPendingTransferSlug(null);
        console.warn("ElevenLabs transferred agents, but the destination could not be mapped to a PRMuseum profile.");
      }
    },
    onAudioAlignment: (alignment: unknown) => {
      scheduleAlignedTranscript(alignment, activeAgentSlugRef.current);
    },
    onMessage: (message) => {
      const normalized = normalizeMessage(message, activeAgentSlugRef.current);
      if (!normalized) return;

      if (normalized.role === "visitor") {
        setTranscript((previous) => mergeTranscript(previous, normalized));
        return;
      }

      // During an AI-to-AI turn, always hold the complete primary response until
      // its voice finishes so the relay cannot interrupt it. In normal visitor
      // mode, alignment events provide the same word-timed transcript behavior.
      if (
        (dialogueActiveRef.current && dialoguePhaseRef.current === "awaiting-primary") ||
        alignmentSeenInTurnRef.current ||
        alignmentTurnActiveRef.current
      ) {
        pendingAgentFinalRef.current = normalized;
        return;
      }

      // Fallback when the agent does not emit alignment events.
      setTranscript((previous) => mergeTranscript(previous, normalized));
    },
    onError: (error) => {
      console.error(error);
      setPendingTransferSlug(null);
      dialogueActiveRef.current = false;
      dialoguePairRef.current = null;
      dialoguePrimarySlugRef.current = null;
      dialoguePhaseRef.current = "idle";
      setDialogueActive(false);
      setDialoguePair(null);
      setDialogueSecondaryReady(false);
      setDialogueSecondarySpeaking(false);
      setDialogueSpeakerSlug(null);
      setDialogueCommand(null);
      resetAlignmentStream(false);
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
    resetAlignmentStream(true);
  }, [resetAlignmentStream]);

  const endNow = useCallback(async () => {
    if (endRequestedRef.current) return;
    endRequestedRef.current = true;

    dialogueActiveRef.current = false;
    dialoguePairRef.current = null;
    dialoguePrimarySlugRef.current = null;
    dialoguePhaseRef.current = "idle";
    setDialogueActive(false);
    setDialoguePair(null);
    setDialogueSecondaryReady(false);
    setDialogueSecondarySpeaking(false);
    setDialogueSpeakerSlug(null);
    setDialogueCommand(null);

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
    dialogueActiveRef.current = false;
    dialoguePairRef.current = null;
    dialoguePrimarySlugRef.current = null;
    dialoguePhaseRef.current = "idle";
    secondaryFinalRef.current = null;
    setDialogueActive(false);
    setDialoguePair(null);
    setDialogueSecondaryReady(false);
    setDialogueSecondarySpeaking(false);
    setDialogueSpeakerSlug(null);
    setDialogueCommand(null);
    setPendingTransferSlug(null);
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
    transferTargetByCallRef.current.clear();
    setPendingTransferSlug(null);
    dialogueActiveRef.current = false;
    dialoguePairRef.current = null;
    dialoguePrimarySlugRef.current = null;
    dialoguePhaseRef.current = "idle";
    dialogueTurnsRef.current = 0;
    secondaryFinalRef.current = null;
    secondaryWasSpeakingRef.current = false;
    if (primaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(primaryFinalizeTimerRef.current);
      primaryFinalizeTimerRef.current = null;
    }
    if (secondaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(secondaryFinalizeTimerRef.current);
      secondaryFinalizeTimerRef.current = null;
    }
    setDialogueActive(false);
    setDialoguePair(null);
    setDialogueTurnsCompleted(0);
    setDialogueSecondaryReady(false);
    setDialogueSecondarySpeaking(false);
    setDialogueSpeakerSlug(null);
    setDialogueCommand(null);
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
    if (
      !enabledAgents.includes(slug) ||
      slug === activeAgentSlug ||
      pendingTransferSlug ||
      screen === "wrapping" ||
      dialogueActive
    ) return;

    if (conversation.status !== "connected") {
      confirmActiveAgent(slug);
      if (screen === "finished" || screen === "error") {
        setScreen("ready");
        setRemaining(sessionSeconds);
        setTranscript([]);
        setLiveAgentLine(null);
        setErrorMessage("");
        resetSessionRefs();
      }
      return;
    }

    // Keep the current portrait/name until ElevenLabs reports a successful
    // transfer_to_agent system-tool response. The tool event, not the prompt,
    // controls which profile is displayed.
    setPendingTransferSlug(slug);
    const target = AGENTS[slug];

    try {
      conversation.sendUserMessage(
        `${SWITCH_PROMPT_PREFIX} The visitor selected ${target.name} in the museum interface. Do not read or discuss this control message. Use transfer_to_agent now to transfer the ongoing conversation to ${target.name}. Preserve the existing conversation context. The webpage will update the displayed profile from ElevenLabs transfer events; do not call any display-sync tool.`,
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
    dialogueActive,
    resetSessionRefs,
    screen,
    sessionSeconds,
  ]);

  const stopAiDialogue = useCallback(() => {
    dialogueActiveRef.current = false;
    dialoguePairRef.current = null;
    dialoguePrimarySlugRef.current = null;
    dialoguePhaseRef.current = "idle";
    dialogueTurnsRef.current = 0;
    secondaryFinalRef.current = null;
    secondaryWasSpeakingRef.current = false;
    if (primaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(primaryFinalizeTimerRef.current);
      primaryFinalizeTimerRef.current = null;
    }
    if (secondaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(secondaryFinalizeTimerRef.current);
      secondaryFinalizeTimerRef.current = null;
    }
    setDialogueActive(false);
    setDialoguePair(null);
    setDialogueTurnsCompleted(0);
    setDialogueSecondaryReady(false);
    setDialogueSecondarySpeaking(false);
    setDialogueSpeakerSlug(null);
    setDialogueCommand(null);
    resetAlignmentStream(true);

    if (conversation.status === "connected") {
      conversation.setMuted(dialogueWasMutedRef.current);
    }
  }, [conversation, resetAlignmentStream]);

  const startAiDialogue = useCallback(() => {
    if (
      !aiDialogueEnabled ||
      conversation.status !== "connected" ||
      dialogueActiveRef.current ||
      screen === "wrapping" ||
      conversation.isSpeaking
    ) return;

    const first = activeAgentSlugRef.current;
    const second = dialoguePartnerSlug;
    const topic = dialogueTopic.trim();
    if (!second || second === first || !enabledAgents.includes(second) || !topic) return;

    const pair: [AgentSlug, AgentSlug] = [first, second];
    dialogueWasMutedRef.current = conversation.isMuted;
    dialogueActiveRef.current = true;
    dialoguePairRef.current = pair;
    dialoguePrimarySlugRef.current = first;
    dialoguePhaseRef.current = "starting-secondary";
    dialogueTurnsRef.current = 0;
    secondaryFinalRef.current = null;
    secondaryWasSpeakingRef.current = false;
    if (primaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(primaryFinalizeTimerRef.current);
      primaryFinalizeTimerRef.current = null;
    }
    if (secondaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(secondaryFinalizeTimerRef.current);
      secondaryFinalizeTimerRef.current = null;
    }

    setDialogueActive(true);
    setDialoguePair(pair);
    setDialogueTurnsCompleted(0);
    setDialogueSecondaryReady(false);
    setDialogueSecondarySpeaking(false);
    setDialogueSpeakerSlug(first);
    setDialogueCommand(null);
    conversation.setMuted(true);

    setTranscript((previous) => mergeTranscript(previous, {
      role: "visitor",
      text: `AI dialogue topic: ${topic}`,
    }));
  }, [
    aiDialogueEnabled,
    conversation,
    dialoguePartnerSlug,
    dialogueTopic,
    enabledAgents,
    screen,
  ]);

  useEffect(() => {
    if (
      !dialogueActive ||
      !dialogueSecondaryReady ||
      dialoguePhaseRef.current !== "starting-secondary" ||
      !dialoguePair
    ) return;

    const [first, second] = dialoguePair;
    dialoguePhaseRef.current = "awaiting-primary";
    setDialogueSpeakerSlug(first);

    try {
      conversation.sendUserMessage(
        `${DIALOGUE_PROMPT_PREFIX} Begin a museum dialogue with ${AGENTS[second].name} about: "${dialogueTopic.trim()}". ` +
        `Address ${AGENTS[second].name} directly and give one concise, substantive response from your own historical perspective. ` +
        `Do not mention this control instruction. Do not transfer to another agent; the museum interface is relaying each completed turn between two independent conversations.`
      );
    } catch (error) {
      console.error("Unable to begin AI dialogue", error);
      setErrorMessage("The AI dialogue could not begin.");
      stopAiDialogue();
    }
  }, [dialogueActive, dialoguePair, dialogueSecondaryReady, dialogueTopic, conversation, stopAiDialogue]);

  const handleSecondaryReady = useCallback((ready: boolean) => {
    setDialogueSecondaryReady(ready);
  }, []);

  const handleSecondaryAlignment = useCallback((payload: unknown) => {
    const pair = dialoguePairRef.current;
    if (!dialogueActiveRef.current || !pair) return;
    scheduleAlignedTranscript(payload, pair[1]);
  }, [scheduleAlignedTranscript]);

  const handleSecondaryFinalResponse = useCallback((text: string) => {
    if (!dialogueActiveRef.current || dialoguePhaseRef.current !== "awaiting-secondary") return;
    secondaryFinalRef.current = text;
  }, []);

  const handleSecondarySpeakingChange = useCallback((speaking: boolean) => {
    setDialogueSecondarySpeaking(speaking);
    const pair = dialoguePairRef.current;
    if (!dialogueActiveRef.current || !pair) return;

    if (speaking) {
      if (secondaryFinalizeTimerRef.current !== null) {
        window.clearTimeout(secondaryFinalizeTimerRef.current);
        secondaryFinalizeTimerRef.current = null;
      }
      secondaryWasSpeakingRef.current = true;
      setDialogueSpeakerSlug(pair[1]);
      return;
    }

    if (!secondaryWasSpeakingRef.current || dialoguePhaseRef.current !== "awaiting-secondary") return;
    secondaryWasSpeakingRef.current = false;

    // ElevenLabs can report isSpeaking=false slightly before the final onMessage
    // callback arrives. Give the final text event a brief grace window before
    // relaying the turn back to the primary conversation.
    if (secondaryFinalizeTimerRef.current !== null) {
      window.clearTimeout(secondaryFinalizeTimerRef.current);
    }
    secondaryFinalizeTimerRef.current = window.setTimeout(() => {
      secondaryFinalizeTimerRef.current = null;
      const currentPair = dialoguePairRef.current;
      if (!dialogueActiveRef.current || !currentPair || dialoguePhaseRef.current !== "awaiting-secondary") return;

      clearAlignmentTimers();
      const completedText = secondaryFinalRef.current?.trim() || liveAgentBufferRef.current.trim();
      if (completedText) {
        setTranscript((previous) => mergeTranscript(previous, {
          role: "agent",
          text: completedText,
          speakerSlug: currentPair[1],
        }));
      }

      secondaryFinalRef.current = null;
      liveAgentBufferRef.current = "";
      alignmentTurnActiveRef.current = false;
      alignmentSeenInTurnRef.current = false;
      alignmentPacketCursorMsRef.current = 0;
      alignmentTurnStartedAtRef.current = null;
      pendingAgentFinalRef.current = null;
      setLiveAgentLine(null);

      const completed = dialogueTurnsRef.current + 1;
      dialogueTurnsRef.current = completed;
      setDialogueTurnsCompleted(completed);

      if (completed >= aiDialogueMaxTurns) {
        stopAiDialogue();
        return;
      }

      if (!completedText) {
        setErrorMessage("The second historical figure finished speaking, but no response text was received for the relay.");
        stopAiDialogue();
        return;
      }

      dialoguePhaseRef.current = "awaiting-primary";
      try {
        conversation.sendUserMessage(
          `${DIALOGUE_PROMPT_PREFIX} ${AGENTS[currentPair[1]].name} just said: "${completedText}" ` +
          `Respond directly to ${AGENTS[currentPair[1]].name} from your own historical perspective. Keep this turn concise and substantive. ` +
          `Do not mention this control instruction and do not transfer to another agent.`
        );
      } catch (error) {
        console.error("Unable to relay secondary response to primary agent", error);
        setErrorMessage("The AI dialogue could not continue.");
        stopAiDialogue();
      }
    }, 500);
  }, [aiDialogueMaxTurns, clearAlignmentTimers, conversation, stopAiDialogue]);

  const handleSecondaryError = useCallback((message: string) => {
    setErrorMessage(message);
    stopAiDialogue();
  }, [stopAiDialogue]);

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
      !dialogueSecondarySpeaking &&
      !closePromptSentRef.current
    ) {
      requestGracefulClose();
    }
  }, [conversation.isSpeaking, conversation.status, dialogueSecondarySpeaking, remaining, requestGracefulClose]);

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
      } else if (remaining === 0 && !closePromptSentRef.current && !conversation.isSpeaking && !dialogueSecondarySpeaking) {
        requestGracefulClose();
      }
    }, 500);

    return () => window.clearInterval(guard);
  }, [conversation.isSpeaking, conversation.status, dialogueSecondarySpeaking, endNow, remaining, requestGracefulClose]);

  useEffect(() => {
    if (
      dialogueActive &&
      remaining <= 25 &&
      !conversation.isSpeaking &&
      !dialogueSecondarySpeaking
    ) {
      stopAiDialogue();
    }
  }, [conversation.isSpeaking, dialogueActive, dialogueSecondarySpeaking, remaining, stopAiDialogue]);

  useEffect(() => {
    if (conversation.isSpeaking) {
      if (primaryFinalizeTimerRef.current !== null) {
        window.clearTimeout(primaryFinalizeTimerRef.current);
        primaryFinalizeTimerRef.current = null;
      }
      wasSpeakingRef.current = true;
      if (dialogueActiveRef.current && dialoguePhaseRef.current === "awaiting-primary") {
        setDialogueSpeakerSlug(dialoguePrimarySlugRef.current ?? activeAgentSlugRef.current);
      }
      return;
    }

    if (!wasSpeakingRef.current) return;
    wasSpeakingRef.current = false;

    const finalize = () => {
      primaryFinalizeTimerRef.current = null;
      clearAlignmentTimers();
      const pendingFinal = pendingAgentFinalRef.current;
      const liveText = liveAgentBufferRef.current.trim();
      const primarySlug = dialoguePrimarySlugRef.current ?? activeAgentSlugRef.current;
      const liveSpeaker = liveAgentLine?.speakerSlug ?? primarySlug;
      const completedText = pendingFinal?.text?.trim() || liveText;

      if (pendingFinal) {
        setTranscript((previous) => mergeTranscript(previous, pendingFinal));
      } else if (liveText) {
        setTranscript((previous) => mergeTranscript(previous, {
          role: "agent",
          text: liveText,
          speakerSlug: liveSpeaker,
        }));
      }

      pendingAgentFinalRef.current = null;
      liveAgentBufferRef.current = "";
      alignmentTurnActiveRef.current = false;
      alignmentSeenInTurnRef.current = false;
      alignmentPacketCursorMsRef.current = 0;
      alignmentTurnStartedAtRef.current = null;
      setLiveAgentLine(null);

      if (
        dialogueActiveRef.current &&
        dialoguePhaseRef.current === "awaiting-primary"
      ) {
        const pair = dialoguePairRef.current;
        if (!pair) {
          stopAiDialogue();
          return;
        }

        if (!completedText) {
          setErrorMessage("The first historical figure finished speaking, but no response text was received for the relay.");
          stopAiDialogue();
          return;
        }

        const completed = dialogueTurnsRef.current + 1;
        dialogueTurnsRef.current = completed;
        setDialogueTurnsCompleted(completed);

        if (completed >= aiDialogueMaxTurns) {
          stopAiDialogue();
          return;
        }

        dialoguePhaseRef.current = "awaiting-secondary";
        dialogueCommandIdRef.current += 1;
        setDialogueCommand({
          id: dialogueCommandIdRef.current,
          text:
            `${DIALOGUE_PROMPT_PREFIX} ${AGENTS[pair[0]].name} just said: "${completedText}" ` +
            `Respond directly to ${AGENTS[pair[0]].name} from your own historical perspective. Keep this turn concise and substantive. ` +
            `Do not mention this control instruction and do not transfer to another agent.`,
        });
      }
    };

    // The final onMessage event can arrive just after isSpeaking becomes false.
    // Delay finalization briefly so the relay always has the completed text.
    if (dialogueActiveRef.current && dialoguePhaseRef.current === "awaiting-primary") {
      primaryFinalizeTimerRef.current = window.setTimeout(finalize, 500);
    } else {
      finalize();
    }
  }, [
    aiDialogueMaxTurns,
    clearAlignmentTimers,
    conversation.isSpeaking,
    liveAgentLine,
    stopAiDialogue,
  ]);

  useEffect(() => {
    if (dialogueActive || !enabledAgents.length) return;
    if (!dialoguePartnerSlug || dialoguePartnerSlug === activeAgentSlug || !enabledAgents.includes(dialoguePartnerSlug)) {
      setDialoguePartnerSlug(enabledAgents.find((slug) => slug !== activeAgentSlug) ?? null);
    }
  }, [activeAgentSlug, dialogueActive, dialoguePartnerSlug, enabledAgents]);

  useEffect(() => {
    const container = transcriptScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [transcript, liveAgentLine]);

  useEffect(() => {
    if (!pendingTransferSlug || conversation.status !== "connected") return;
    const timer = window.setTimeout(() => {
      setPendingTransferSlug(null);
      setErrorMessage("The agent transfer did not complete. You can try selecting the figure again.");
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [conversation.status, pendingTransferSlug]);

  useEffect(() => {
    return () => {
      clearAlignmentTimers();
    };
  }, [clearAlignmentTimers]);

  const isDisplayedSpeaking = dialogueActive
    ? dialogueSecondarySpeaking || conversation.isSpeaking
    : conversation.isSpeaking;

  const statusLabel =
    screen === "wrapping"
      ? "Concluding"
      : pendingTransferSlug
        ? `Connecting to ${AGENTS[pendingTransferSlug].shortName}`
        : conversation.status === "connecting"
          ? "Connecting"
          : isDisplayedSpeaking
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

  const textDisabled =
    screen === "wrapping" ||
    conversation.status === "connecting" ||
    noAgentsAvailable ||
    dialogueActive;

  return (
    <main className="experience-shell">
      <div className="experience-layout">
        <section className="museum-card" aria-live="polite">
          <div className="museum-mark">Museum of Public Relations</div>

          <div
            className={`portrait-wrap ${isDisplayedSpeaking ? "speaking" : ""}`}
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

              <div className={`voice-orb ${isDisplayedSpeaking ? "agent-speaking" : "listening"}`} aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>

              <div className="live-transcript-wrap">
                <div className="live-transcript-heading">
                  <span>Live transcript</span>
                  {dialogueActive && dialoguePair && (
                    <small>AI dialogue · {dialogueTurnsCompleted}/{aiDialogueMaxTurns} turns</small>
                  )}
                </div>
                <div
                  className="transcript live-transcript"
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                  ref={transcriptScrollRef}
                >
                  {transcript.length === 0 && !liveAgentLine && (
                    <p className="transcript-placeholder">The conversation transcript will appear here.</p>
                  )}
                  {transcript.map((entry, index) => {
                    const speaker = entry.speakerSlug ? AGENTS[entry.speakerSlug].shortName : agent.shortName;
                    return (
                      <div className="transcript-line" key={`${entry.role}-${index}-${entry.text.slice(0, 20)}`}>
                        <span>{entry.role === "visitor" ? "Visitor" : speaker}</span>
                        <p>{entry.text}</p>
                      </div>
                    );
                  })}
                  {liveAgentLine && (
                    <div className="transcript-line live-line">
                      <span>{liveAgentLine.speakerSlug ? AGENTS[liveAgentLine.speakerSlug].shortName : agent.shortName}</span>
                      <p>{liveAgentLine.text}<span className="live-cursor" aria-hidden="true">▌</span></p>
                    </div>
                  )}
                </div>
              </div>

              <p className="live-instruction">
                {screen === "wrapping"
                  ? `${agent.shortName} is finishing the conversation.`
                  : pendingTransferSlug
                    ? `Transferring the conversation to ${AGENTS[pendingTransferSlug].name}…`
                    : isDisplayedSpeaking
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

              {aiDialogueEnabled && enabledAgents.length > 1 && (
                <div className={`ai-dialogue-panel ${dialogueActive ? "active" : ""}`}>
                  <div className="ai-dialogue-heading">
                    <div>
                      <span>Experimental</span>
                      <strong>AI-to-AI dialogue</strong>
                    </div>
                    {dialogueActive && dialoguePair && (
                      <small>{AGENTS[dialoguePair[0]].shortName} ↔ {AGENTS[dialoguePair[1]].shortName}</small>
                    )}
                  </div>

                  {!dialogueActive ? (
                    <>
                      <p>Let two historical figures alternate responses on a topic using two independent ElevenLabs sessions. The visitor microphone is muted while they speak with each other.</p>
                      <div className="ai-dialogue-fields">
                        <label>
                          <span>Second figure</span>
                          <select
                            value={dialoguePartnerSlug ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (isAgentSlug(value)) setDialoguePartnerSlug(value);
                            }}
                          >
                            {enabledAgents.filter((slug) => slug !== activeAgentSlug).map((slug) => (
                              <option value={slug} key={slug}>{AGENTS[slug].name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="dialogue-topic-field">
                          <span>Topic</span>
                          <input
                            value={dialogueTopic}
                            onChange={(event) => setDialogueTopic(event.target.value)}
                            placeholder="e.g. Should corporations shape public opinion?"
                            maxLength={300}
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary-button dialogue-start-button"
                          onClick={startAiDialogue}
                          disabled={!dialoguePartnerSlug || !dialogueTopic.trim() || pendingTransferSlug !== null || conversation.isSpeaking}
                        >
                          Start dialogue
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="ai-dialogue-running">
                      <p>{dialogueSecondaryReady ? `Turn ${Math.min(dialogueTurnsCompleted + 1, aiDialogueMaxTurns)} of ${aiDialogueMaxTurns}.` : "Connecting the second historical figure…"} You can stop the exchange at any time.</p>
                      <button type="button" className="secondary-button" onClick={stopAiDialogue}>Stop AI dialogue</button>
                    </div>
                  )}
                </div>
              )}

              <div className="control-row">
                <button
                  className="secondary-button"
                  onClick={() => conversation.setMuted(!conversation.isMuted)}
                  disabled={screen === "wrapping" || dialogueActive}
                >
                  {conversation.isMuted ? <MicIcon /> : <MuteIcon />}
                  {conversation.isMuted ? "Unmute" : "Mute"}
                </button>
                <button className="end-button" onClick={() => void endNow()}>
                  End Conversation
                </button>
              </div>

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
                  setLiveAgentLine(null);
                  stopAiDialogue();
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
              {transcript.length > 0 && (
                <div className="finished-transcript-wrap">
                  <div className="live-transcript-heading"><span>Conversation transcript</span></div>
                  <div className="transcript live-transcript finished-transcript" role="log">
                    {transcript.map((entry, index) => {
                      const speaker = entry.speakerSlug ? AGENTS[entry.speakerSlug].shortName : agent.shortName;
                      return (
                        <div className="transcript-line" key={`finished-${entry.role}-${index}-${entry.text.slice(0, 20)}`}>
                          <span>{entry.role === "visitor" ? "Visitor" : speaker}</span>
                          <p>{entry.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
              const isDialogueSpeaker = dialogueActive && slug === dialogueSpeakerSlug;
              const isDialogueParticipant = dialogueActive && Boolean(dialoguePair?.includes(slug));
              const isPending = slug === pendingTransferSlug;
              const disabled =
                screen === "wrapping" ||
                dialogueActive ||
                (!!pendingTransferSlug && !isPending);

              return (
                <button
                  className={`agent-choice ${(isActive || isDialogueSpeaker) ? "active" : ""} ${isPending ? "pending" : ""}`}
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
                    {isPending ? "Connecting…" : isDialogueSpeaker ? "Speaking" : isDialogueParticipant ? "Dialogue" : isActive ? "On line" : "Select"}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="rail-note">
            In visitor mode the portrait follows successful agent transfers. In AI dialogue mode it follows the independent conversation instance that is actually speaking.
          </p>
        </aside>
      </div>

      {dialogueActive && dialoguePair && (
        <ConversationProvider>
          <SecondaryDialogueSession
            slug={dialoguePair[1]}
            command={dialogueCommand}
            onReady={handleSecondaryReady}
            onSpeakingChange={handleSecondarySpeakingChange}
            onAlignment={handleSecondaryAlignment}
            onFinalResponse={handleSecondaryFinalResponse}
            onError={handleSecondaryError}
          />
        </ConversationProvider>
      )}
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
