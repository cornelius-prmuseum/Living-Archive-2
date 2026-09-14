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

export function getEnabledAgentSlugs(): AgentSlug[] {
  const configured = process.env.PRMUSEUM_ENABLED_AGENTS?.trim();

  const requested = configured
    ? configured
        .split(",")
        .map((value) => value.trim())
        .filter(isAgentSlug)
    : AGENT_ORDER;

  // An agent must be both enabled and configured with an ElevenLabs Agent ID.
  return requested.filter((slug, index) => requested.indexOf(slug) === index && Boolean(getAgentId(slug)));
}

export function isAgentEnabled(slug: AgentSlug): boolean {
  return getEnabledAgentSlugs().includes(slug);
}

export function getAgentSlugById(agentId: string): AgentSlug | null {
  const normalized = agentId.trim();
  if (!normalized) return null;

  for (const slug of AGENT_ORDER) {
    if (getAgentId(slug) === normalized) return slug;
  }

  return null;
}
