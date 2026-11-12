import type { User } from "@supabase/supabase-js";
import type { RequestIdentity } from "@/lib/serverAuth";
import {
  AGENT_ORDER,
  PUBLIC_AGENT_ORDER,
  ROUNDTABLE_AGENT_ORDER,
  isAgentSlug,
  type AgentSlug,
} from "@/lib/agents";
import {
  getAgentIdForRole,
  getDialogueAgentIdForRole,
} from "@/lib/serverAgents";

export type AccessRole = "standard" | "educator" | "museum_staff";

export type AccessProfile = {
  role: AccessRole;
  sessionSeconds: number;
  enabledAgentSlugs: AgentSlug[];
  dialogueAgentSlugs: AgentSlug[];
  historicRoundtableEnabled: boolean;
};

function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function emailList(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(/[\n,;]/)
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

export function getAccessRole(user: User): AccessRole {
  const email = normalizeEmail(user.email);
  if (!email) return "standard";

  const staff = emailList(process.env.PRMUSEUM_MUSEUM_STAFF_EMAILS);
  if (staff.has(email)) return "museum_staff";

  const educators = emailList(process.env.PRMUSEUM_EDUCATOR_EMAILS);
  if (educators.has(email)) return "educator";

  return "standard";
}

export function getAccessRoleForIdentity(identity: RequestIdentity): AccessRole {
  return identity.kind === "reviewer" ? "standard" : getAccessRole(identity.user);
}

function parseSeconds(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 60) return fallback;
  return Math.floor(value);
}

export function getSessionSecondsForRole(role: AccessRole): number {
  const legacyDefault = parseSeconds(process.env.NEXT_PUBLIC_SESSION_SECONDS, 600);
  const standard = parseSeconds(process.env.PRMUSEUM_STANDARD_SESSION_SECONDS, legacyDefault);

  if (role === "museum_staff") {
    return parseSeconds(process.env.PRMUSEUM_MUSEUM_STAFF_SESSION_SECONDS, standard);
  }
  if (role === "educator") {
    return parseSeconds(process.env.PRMUSEUM_EDUCATOR_SESSION_SECONDS, standard);
  }
  return standard;
}

function configuredList(
  raw: string | undefined,
  fallback: readonly AgentSlug[],
  role: AccessRole,
  mode: "visitor" | "dialogue",
): AgentSlug[] {
  const requested = raw?.trim()
    ? raw.split(",").map((value) => value.trim()).filter(isAgentSlug)
    : [...fallback];

  return requested.filter((slug, index) => {
    if (requested.indexOf(slug) !== index) return false;
    return mode === "dialogue"
      ? Boolean(getDialogueAgentIdForRole(slug, role))
      : Boolean(getAgentIdForRole(slug, role));
  });
}

export function getAllowedVisitorAgentSlugs(role: AccessRole): AgentSlug[] {
  if (role === "museum_staff") {
    return configuredList(
      process.env.PRMUSEUM_MUSEUM_STAFF_ENABLED_AGENTS,
      AGENT_ORDER,
      role,
      "visitor",
    );
  }

  if (role === "educator") {
    return configuredList(
      process.env.PRMUSEUM_EDUCATOR_ENABLED_AGENTS,
      PUBLIC_AGENT_ORDER,
      role,
      "visitor",
    );
  }

  return configuredList(
    process.env.PRMUSEUM_ENABLED_AGENTS,
    PUBLIC_AGENT_ORDER,
    role,
    "visitor",
  ).filter((slug) => PUBLIC_AGENT_ORDER.includes(slug));
}

export function getAllowedDialogueAgentSlugs(role: AccessRole): AgentSlug[] {
  if (role !== "museum_staff") return [];

  return configuredList(
    process.env.PRMUSEUM_MUSEUM_STAFF_DIALOGUE_ENABLED_AGENTS,
    ROUNDTABLE_AGENT_ORDER,
    role,
    "dialogue",
  );
}

function getAccessProfileForRole(role: AccessRole): AccessProfile {
  const enabledAgentSlugs = getAllowedVisitorAgentSlugs(role);
  const dialogueAgentSlugs = getAllowedDialogueAgentSlugs(role);
  const globalRoundtable = (process.env.PRMUSEUM_AI_DIALOGUE_ENABLED || "")
    .trim()
    .toLowerCase();
  const featureEnabled = ["1", "true", "yes", "on"].includes(globalRoundtable);

  return {
    role,
    sessionSeconds: getSessionSecondsForRole(role),
    enabledAgentSlugs,
    dialogueAgentSlugs,
    historicRoundtableEnabled:
      role === "museum_staff" && featureEnabled && dialogueAgentSlugs.length >= 2,
  };
}

export function getAccessProfile(user: User): AccessProfile {
  return getAccessProfileForRole(getAccessRole(user));
}

export function getAccessProfileForIdentity(identity: RequestIdentity): AccessProfile {
  return getAccessProfileForRole(getAccessRoleForIdentity(identity));
}

export function canUserAccessAgent(user: User, slug: AgentSlug, mode: "visitor" | "dialogue") {
  const role = getAccessRole(user);
  return mode === "dialogue"
    ? getAllowedDialogueAgentSlugs(role).includes(slug)
    : getAllowedVisitorAgentSlugs(role).includes(slug);
}

export function canIdentityAccessAgent(identity: RequestIdentity, slug: AgentSlug, mode: "visitor" | "dialogue") {
  const role = getAccessRoleForIdentity(identity);
  return mode === "dialogue"
    ? getAllowedDialogueAgentSlugs(role).includes(slug)
    : getAllowedVisitorAgentSlugs(role).includes(slug);
}
