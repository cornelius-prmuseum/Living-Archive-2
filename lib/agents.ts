export type AgentSlug = "bernays" | "ivy-lee" | "lippmann";

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
};

export const AGENT_ORDER: AgentSlug[] = ["bernays", "ivy-lee", "lippmann"];

export function isAgentSlug(value: string | null | undefined): value is AgentSlug {
  return value === "bernays" || value === "ivy-lee" || value === "lippmann";
}

export function getPublicAgent(value: string | null): PublicAgent {
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_AGENT || "bernays";
  const slug = isAgentSlug(value)
    ? value
    : isAgentSlug(fallback)
      ? fallback
      : "bernays";

  return AGENTS[slug];
}
