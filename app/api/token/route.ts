import { NextRequest, NextResponse } from "next/server";
import { isAgentSlug, type AgentSlug } from "@/lib/agents";

export const dynamic = "force-dynamic";

function getAgentId(slug: AgentSlug): string | undefined {
  const ids: Record<AgentSlug, string | undefined> = {
    bernays: process.env.ELEVENLABS_AGENT_BERNAYS,
    "ivy-lee": process.env.ELEVENLABS_AGENT_IVY_LEE,
    lippmann: process.env.ELEVENLABS_AGENT_LIPPMANN,
  };

  return ids[slug];
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const requestedAgent = request.nextUrl.searchParams.get("agent");

  if (!isAgentSlug(requestedAgent)) {
    return NextResponse.json({ error: "Unknown historical figure." }, { status: 400 });
  }

  const agentId = getAgentId(requestedAgent);

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
      headers: {
        "xi-api-key": apiKey,
      },
      cache: "no-store",
    });

    if (!elevenLabsResponse.ok) {
      const body = await elevenLabsResponse.text();
      console.error("ElevenLabs token request failed", elevenLabsResponse.status, body);
      return NextResponse.json(
        { error: "Unable to start the voice conversation." },
        { status: 502 },
      );
    }

    const data = (await elevenLabsResponse.json()) as {
      token: string;
      conversation_id?: string;
    };

    return NextResponse.json(
      {
        token: data.token,
        conversationId: data.conversation_id ?? null,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("ElevenLabs token request error", error);
    return NextResponse.json(
      { error: "Unable to reach the voice service." },
      { status: 502 },
    );
  }
}
