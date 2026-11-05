import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

type LogPayload = {
  event?: "start" | "end";
  conversationId?: string;
  startedAt?: string;
  durationSeconds?: number;
};

function asSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const webhookSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json({ error: "Google Sheets logging is not configured." }, { status: 503 });
  }

  let payload: LogPayload;
  try {
    payload = await request.json() as LogPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const event = payload.event === "end" ? "end" : payload.event === "start" ? "start" : null;
  const conversationId = asSafeString(payload.conversationId);
  const startedAt = asSafeString(payload.startedAt);
  const durationSeconds = Number(payload.durationSeconds ?? 0);

  if (!event || !conversationId || !startedAt) {
    return NextResponse.json({ error: "Missing conversation log fields." }, { status: 400 });
  }

  const firstName = asSafeString(user.user_metadata?.first_name);
  const lastName = asSafeString(user.user_metadata?.last_name);
  const email = asSafeString(user.email);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: webhookSecret,
        event,
        firstName,
        lastName,
        email,
        conversationDateTime: startedAt,
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0
          ? Math.floor(durationSeconds)
          : 0,
        conversationId,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Google Sheets webhook failed", response.status, text);
      return NextResponse.json({ error: "Unable to update the conversation log." }, { status: 502 });
    }

    const text = await response.text();
    let result: unknown = { ok: true };
    try { result = JSON.parse(text); } catch { /* Apps Script may return plain text. */ }
    if (result && typeof result === "object" && "ok" in result && (result as { ok?: unknown }).ok === false) {
      console.error("Google Sheets webhook returned an error", result);
      return NextResponse.json({ error: "Unable to update the conversation log." }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Google Sheets logging request failed", error);
    return NextResponse.json({ error: "Unable to reach the conversation log." }, { status: 502 });
  }
}
