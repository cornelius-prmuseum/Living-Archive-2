import { NextRequest, NextResponse } from "next/server";
import { getAgentSlugById, isAgentEnabled } from "@/lib/serverAgents";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent_id")?.trim() || "";
  const slug = getAgentSlugById(agentId);

  if (!slug || !isAgentEnabled(slug)) {
    return NextResponse.json({ error: "Unknown or disabled agent." }, { status: 404 });
  }

  return NextResponse.json(
    { slug },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
