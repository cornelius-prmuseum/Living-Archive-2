import { NextRequest, NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/serverAuth";
import { getAccessProfileForIdentity } from "@/lib/accessControl";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.json(getAccessProfileForIdentity(identity), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
