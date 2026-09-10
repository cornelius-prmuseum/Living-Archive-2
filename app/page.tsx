import { HistoricalVoiceApp } from "@/components/HistoricalVoiceApp";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const agentParam = typeof params.agent === "string" ? params.agent : null;
  const returnUrl = typeof params.ref === "string" ? params.ref : null;

  return <HistoricalVoiceApp agentParam={agentParam} returnUrl={returnUrl} />;
}
