"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { AgentExperience } from "@/components/AgentExperience";
import type { AgentSlug } from "@/lib/agents";

export function HistoricalVoiceApp({
  agentParam,
  returnUrl,
  enabledAgentSlugs,
}: {
  agentParam: string | null;
  returnUrl: string | null;
  enabledAgentSlugs: AgentSlug[];
}) {
  return (
    <ConversationProvider>
      <AgentExperience
        agentParam={agentParam}
        returnUrl={returnUrl}
        enabledAgentSlugs={enabledAgentSlugs}
      />
    </ConversationProvider>
  );
}
