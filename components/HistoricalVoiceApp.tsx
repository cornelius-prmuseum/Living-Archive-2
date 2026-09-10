"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { AgentExperience } from "@/components/AgentExperience";

export function HistoricalVoiceApp({
  agentParam,
  returnUrl,
}: {
  agentParam: string | null;
  returnUrl: string | null;
}) {
  return (
    <ConversationProvider>
      <AgentExperience agentParam={agentParam} returnUrl={returnUrl} />
    </ConversationProvider>
  );
}
