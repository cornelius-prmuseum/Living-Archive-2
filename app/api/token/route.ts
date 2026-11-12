import { NextRequest, NextResponse } from "next/server";
import { isAgentSlug } from "@/lib/agents";
import { getRequestIdentity } from "@/lib/serverAuth";
import { canIdentityAccessAgent, getAccessRoleForIdentity } from "@/lib/accessControl";
import {
  getAgentIdForRole,
  getDialogueAgentIdForRole,
} from "@/lib/serverAgents";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const requestedAgent = request.nextUrl.searchParams.get("agent");
  const mode = request.nextUrl.searchParams.get("mode") === "dialogue" ? "dialogue" : "visitor";

  if (!isAgentSlug(requestedAgent)) {
    return NextResponse.json({ error: "Unknown historical figure." }, { status: 400 });
  }

  if (!canIdentityAccessAgent(identity, requestedAgent, mode)) {
    return NextResponse.json({ error: "That historical figure is not available for this account." }, { status: 403 });
  }

  const role = getAccessRoleForIdentity(identity);
  const agentId = mode === "dialogue"
    ? getDialogueAgentIdForRole(requestedAgent, role)
    : getAgentIdForRole(requestedAgent, role);

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: "The voice agent has not been configured on the server." },
      { status: 503 },
    );
  }

  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/token");
  url.searchParams.set("agent_id", agentId);

  try {
    const elevenLabsResponse = await fetch(url, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    });

    if (!elevenLabsResponse.ok) {
      const body = await elevenLabsResponse.text();
      console.error("ElevenLabs token request failed", mode, requestedAgent, elevenLabsResponse.status, body);
      return NextResponse.json({ error: "Unable to start the voice conversation." }, { status: 502 });
    }

    const data = await elevenLabsResponse.json() as { token: string; conversation_id?: string };
    return NextResponse.json(
      { token: data.token, conversationId: data.conversation_id ?? null },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("ElevenLabs token request error", error);
    return NextResponse.json({ error: "Unable to reach the voice service." }, { status: 502 });
  }
}
