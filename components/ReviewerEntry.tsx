"use client";

import { useEffect, useState } from "react";

export function ReviewerEntry() {
  const [message, setMessage] = useState("Opening reviewer access…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const key = window.location.hash.slice(1).trim();
    // Remove the key from the visible URL immediately. URL fragments are never
    // sent to the server, and this avoids leaving the review key in browser history.
    window.history.replaceState(null, "", "/review");

    if (!key) {
      setFailed(true);
      setMessage("This reviewer link is incomplete.");
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/reviewer-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
          cache: "no-store",
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to open reviewer access.");
        window.location.replace("/");
      } catch (error) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : "Unable to open reviewer access.");
      }
    })();
  }, []);

  return (
    <main className="auth-shell">
      <section className="auth-card auth-loading-card">
        <img className="auth-logo" src="/living-archives-login-logo.png" alt="Living Archives" />
        <p>{message}</p>
        {failed && <p className="auth-privacy-note">Please request a new reviewer link from the Museum of Public Relations.</p>}
      </section>
    </main>
  );
}
