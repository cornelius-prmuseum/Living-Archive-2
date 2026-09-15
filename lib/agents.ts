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

/**
 * Suggested-question pools for the visitor conversation UI.
 *
 * Edit this file to add, remove, or rewrite questions. The interface displays
 * three at a time and rotates to a new group whenever a suggestion is clicked.
 * There is no requirement that every agent have exactly 20 questions.
 */
export const SUGGESTED_QUESTION_POOLS: Record<AgentSlug, readonly string[]> = {
  bernays: [
    "How did you persuade Americans to eat bacon and eggs?",
    "What did you mean by engineering consent?",
    "How do you view the ethics of public relations?",
    "What was the strategy behind the Torches of Freedom campaign?",
    "Why did you organize the Lucky Strike Green Ball?",
    "How did the Ivory Soap sculpture campaign work?",
    "Why did you survey physicians for the Beech-Nut bacon-and-eggs campaign?",
    "Why did you write Crystallizing Public Opinion?",
    "What is the difference between propaganda and public relations?",
    "Why did you believe research was essential to public relations?",
    "How did psychology influence your approach to persuasion?",
    "Did your uncle Sigmund Freud influence your thinking?",
    "What did you learn from public information work during World War I?",
    "How should a public relations counsel decide which clients to accept?",
    "Did you see public relations as a two-way relationship with the public?",
    "How did cigarette campaigns challenge ideas about gender in the 1920s?",
    "What was the idea behind Beer—Beverage of Moderation?",
    "How did you help change attitudes toward wristwatches?",
    "What role did public relations play in your work for Mack Trucks?",
    "What makes a public relations campaign effective?",
  ],
  "ivy-lee": [
    "Why did you issue the Declaration of Principles?",
    "How should a company communicate during a crisis?",
    "What responsibility does a company have to the press and public?",
    "Why did you believe corporations should provide information to journalists?",
    "How did your background in journalism shape your approach to publicity?",
    "What did you learn from representing the Pennsylvania Railroad?",
    "How did you handle publicity after railroad accidents?",
    "What was your role in advising the Rockefeller family?",
    "How did the Ludlow Massacre affect your approach to public relations?",
    "How did you try to change John D. Rockefeller Jr.'s public image?",
    "What is the difference between publicity and advertising?",
    "How important is truthfulness in relations with the press?",
    "Should business leaders speak directly to the public?",
    "What did you mean by giving the public prompt and accurate information?",
    "How should a corporation respond when public opinion turns against it?",
    "What obligations do companies have to their employees and communities?",
    "How should public relations influence corporate behavior, not just publicity?",
    "What makes a journalist trust a corporate source?",
    "How did you view the growing power of large corporations?",
    "Looking back, what do you consider your most important contribution to public relations?",
  ],
  lippmann: [
    "What did you mean by pictures in our heads?",
    "Why were you skeptical of public opinion?",
    "How did World War I shape your thinking about propaganda?",
    "What is a pseudo-environment?",
    "What did you mean by stereotypes in Public Opinion?",
    "Can ordinary citizens be well informed enough for democracy?",
    "Why did you write The Phantom Public?",
    "What role should experts play in democratic government?",
    "What is the difference between news and truth?",
    "Why can't newspapers simply present a complete picture of reality?",
    "How does the press shape what the public believes is important?",
    "What did you mean by the manufacture of consent?",
    "How did your views differ from John Dewey's ideas about democracy?",
    "What responsibilities do journalists have to the public?",
    "How should citizens judge information they cannot verify themselves?",
    "What did you learn from your work during the First World War?",
    "How did mass communication change American politics?",
    "Can public opinion be manipulated without people realizing it?",
    "What are the dangers of political slogans and simplified narratives?",
    "What would you want modern communicators to understand about public opinion?",
  ],
  "arthur-page": [
    "What principles should guide a company's public relations?",
    "Why should public relations have a voice in management decisions?",
    "How did your work at AT&T shape your view of corporate responsibility?",
    "What did you mean by telling the truth?",
    "Why should a company prove its claims through action?",
    "What did you mean by saying a company is judged by its character?",
    "Why is public relations a management responsibility?",
    "How should a corporation earn public trust?",
    "What should come first: good policy or good publicity?",
    "How should management listen to public opinion?",
    "What responsibilities does a large corporation owe its customers?",
    "How should employees fit into a company's communications strategy?",
    "How did AT&T explain the Bell System to the American public?",
    "How should a company communicate when it makes a mistake?",
    "Can a company have a good reputation if its behavior is poor?",
    "How should business balance private interests with the public interest?",
    "What role should public relations play during a corporate crisis?",
    "Why is long-term public confidence more important than short-term publicity?",
    "How would you distinguish your approach from Edward Bernays's?",
    "What advice would you give today's corporate communications leaders?",
  ],
};

export function getSuggestedQuestions(
  slug: AgentSlug,
  rotation: number,
  exclude?: string | null,
  count = 3,
): string[] {
  const pool = SUGGESTED_QUESTION_POOLS[slug] ?? [];
  if (pool.length <= count) return pool.filter((question) => question !== exclude).slice(0, count);

  const results: string[] = [];
  const start = Math.abs(rotation * count) % pool.length;

  for (let offset = 0; offset < pool.length && results.length < count; offset += 1) {
    const question = pool[(start + offset) % pool.length];
    if (question === exclude || results.includes(question)) continue;
    results.push(question);
  }

  return results;
}
