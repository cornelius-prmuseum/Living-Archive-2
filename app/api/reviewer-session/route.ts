import { NextRequest, NextResponse } from "next/server";
import {
  REVIEWER_COOKIE_NAME,
  createReviewerCookieValue,
  getReviewerCookieMaxAgeSeconds,
  isReviewerRequest,
  reviewerAccessConfigured,
  validateReviewerAccessKey,
} from "@/lib/reviewerAccess";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      reviewer: isReviewerRequest(request),
      configured: reviewerAccessConfigured(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest) {
  if (!reviewerAccessConfigured()) {
    return NextResponse.json({ error: "Reviewer access is not configured." }, { status: 503 });
  }

  let key = "";
  try {
    const body = await request.json() as { key?: unknown };
    key = typeof body.key === "string" ? body.key : "";
  } catch {
    return NextResponse.json({ error: "Invalid reviewer request." }, { status: 400 });
  }

  if (!validateReviewerAccessKey(key)) {
    return NextResponse.json({ error: "Invalid reviewer link." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, reviewer: true });
  response.cookies.set(REVIEWER_COOKIE_NAME, createReviewerCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: getReviewerCookieMaxAgeSeconds(),
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(REVIEWER_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
