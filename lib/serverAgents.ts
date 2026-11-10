import {
  AGENT_ORDER,
  PUBLIC_AGENT_ORDER,
  ROUNDTABLE_AGENT_ORDER,
  isAgentSlug,
  type AgentSlug,
} from "@/lib/agents";
import type { AccessRole } from "@/lib/accessControl";

function standardVisitorIds(): Record<AgentSlug, string | undefined> {
  return {
    bernays: process.env.ELEVENLABS_AGENT_BERNAYS,
    "ivy-lee": process.env.ELEVENLABS_AGENT_IVY_LEE,
    lippmann: process.env.ELEVENLABS_AGENT_LIPPMANN,
    "arthur-page": process.env.ELEVENLABS_AGENT_ARTHUR_PAGE,
    "inez-kaiser": process.env.ELEVENLABS_AGENT_INEZ_KAISER,
    "marilyn-laurie": process.env.ELEVENLABS_AGENT_MARILYN_LAURIE,
    "doris-fleischman": process.env.ELEVENLABS_AGENT_DORIS_FLEISCHMAN,
    "museum-docent": process.env.ELEVENLABS_AGENT_MUSEUM_DOCENT,
  };
}

function staffVisitorIds(): Record<AgentSlug, string | undefined> {
  const fallback = standardVisitorIds();
  return {
    bernays: process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_BERNAYS || fallback.bernays,
    "ivy-lee": process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_IVY_LEE || fallback["ivy-lee"],
    lippmann: process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_LIPPMANN || fallback.lippmann,
    "arthur-page": process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_ARTHUR_PAGE || fallback["arthur-page"],
    "inez-kaiser": process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_INEZ_KAISER || fallback["inez-kaiser"],
    "marilyn-laurie": process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_MARILYN_LAURIE || fallback["marilyn-laurie"],
    "doris-fleischman": process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_DORIS_FLEISCHMAN || fallback["doris-fleischman"],
    "museum-docent": process.env.ELEVENLABS_MUSEUM_STAFF_AGENT_MUSEUM_DOCENT || fallback["museum-docent"],
  };
}

function standardDialogueIds(): Record<AgentSlug, string | undefined> {
  return {
    bernays: process.env.ELEVENLABS_DIALOGUE_AGENT_BERNAYS,
    "ivy-lee": process.env.ELEVENLABS_DIALOGUE_AGENT_IVY_LEE,
    lippmann: process.env.ELEVENLABS_DIALOGUE_AGENT_LIPPMANN,
    "arthur-page": process.env.ELEVENLABS_DIALOGUE_AGENT_ARTHUR_PAGE,
    "inez-kaiser": process.env.ELEVENLABS_DIALOGUE_AGENT_INEZ_KAISER,
    "marilyn-laurie": process.env.ELEVENLABS_DIALOGUE_AGENT_MARILYN_LAURIE,
    "doris-fleischman": process.env.ELEVENLABS_DIALOGUE_AGENT_DORIS_FLEISCHMAN,
    "museum-docent": undefined,
  };
}

function staffDialogueIds(): Record<AgentSlug, string | undefined> {
  const fallback = standardDialogueIds();
  return {
    bernays: process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_BERNAYS || fallback.bernays,
    "ivy-lee": process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_IVY_LEE || fallback["ivy-lee"],
    lippmann: process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_LIPPMANN || fallback.lippmann,
    "arthur-page": process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_ARTHUR_PAGE || fallback["arthur-page"],
    "inez-kaiser": process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_INEZ_KAISER || fallback["inez-kaiser"],
    "marilyn-laurie": process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_MARILYN_LAURIE || fallback["marilyn-laurie"],
    "doris-fleischman": process.env.ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_DORIS_FLEISCHMAN || fallback["doris-fleischman"],
    "museum-docent": undefined,
  };
}

export function getAgentId(slug: AgentSlug): string | undefined {
  return standardVisitorIds()[slug]?.trim() || undefined;
}

export function getAgentIdForRole(slug: AgentSlug, role: AccessRole): string | undefined {
  const ids = role === "museum_staff" ? staffVisitorIds() : standardVisitorIds();
  return ids[slug]?.trim() || undefined;
}

export function getDialogueAgentId(slug: AgentSlug): string | undefined {
  return standardDialogueIds()[slug]?.trim() || undefined;
}

export function getDialogueAgentIdForRole(slug: AgentSlug, role: AccessRole): string | undefined {
  if (role !== "museum_staff") return undefined;
  return staffDialogueIds()[slug]?.trim() || undefined;
}

function uniqueConfiguredList(
  raw: string | undefined,
  fallback: readonly AgentSlug[],
  hasId: (slug: AgentSlug) => boolean,
): AgentSlug[] {
  const configured = raw?.trim();
  const requested = configured
    ? configured.split(",").map((value) => value.trim()).filter(isAgentSlug)
    : [...fallback];
  return requested.filter((slug, index) => requested.indexOf(slug) === index && hasId(slug));
}

/** Standard/public configured agents. Staff-only agents are never added here by default. */
export function getEnabledAgentSlugs(): AgentSlug[] {
  return uniqueConfiguredList(
    process.env.PRMUSEUM_ENABLED_AGENTS,
    PUBLIC_AGENT_ORDER,
    (slug) => Boolean(getAgentId(slug)),
  ).filter((slug) => PUBLIC_AGENT_ORDER.includes(slug));
}

export function getAllConfiguredAgentSlugs(role: AccessRole = "museum_staff"): AgentSlug[] {
  return AGENT_ORDER.filter((slug) => Boolean(getAgentIdForRole(slug, role)));
}

export function getEnabledDialogueAgentSlugs(): AgentSlug[] {
  return uniqueConfiguredList(
    process.env.PRMUSEUM_DIALOGUE_ENABLED_AGENTS,
    ROUNDTABLE_AGENT_ORDER,
    (slug) => Boolean(getDialogueAgentId(slug)),
  );
}

export function getAllConfiguredDialogueAgentSlugs(role: AccessRole = "museum_staff"): AgentSlug[] {
  return ROUNDTABLE_AGENT_ORDER.filter((slug) => Boolean(getDialogueAgentIdForRole(slug, role)));
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
    const ids = [getAgentId(slug), getAgentIdForRole(slug, "museum_staff")].filter(Boolean);
    if (ids.includes(normalized)) return slug;
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
