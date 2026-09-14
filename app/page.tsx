import { HistoricalVoiceApp } from "@/components/HistoricalVoiceApp";
import { getEnabledAgentSlugs } from "@/lib/serverAgents";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const agentParam = typeof params.agent === "string" ? params.agent : null;
  const returnUrl = typeof params.ref === "string" ? params.ref : null;
  const enabledAgentSlugs = getEnabledAgentSlugs();

  return (
    <HistoricalVoiceApp
      agentParam={agentParam}
      returnUrl={returnUrl}
      enabledAgentSlugs={enabledAgentSlugs}
    />
  );
}
