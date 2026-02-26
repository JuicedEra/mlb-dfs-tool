// ── AuthContext ────────────────────────────────────────────────────────────
// Wraps the app with user state from Supabase Auth.
// Premium status is read from user_metadata.is_pro (set by Stripe webhook).

import { createContext, useContext, useState, useEffect } from "react";
import { supabase, HAS_AUTH } from "../utils/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    if (!HAS_AUTH) { setLoading(false); return; }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      updateUser(session?.user || null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      updateUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  function updateUser(u) {
    setUser(u);
    setIsPremium(!!u?.user_metadata?.is_pro);
  }

  // ── Auth actions ──────────────────────────────────────────────────────────

  async function signInWithEmail(email, password) {
    if (!HAS_AUTH) return { error: { message: "Auth not configured" } };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signUpWithEmail(email, password) {
    if (!HAS_AUTH) return { error: { message: "Auth not configured" } };
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }

  async function signInWithGoogle() {
    if (!HAS_AUTH) return { error: { message: "Auth not configured" } };
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    return { error };
  }

  async function signOut() {
    if (!HAS_AUTH) return;
    await supabase.auth.signOut();
    setUser(null);
    setIsPremium(false);
  }

  async function resetPassword(email) {
    if (!HAS_AUTH) return { error: { message: "Auth not configured" } };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    return { error };
  }

  return (
    <AuthContext.Provider value={{
      user, loading, isPremium, HAS_AUTH,
      signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, resetPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
