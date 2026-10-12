"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/user-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error ?? "Could not sign in.");
        return;
      }
      window.location.replace("/materials");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f3f5f3", fontFamily: "system-ui,sans-serif", color: "#1b2430" }}>
    <section style={{ width: "min(400px,100%)", background: "white", border: "1px solid #d9e0dc", borderRadius: 12, padding: 28, boxShadow: "0 16px 40px #1b243014" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>Wooden BOM Builder</h1>
      <p style={{ color: "#66757f", margin: "0 0 24px" }}>Sign in to work on your kitchen costings.</p>
      <form onSubmit={signIn} style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>Username<input autoComplete="username" value={user} onChange={event => setUser(event.target.value)} required style={{ padding: 11, border: "1px solid #becbc4", borderRadius: 6, font: "inherit" }} /></label>
        <label style={{ display: "grid", gap: 6 }}>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required style={{ padding: 11, border: "1px solid #becbc4", borderRadius: 6, font: "inherit" }} /></label>
        {error && <p role="alert" style={{ color: "#a4412e", margin: 0 }}>{error}</p>}
        <button disabled={busy} style={{ padding: 12, border: 0, borderRadius: 6, background: "#15645a", color: "white", font: "inherit", fontWeight: 650, cursor: "pointer" }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  </main>;
}
