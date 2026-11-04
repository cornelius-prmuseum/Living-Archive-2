"use client";

import { useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { AgentExperience } from "@/components/AgentExperience";
import { DialogueArena } from "@/components/DialogueArena";
import type { AgentSlug } from "@/lib/agents";

export function HistoricalVoiceApp({
  agentParam,
  returnUrl,
  enabledAgentSlugs,
  dialogueAgentSlugs,
  aiDialogueEnabled,
  aiDialogueMaxTurns,
}: {
  agentParam: string | null;
  returnUrl: string | null;
  enabledAgentSlugs: AgentSlug[];
  dialogueAgentSlugs: AgentSlug[];
  aiDialogueEnabled: boolean;
  aiDialogueMaxTurns: number;
}) {
  const [mode, setMode] = useState<"visitor" | "dialogue">("visitor");
  const dialogueAvailable = aiDialogueEnabled && dialogueAgentSlugs.length >= 2;

  if (mode === "dialogue" && dialogueAvailable) {
    return (
      <DialogueArena
        enabledAgentSlugs={dialogueAgentSlugs}
        maxTurns={aiDialogueMaxTurns}
        onExit={() => setMode("visitor")}
      />
    );
  }

  return (
    <>
      {dialogueAvailable && (
        <div className="global-mode-switch">
          <span>Living Archives</span>
          <button type="button" onClick={() => setMode("dialogue")}>Open AI Discussion</button>
        </div>
      )}
      <ConversationProvider>
        <AgentExperience
          agentParam={agentParam}
          returnUrl={returnUrl}
          enabledAgentSlugs={enabledAgentSlugs}
          aiDialogueEnabled={false}
          aiDialogueMaxTurns={aiDialogueMaxTurns}
        />
      </ConversationProvider>
    </>
  );
}
