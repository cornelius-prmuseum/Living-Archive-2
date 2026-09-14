import { NextRequest, NextResponse } from "next/server";
import { isAgentSlug } from "@/lib/agents";
import {
  getAgentId,
  getAgentSlugById,
  isAgentEnabled,
} from "@/lib/serverAgents";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

/**
 * ElevenLabs has represented transfer_to_agent configuration in a few nested
 * shapes over time. Search the returned agent config for the transfers array
 * belonging to that system tool rather than coupling the app to one exact path.
 */
function findTransferRules(value: unknown, seen = new Set<object>()): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value as object)) return null;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTransferRules(item, seen);
      if (found) return found;
    }
    return null;
  }

  const record = value as UnknownRecord;
  const params = asRecord(record.params);
  const name = typeof record.name === "string" ? record.name : "";
  const systemToolType = typeof record.system_tool_type === "string"
    ? record.system_tool_type
    : typeof params?.system_tool_type === "string"
      ? params.system_tool_type
      : "";

  const directTransfers = Array.isArray(record.transfers) ? record.transfers : null;
  const paramTransfers = Array.isArray(params?.transfers) ? params?.transfers as unknown[] : null;

  if (
    name === "transfer_to_agent" ||
    systemToolType === "transfer_to_agent" ||
    Object.prototype.hasOwnProperty.call(record, "transfer_to_agent")
  ) {
    if (directTransfers) return directTransfers;
    if (paramTransfers) return paramTransfers;
  }

  // A common shape is built_in_tools: { transfer_to_agent: { params: ... } }.
  const namedTool = asRecord(record.transfer_to_agent);
  if (namedTool) {
    const namedParams = asRecord(namedTool.params);
    if (Array.isArray(namedTool.transfers)) return namedTool.transfers;
    if (Array.isArray(namedParams?.transfers)) return namedParams?.transfers as unknown[];
  }

  for (const child of Object.values(record)) {
    const found = findTransferRules(child, seen);
    if (found) return found;
  }

  return null;
}

function getTargetAgentId(rule: unknown): string | null {
  const record = asRecord(rule);
  if (!record) return null;

  if (typeof record.agent_id === "string" && record.agent_id.trim()) {
    return record.agent_id.trim();
  }

  const destination = asRecord(record.transfer_destination);
  if (typeof destination?.agent_id === "string" && destination.agent_id.trim()) {
    return destination.agent_id.trim();
  }

  return null;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const source = request.nextUrl.searchParams.get("source");
  const agentNumberRaw = request.nextUrl.searchParams.get("agent_number") ?? "";
  const agentNumber = Number(agentNumberRaw);

  if (!isAgentSlug(source) || !isAgentEnabled(source)) {
    return NextResponse.json({ error: "Unknown or disabled source agent." }, { status: 400 });
  }

  if (!Number.isInteger(agentNumber) || agentNumber < 0) {
    return NextResponse.json({ error: "Invalid transfer destination number." }, { status: 400 });
  }

  const sourceAgentId = getAgentId(source);
  if (!apiKey || !sourceAgentId) {
    return NextResponse.json({ error: "Agent configuration is unavailable." }, { status: 503 });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(sourceAgentId)}`,
      {
        headers: { "xi-api-key": apiKey },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.error("ElevenLabs agent config request failed", response.status, body);
      return NextResponse.json(
        { error: "Unable to read the active agent's transfer configuration." },
        { status: 502 },
      );
    }

    const config = await response.json() as unknown;
    const transfers = findTransferRules(config);
    const rule = transfers?.[agentNumber];
    const targetAgentId = getTargetAgentId(rule);
    const slug = targetAgentId ? getAgentSlugById(targetAgentId) : null;

    if (!slug || !isAgentEnabled(slug)) {
      return NextResponse.json(
        { error: "The transfer destination is not mapped to an enabled PRMuseum agent." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { slug },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to resolve ElevenLabs transfer", error);
    return NextResponse.json({ error: "Unable to resolve the transfer destination." }, { status: 502 });
  }
}
