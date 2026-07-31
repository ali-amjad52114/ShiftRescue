"use client";

import { useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not sign in");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next;
    } catch {
      setError("Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page-narrow">
      <section className="card">
        <div className="card-head">
          <h1 className="card-title">Sign in</h1>
        </div>
        <p className="empty">Managing staff and shifts needs the team password.</p>
        <form onSubmit={submit} className="form">
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {error && <p className="notice">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || password === ""}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
