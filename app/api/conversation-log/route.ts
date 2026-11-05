import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

type LogPayload = {
  event?: "start" | "update" | "end";
  conversationId?: string;
  startedAt?: string;
  durationSeconds?: number;
  personalities?: string[];
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

  const event = payload.event === "end"
    ? "end"
    : payload.event === "update"
      ? "update"
      : payload.event === "start"
        ? "start"
        : null;
  const conversationId = asSafeString(payload.conversationId);
  const startedAt = asSafeString(payload.startedAt);
  const durationSeconds = Number(payload.durationSeconds ?? 0);
  const personalities = Array.isArray(payload.personalities)
    ? payload.personalities.map(asSafeString).filter(Boolean).slice(0, 20)
    : [];

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
        personalities,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Google Sheets webhook failed", response.status, text);
      return NextResponse.json({ error: "Unable to update the conversation log." }, { status: 502 });
    }

    const text = await response.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, " ").slice(0, 300);
      console.error(
        "Google Sheets webhook did not return JSON. This usually means the Apps Script deployment is not public, the URL is not the deployed /exec URL, or Google redirected to an access/sign-in page.",
        { status: response.status, contentType: response.headers.get("content-type"), preview },
      );
      return NextResponse.json(
        {
          error: "Google Sheets webhook returned an unexpected response. Check the Apps Script deployment access and /exec URL.",
          diagnostic: preview.startsWith("<") ? "html_response" : "non_json_response",
        },
        { status: 502 },
      );
    }

    if (!result || typeof result !== "object" || !("ok" in result)) {
      console.error("Google Sheets webhook returned JSON without an ok field", result);
      return NextResponse.json({ error: "Google Sheets webhook returned an invalid response." }, { status: 502 });
    }

    if ((result as { ok?: unknown }).ok !== true) {
      console.error("Google Sheets webhook returned an error", result);
      const detail = "error" in result && typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : "Unknown Apps Script error.";
      return NextResponse.json({ error: "Unable to update the conversation log.", detail }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Google Sheets logging request failed", error);
    return NextResponse.json({ error: "Unable to reach the conversation log." }, { status: 502 });
  }
}
