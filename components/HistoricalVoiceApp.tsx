"use client";

import { useEffect, useMemo, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { AgentExperience } from "@/components/AgentExperience";
import { DialogueArena } from "@/components/DialogueArena";
import { useAuth } from "@/components/AuthGate";
import { AGENTS, type AgentSlug } from "@/lib/agents";

type AccessRole = "standard" | "educator" | "museum_staff";

type AccessProfile = {
  role: AccessRole;
  sessionSeconds: number;
  enabledAgentSlugs: AgentSlug[];
  dialogueAgentSlugs: AgentSlug[];
  historicRoundtableEnabled: boolean;
};

export function HistoricalVoiceApp({
  agentParam,
  returnUrl,
  aiDialogueMaxTurns,
}: {
  agentParam: string | null;
  returnUrl: string | null;
  aiDialogueMaxTurns: number;
}) {
  const { authFetch } = useAuth();
  const [mode, setMode] = useState<"visitor" | "dialogue">("visitor");
  const [accessProfile, setAccessProfile] = useState<AccessProfile | null>(null);
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await authFetch("/api/access-profile", { cache: "no-store" });
        const data = await response.json() as AccessProfile & { error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to load account access.");
        if (!active) return;
        setAccessProfile(data);
      } catch (error) {
        if (!active) return;
        setAccessError(error instanceof Error ? error.message : "Unable to load account access.");
      }
    })();
    return () => {
      active = false;
    };
  }, [authFetch]);

  const dialogueAvailable = Boolean(
    accessProfile?.historicRoundtableEnabled &&
    accessProfile.dialogueAgentSlugs.length >= 2,
  );

  const roleLabel = useMemo(() => {
    if (accessProfile?.role === "museum_staff") return "Museum Staff";
    if (accessProfile?.role === "educator") return "Educator";
    return null;
  }, [accessProfile?.role]);

  if (accessError) {
    return (
      <main className="experience-shell">
        <section className="museum-card access-status-card">
          <h1>Living Archives access unavailable</h1>
          <p>{accessError}</p>
        </section>
      </main>
    );
  }

  if (!accessProfile) {
    return (
      <main className="experience-shell">
        <section className="museum-card access-status-card">Loading your Living Archives access…</section>
      </main>
    );
  }

  if (mode === "dialogue" && dialogueAvailable) {
    return (
      <DialogueArena
        enabledAgentSlugs={accessProfile.dialogueAgentSlugs}
        maxTurns={aiDialogueMaxTurns}
        onExit={() => setMode("visitor")}
      />
    );
  }

  return (
    <>
      {dialogueAvailable && (
        <div className="global-mode-switch staff-roundtable-switch">
          <span>{roleLabel ?? "Living Archives"}</span>
          <button type="button" onClick={() => setMode("dialogue")}>Historic Roundtable</button>
        </div>
      )}
      <ConversationProvider>
        <AgentExperience
          agentParam={agentParam}
          returnUrl={returnUrl}
          enabledAgentSlugs={accessProfile.enabledAgentSlugs.filter((slug) => Boolean(AGENTS[slug]))}
          aiDialogueEnabled={false}
          aiDialogueMaxTurns={aiDialogueMaxTurns}
          sessionSeconds={accessProfile.sessionSeconds}
        />
      </ConversationProvider>
    </>
  );
}
