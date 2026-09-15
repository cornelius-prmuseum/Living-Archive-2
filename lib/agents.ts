export type AgentSlug = "bernays" | "ivy-lee" | "lippmann" | "arthur-page";

export type PublicAgent = {
  slug: AgentSlug;
  name: string;
  shortName: string;
  years: string;
  subtitle: string;
  portrait: string;
  intro: string;
};

export const AGENTS: Record<AgentSlug, PublicAgent> = {
  bernays: {
    slug: "bernays",
    name: "Edward Bernays",
    shortName: "Bernays",
    years: "1891–1995",
    subtitle: "Pioneer of Public Relations",
    portrait: "/portraits/bernays.svg",
    intro:
      "Speak with a historically informed interpretation of Edward Bernays about public relations, persuasion, campaigns, and the profession he helped shape.",
  },
  "ivy-lee": {
    slug: "ivy-lee",
    name: "Ivy Lee",
    shortName: "Lee",
    years: "1877–1934",
    subtitle: "Early Public Relations Counselor",
    portrait: "/portraits/ivy-lee.svg",
    intro:
      "Speak with a historically informed interpretation of Ivy Lee about publicity, corporate communication, journalism, and the early development of public relations.",
  },
  lippmann: {
    slug: "lippmann",
    name: "Walter Lippmann",
    shortName: "Lippmann",
    years: "1889–1974",
    subtitle: "Journalist and Political Commentator",
    portrait: "/portraits/lippmann.svg",
    intro:
      "Speak with a historically informed interpretation of Walter Lippmann about public opinion, journalism, democracy, propaganda, and mass communication.",
  },
  "arthur-page": {
    slug: "arthur-page",
    name: "Arthur W. Page",
    shortName: "Page",
    years: "1883–1960",
    subtitle: "Corporate Public Relations Pioneer",
    portrait: "/portraits/arthur-page.svg",
    intro:
      "Speak with a historically informed interpretation of Arthur W. Page about corporate character, management responsibility, public trust, and the development of modern corporate public relations.",
  },
};

export const AGENT_ORDER: AgentSlug[] = ["bernays", "ivy-lee", "lippmann", "arthur-page"];

export function isAgentSlug(value: string | null | undefined): value is AgentSlug {
  return value === "bernays" || value === "ivy-lee" || value === "lippmann" || value === "arthur-page";
}

export function getPublicAgent(value: string | null, enabledSlugs: readonly AgentSlug[] = AGENT_ORDER): PublicAgent {
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_AGENT || "bernays";
  const firstEnabled = enabledSlugs[0] ?? "bernays";

  const requested = isAgentSlug(value) && enabledSlugs.includes(value) ? value : null;
  const configuredFallback = isAgentSlug(fallback) && enabledSlugs.includes(fallback) ? fallback : null;
  const slug = requested ?? configuredFallback ?? firstEnabled;

  return AGENTS[slug];
}
