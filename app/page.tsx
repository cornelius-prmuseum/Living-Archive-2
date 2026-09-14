import { HistoricalVoiceApp } from "@/components/HistoricalVoiceApp";
import {
  getAiDialogueEnabled,
  getAiDialogueMaxTurns,
  getEnabledAgentSlugs,
  getEnabledDialogueAgentSlugs,
} from "@/lib/serverAgents";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const agentParam = typeof params.agent === "string" ? params.agent : null;
  const returnUrl = typeof params.ref === "string" ? params.ref : null;
  const enabledAgentSlugs = getEnabledAgentSlugs();
  const dialogueAgentSlugs = getEnabledDialogueAgentSlugs();
  const aiDialogueEnabled = getAiDialogueEnabled();
  const aiDialogueMaxTurns = getAiDialogueMaxTurns();

  return (
    <HistoricalVoiceApp
      agentParam={agentParam}
      returnUrl={returnUrl}
      enabledAgentSlugs={enabledAgentSlugs}
      dialogueAgentSlugs={dialogueAgentSlugs}
      aiDialogueEnabled={aiDialogueEnabled}
      aiDialogueMaxTurns={aiDialogueMaxTurns}
    />
  );
}
