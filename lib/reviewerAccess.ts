import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const REVIEWER_COOKIE_NAME = "prmuseum_reviewer";
const REVIEWER_COOKIE_PAYLOAD = "prmuseum-living-archives-reviewer";
const DEFAULT_REVIEWER_SESSION_HOURS = 12;

function reviewerKey() {
  return (process.env.PRMUSEUM_REVIEWER_ACCESS_KEY || "").trim();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function reviewerAccessConfigured() {
  return reviewerKey().length >= 24;
}

export function validateReviewerAccessKey(candidate: string) {
  const expected = reviewerKey();
  if (!expected || expected.length < 24) return false;
  return safeEqual(candidate.trim(), expected);
}

export function createReviewerCookieValue() {
  const key = reviewerKey();
  if (!key) return "";
  return createHmac("sha256", key).update(REVIEWER_COOKIE_PAYLOAD).digest("hex");
}

export function isReviewerRequest(request: NextRequest) {
  if (!reviewerAccessConfigured()) return false;
  const received = request.cookies.get(REVIEWER_COOKIE_NAME)?.value || "";
  const expected = createReviewerCookieValue();
  if (!received || !expected) return false;
  return safeEqual(received, expected);
}

export function getReviewerCookieMaxAgeSeconds() {
  const rawHours = Number(process.env.PRMUSEUM_REVIEWER_SESSION_HOURS ?? DEFAULT_REVIEWER_SESSION_HOURS);
  const hours = Number.isFinite(rawHours)
    ? Math.min(168, Math.max(1, Math.floor(rawHours)))
    : DEFAULT_REVIEWER_SESSION_HOURS;
  return hours * 60 * 60;
}
