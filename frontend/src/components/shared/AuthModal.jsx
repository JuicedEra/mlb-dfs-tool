import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";

export default function AuthModal({ onClose, mode: initialMode = "login" }) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuth();
  const [mode, setMode]       = useState(initialMode); // login | signup | reset
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState(null);
  const [msg, setMsg]         = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setMsg(null); setLoading(true);

    if (mode === "reset") {
      const { error: err } = await resetPassword(email);
      setLoading(false);
      if (err) setError(err.message);
      else setMsg("Check your email for a reset link");
      return;
    }

    const fn = mode === "login" ? signInWithEmail : signUpWithEmail;
    const { error: err } = await fn(email, password);
    setLoading(false);

    if (err) {
      setError(err.message);
    } else if (mode === "signup") {
      setMsg("Check your email to confirm your account");
    } else {
      onClose();
    }
  }

  async function handleGoogle() {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err.message);
  }

  return (
    <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="add-pick-modal" style={{ maxWidth: 380 }}>
        <div className="add-pick-modal-header">
          <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "white" }}>
            {mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Reset Password"}
          </span>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div className="add-pick-modal-body">
          {/* Google OAuth */}
          {mode !== "reset" && (
            <>
              <button className="btn btn-sm" onClick={handleGoogle}
                style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)", justifyContent: "center", gap: 8, padding: "10px 0" }}>
                <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Continue with Google
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-muted)", fontSize: 11 }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                or
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
            </div>
            {mode !== "reset" && (
              <div className="form-field">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" value={password} onChange={e => setPassword(e.target.value)}
                  required minLength={6} placeholder="Min 6 characters" />
              </div>
            )}

            {error && <div style={{ fontSize: 12, color: "var(--red-data)", padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>{error}</div>}
            {msg && <div style={{ fontSize: 12, color: "var(--green-light)", padding: "8px 10px", background: "rgba(34,197,94,0.08)", borderRadius: 6 }}>{msg}</div>}

            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}
              style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}>
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
            </button>
          </form>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
            {mode === "login" && (
              <>
                <button onClick={() => { setMode("signup"); setError(null); setMsg(null); }} style={{ background: "none", border: "none", color: "var(--accent-light)", cursor: "pointer", fontSize: 11 }}>Create account</button>
                <button onClick={() => { setMode("reset"); setError(null); setMsg(null); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>Forgot password?</button>
              </>
            )}
            {mode === "signup" && (
              <button onClick={() => { setMode("login"); setError(null); setMsg(null); }} style={{ background: "none", border: "none", color: "var(--accent-light)", cursor: "pointer", fontSize: 11 }}>Already have an account? Sign in</button>
            )}
            {mode === "reset" && (
              <button onClick={() => { setMode("login"); setError(null); setMsg(null); }} style={{ background: "none", border: "none", color: "var(--accent-light)", cursor: "pointer", fontSize: 11 }}>Back to sign in</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
