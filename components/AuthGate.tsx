"use client";

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  isReviewer: boolean;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthGate.");
  return value;
}

type AuthMode = "login" | "signup";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [reviewer, setReviewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configurationError, setConfigurationError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        try {
          // Reviewer links can use the existing home route so they do not depend
          // on a separate /review page making it into the deployment.
          // Preferred format: https://living-archives.vercel.app/#review=<key>
          const hash = window.location.hash.slice(1).trim();
          let reviewerKey = "";
          if (hash.startsWith("review=")) {
            reviewerKey = decodeURIComponent(hash.slice("review=".length));
          } else if (hash.startsWith("reviewer=")) {
            reviewerKey = decodeURIComponent(hash.slice("reviewer=".length));
          }

          if (reviewerKey) {
            // Remove the secret from the visible URL/history before sending it to
            // our same-origin API endpoint.
            window.history.replaceState(null, "", "/");
            const establishResponse = await fetch("/api/reviewer-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: reviewerKey }),
              cache: "no-store",
              credentials: "same-origin",
            });
            const establishData = await establishResponse.json().catch(() => ({})) as { error?: string };
            if (!establishResponse.ok) {
              throw new Error(establishData.error || "Unable to open reviewer access.");
            }
            if (!active) return;
            setReviewer(true);
            setLoading(false);
            return;
          }

          const reviewerResponse = await fetch("/api/reviewer-session", { cache: "no-store" });
          if (reviewerResponse.ok) {
            const reviewerData = await reviewerResponse.json() as { reviewer?: boolean };
            if (!active) return;
            if (reviewerData.reviewer) {
              setReviewer(true);
              setLoading(false);
              return;
            }
          }
        } catch (reviewerError) {
          console.warn("Unable to establish/check reviewer session; continuing with normal login.", reviewerError);
        }

        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        setLoading(false);

        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
          setLoading(false);
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      } catch (authError) {
        if (!active) return;
        setConfigurationError(authError instanceof Error ? authError.message : "Authentication is not configured.");
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const resetMessages = () => {
    setError("");
    setNotice("");
  };

  const switchMode = (nextMode: AuthMode) => {
    resetMessages();
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (mode === "signup") {
      if (!firstName.trim() || !lastName.trim()) {
        setError("Please enter your first and last name.");
        return;
      }
      if (password.length < 8) {
        setError("Please create a password with at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              marketing_opt_in: marketingOptIn,
            },
            emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
        if (signUpError) throw signUpError;

        if (!data.session) {
          setNotice("Your account was created. Please check your email to confirm your address, then return here to log in.");
          setMode("login");
          setPassword("");
          setConfirmPassword("");
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to complete authentication.");
    } finally {
      setSubmitting(false);
    }
  };

  const authValue = useMemo<AuthContextValue | null>(() => {
    if (reviewer) {
      const authFetch: AuthContextValue["authFetch"] = (input, init = {}) =>
        fetch(input, { ...init, credentials: "same-origin" });

      return {
        session: null,
        user: null,
        accessToken: null,
        isReviewer: true,
        authFetch,
        signOut: async () => {
          await fetch("/api/reviewer-session", { method: "DELETE", cache: "no-store" });
          window.location.replace("/");
        },
      };
    }

    if (!session?.user || !session.access_token) return null;

    const authFetch: AuthContextValue["authFetch"] = (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${session.access_token}`);
      return fetch(input, { ...init, headers, credentials: "same-origin" });
    };

    return {
      session,
      user: session.user,
      accessToken: session.access_token,
      isReviewer: false,
      authFetch,
      signOut: async () => {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      },
    };
  }, [reviewer, session]);

  if (loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-loading-card">Loading Living Archives…</section>
      </main>
    );
  }

  if (configurationError) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Living Archives authentication is not configured</h1>
          <p>{configurationError}</p>
        </section>
      </main>
    );
  }

  if (!authValue) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <img
            className="auth-logo"
            src="/living-archives-login-logo.png"
            alt="Living Archives"
          />

          <header className="auth-intro">
            <h1>Begin your conversation with the Living Archives™</h1>
            <p>
              The Living Archives™ is a new interactive AI experience from the Museum of Public Relations,
              based on the ideas and writings of notable individuals who shaped the field of public relations.
            </p>
            <p>Please enter your login or sign-up below to begin.</p>
          </header>

          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => switchMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              Sign up
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div className="auth-name-grid">
                <label>
                  <span>First name</span>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </label>
                <label>
                  <span>Last name</span>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </label>
              </div>
            )}

            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label>
              <span>{mode === "signup" ? "Create password" : "Password"}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={mode === "signup" ? 8 : undefined}
                required
              />
            </label>

            {mode === "signup" && (
              <>
                <label>
                  <span>Confirm password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>

                <label className="auth-checkbox-row">
                  <input
                    type="checkbox"
                    checked={marketingOptIn}
                    onChange={(event) => setMarketingOptIn(event.target.checked)}
                  />
                  <span>Yes, I'd like occasional updates about future PRMuseum interactive experiences.</span>
                </label>
              </>
            )}

            {error && <p className="auth-message auth-error" role="alert">{error}</p>}
            {notice && <p className="auth-message auth-notice">{notice}</p>}

            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          <p className="auth-privacy-note">
            Conversations may be stored to improve the experience. We will never sell your information.
          </p>
        </section>
      </main>
    );
  }

  return (
    <AuthContext.Provider value={authValue}>
      <div className="authenticated-app-shell">
        <button className="auth-signout" type="button" onClick={() => void authValue.signOut()}>
          {authValue.isReviewer ? "Exit reviewer" : "Sign out"}
        </button>
        {children}
      </div>
    </AuthContext.Provider>
  );
}
