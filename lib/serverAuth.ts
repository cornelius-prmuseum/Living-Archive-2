import { createClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { isReviewerRequest } from "@/lib/reviewerAccess";

export type RequestIdentity =
  | { kind: "user"; user: User }
  | { kind: "reviewer" };

export async function getAuthenticatedUser(request: NextRequest): Promise<User | null> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice(7).trim();
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;

  const supabase = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function getRequestIdentity(request: NextRequest): Promise<RequestIdentity | null> {
  const user = await getAuthenticatedUser(request);
  if (user) return { kind: "user", user };
  if (isReviewerRequest(request)) return { kind: "reviewer" };
  return null;
}
