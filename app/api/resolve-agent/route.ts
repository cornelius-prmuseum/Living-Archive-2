import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/serverAuth";
import { getAgentSlugById, isAgentEnabled } from "@/lib/serverAgents";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
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
