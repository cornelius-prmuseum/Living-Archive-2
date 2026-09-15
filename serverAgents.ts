import { AGENT_ORDER, isAgentSlug, type AgentSlug } from "@/lib/agents";

export function getAgentId(slug: AgentSlug): string | undefined {
  const ids: Record<AgentSlug, string | undefined> = {
    bernays: process.env.ELEVENLABS_AGENT_BERNAYS,
    "ivy-lee": process.env.ELEVENLABS_AGENT_IVY_LEE,
    lippmann: process.env.ELEVENLABS_AGENT_LIPPMANN,
    "arthur-page": process.env.ELEVENLABS_AGENT_ARTHUR_PAGE,
  };
  return ids[slug]?.trim() || undefined;
}

export function getDialogueAgentId(slug: AgentSlug): string | undefined {
  const ids: Record<AgentSlug, string | undefined> = {
    bernays: process.env.ELEVENLABS_DIALOGUE_AGENT_BERNAYS,
    "ivy-lee": process.env.ELEVENLABS_DIALOGUE_AGENT_IVY_LEE,
    lippmann: process.env.ELEVENLABS_DIALOGUE_AGENT_LIPPMANN,
    "arthur-page": process.env.ELEVENLABS_DIALOGUE_AGENT_ARTHUR_PAGE,
  };
  return ids[slug]?.trim() || undefined;
}

function uniqueConfiguredList(raw: string | undefined, hasId: (slug: AgentSlug) => boolean): AgentSlug[] {
  const configured = raw?.trim();
  const requested = configured
    ? configured.split(",").map((value) => value.trim()).filter(isAgentSlug)
    : AGENT_ORDER;
  return requested.filter((slug, index) => requested.indexOf(slug) === index && hasId(slug));
}

export function getEnabledAgentSlugs(): AgentSlug[] {
  return uniqueConfiguredList(process.env.PRMUSEUM_ENABLED_AGENTS, (slug) => Boolean(getAgentId(slug)));
}

export function getEnabledDialogueAgentSlugs(): AgentSlug[] {
  return uniqueConfiguredList(process.env.PRMUSEUM_DIALOGUE_ENABLED_AGENTS, (slug) => Boolean(getDialogueAgentId(slug)));
}

export function isAgentEnabled(slug: AgentSlug): boolean {
  return getEnabledAgentSlugs().includes(slug);
}

export function isDialogueAgentEnabled(slug: AgentSlug): boolean {
  return getEnabledDialogueAgentSlugs().includes(slug);
}

export function getAgentSlugById(agentId: string): AgentSlug | null {
  const normalized = agentId.trim();
  if (!normalized) return null;
  for (const slug of AGENT_ORDER) {
    if (getAgentId(slug) === normalized) return slug;
  }
  return null;
}

export function getAiDialogueEnabled(): boolean {
  const value = process.env.PRMUSEUM_AI_DIALOGUE_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function getAiDialogueMaxTurns(): number {
  const raw = Number(process.env.PRMUSEUM_AI_DIALOGUE_MAX_TURNS ?? 6);
  if (!Number.isFinite(raw)) return 6;
  return Math.min(12, Math.max(2, Math.floor(raw)));
}
