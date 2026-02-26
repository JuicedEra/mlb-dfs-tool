import { useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import TodaysPicks from "./components/tools/TodaysPicks";
import ResearchHub from "./components/tools/ResearchHub";
import PitcherIntel from "./components/tools/PitcherIntel";
import ParkFactors from "./components/tools/ParkFactors";
import StatcastTool from "./components/tools/StatcastTool";
import PickTracker from "./components/tools/PickTracker";
import Backtester from "./components/tools/Backtester";
import ABSTracker from "./components/tools/ABSTracker";
import AuthModal from "./components/shared/AuthModal";
import { HAS_PROP_LINES } from "./utils/propLinesApi";
import { HAS_STRIPE, redirectToCheckout } from "./utils/stripe";
import "./styles/global.css";

const PRO_TOOLS = new Set(["pitchers", "statcast", "backtest", "abs"]);

const NAV = [
  { section: "Today", items: [
    { id: "picks",    label: "Today's Picks",   icon: "auto_awesome",       badge: "LIVE" },
    { id: "research", label: "Player Research",  icon: "manage_search" },
    { id: "pitchers", label: "Pitcher Intel",    icon: "sports_baseball",    pro: true },
    { id: "abs",      label: "ABS Challenges",   icon: "gavel",              pro: true, badge: "NEW" },
  ]},
  { section: "Reference", items: [
    { id: "parks",    label: "Park Factors",    icon: "stadium" },
    { id: "statcast", label: "Statcast",        icon: "speed",              pro: true },
    { id: "backtest", label: "Backtester",      icon: "science",            pro: true },
  ]},
  { section: "My Account", items: [
    { id: "tracker",  label: "My Pick Record",  icon: "assignment_turned_in" },
    { id: "settings", label: "Account Settings", icon: "settings" },
  ]}
];

function DiamondMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="5" width="26" height="26" rx="3" fill="#0A6E4B" transform="rotate(45 18 18)"/>
      <text x="18" y="22" textAnchor="middle" fontSize="11" fontWeight="800"
        fontFamily="'Roboto Condensed', sans-serif" fill="white" letterSpacing="0.5">IQ</text>
    </svg>
  );
}

export default function App() {
  const [activeTool, setActiveTool] = useState("picks");
  const [mode, setMode]             = useState("bts");
  const [showAuth, setShowAuth]     = useState(false);
  const [authMode, setAuthMode]     = useState("login");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { user, isPremium: authPremium, HAS_AUTH, signOut, loading: authLoading } = useAuth();
  const [devPro, setDevPro] = useState(false);
  const isPremium = HAS_AUTH ? authPremium : devPro;

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function handleUpgrade() {
    if (!user && HAS_AUTH) { setAuthMode("signup"); setShowAuth(true); return; }
    if (HAS_STRIPE && user) redirectToCheckout(user.id, user.email);
    else setShowUpgrade(true);
  }

  function handleNavClick(id) {
    if (PRO_TOOLS.has(id) && !isPremium) {
      if (!user && HAS_AUTH) { setAuthMode("signup"); setShowAuth(true); }
      else setShowUpgrade(true);
      return;
    }
    if (id === "settings" && !user && HAS_AUTH) { setAuthMode("login"); setShowAuth(true); return; }
    setActiveTool(id); setSidebarOpen(false);
  }

  const requireAuth = HAS_AUTH && !authLoading && !user;

  return (
    <div className="app">
      <header className="header">
        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle menu">
          <span className="material-icons">{sidebarOpen ? "close" : "menu"}</span>
        </button>
        <div className="header-brand">
          <div className="header-logo-mark"><DiamondMark /></div>
          <div className="header-brand-name">
            <div className="header-brand-wordmark">Diamond<span className="iq">IQ</span></div>
            <div className="header-brand-sub">MLB Hit Analytics</div>
          </div>
        </div>
        <div className="header-divider" />
        <div className="header-date"><span className="material-icons">calendar_today</span>{today}</div>
        <div className="header-right">
          <div className="mode-toggle">
            <button className={`mode-btn ${mode === "bts" ? "active" : ""}`} onClick={() => setMode("bts")}>Beat the Streak</button>
            <button className={`mode-btn ${mode === "props" ? "active" : ""}`} onClick={() => setMode("props")}>Props / DFS</button>
          </div>
          {!HAS_AUTH ? (
            <DevProToggle on={devPro} setOn={setDevPro} />
          ) : authLoading ? null : !user ? (
            <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
              <button className="btn btn-sm" onClick={() => { setAuthMode("login"); setShowAuth(true); }}
                style={{ background: "rgba(255,255,255,0.08)", color: "white", border: "1px solid rgba(255,255,255,0.12)", fontSize: 11, fontWeight: 700, padding: "6px 14px" }}>
                Sign In
              </button>
              <button className="btn btn-sm" onClick={() => { setAuthMode("signup"); setShowAuth(true); }}
                style={{ background: "var(--accent)", color: "white", border: "none", fontSize: 11, fontWeight: 700, padding: "6px 14px" }}>
                Get Started Free
              </button>
            </div>
          ) : (
            <div style={{ position: "relative", marginLeft: 8 }}>
              <button onClick={() => setShowUserMenu(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: "white", fontSize: 11 }}>
                <span className="material-icons" style={{ fontSize: 16 }}>account_circle</span>
                <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.user_metadata?.full_name || user.email?.split("@")[0] || "Account"}
                </span>
                {isPremium && <span style={{ fontSize: 9, fontWeight: 800, background: "var(--accent)", padding: "1px 5px", borderRadius: 4 }}>PRO</span>}
              </button>
              {showUserMenu && (
                <div className="user-menu" onClick={() => setShowUserMenu(false)}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>{user.email}</div>
                  {!isPremium && (
                    <button className="user-menu-item" onClick={handleUpgrade}>
                      <span className="material-icons" style={{ fontSize: 14, color: "var(--yellow)" }}>star</span>Upgrade to PRO
                    </button>
                  )}
                  {isPremium && (
                    <div className="user-menu-item" style={{ cursor: "default" }}>
                      <span className="material-icons" style={{ fontSize: 14, color: "var(--green-light)" }}>verified</span>PRO Active
                    </div>
                  )}
                  <button className="user-menu-item" onClick={() => setActiveTool("settings")}>
                    <span className="material-icons" style={{ fontSize: 14 }}>settings</span>Account Settings
                  </button>
                  <button className="user-menu-item" onClick={signOut}>
                    <span className="material-icons" style={{ fontSize: 14 }}>logout</span>Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {requireAuth ? (
        <LandingScreen onSignIn={() => { setAuthMode("login"); setShowAuth(true); }} onSignUp={() => { setAuthMode("signup"); setShowAuth(true); }} />
      ) : (
        <div className="app-body">
          {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
          <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
            {NAV.map(section => (
              <div key={section.section} className="sidebar-section">
                <div className="sidebar-label">{section.section}</div>
                {section.items.map(item => (
                  <div key={item.id} className={`nav-item ${activeTool === item.id ? "active" : ""} ${item.pro && !isPremium ? "nav-locked" : ""}`}
                    onClick={() => handleNavClick(item.id)}>
                    <span className="material-icons nav-icon">{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.pro && !isPremium && <span className="material-icons" style={{ fontSize: 13, color: "var(--yellow)", opacity: 0.7 }}>lock</span>}
                    {item.badge && <span className="nav-badge">{item.badge}</span>}
                  </div>
                ))}
                <div className="sidebar-divider" />
              </div>
            ))}
            <div className="sidebar-mode-card">
              <div className="sidebar-mode-label">Current Mode</div>
              <div className="sidebar-mode-name" style={{ color: mode === "bts" ? "var(--accent-light)" : "#7DD3FC" }}>
                {mode === "bts" ? "Beat the Streak" : "Props / DFS"}
              </div>
              <div className="sidebar-mode-desc">
                {mode === "bts" ? "Top 2 conservative picks. Optimized for DiMaggio's 56." : "Full ranked pool with value tiers for props and DFS."}
              </div>
            </div>
            {!isPremium && (
              <div style={{ margin: "0 10px 16px", padding: "12px", borderRadius: 8, background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(21,128,61,0.10))", border: "1px solid rgba(245,158,11,0.15)" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--yellow)", marginBottom: 4 }}>
                  <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4 }}>star</span>Unlock PRO
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 8 }}>
                  Top 3 picks, Pitcher Intel, Statcast, Backtester, ABS Tracker, live odds & more
                </div>
                <button className="btn btn-sm" onClick={handleUpgrade}
                  style={{ width: "100%", justifyContent: "center", background: "var(--yellow)", color: "#0A2342", fontSize: 10, fontWeight: 800, border: "none", padding: "6px 0" }}>
                  Upgrade Now
                </button>
              </div>
            )}
            <div style={{ margin: "0 10px 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 4 }}>Prop Lines</div>
              <div style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: HAS_PROP_LINES ? "#22C55E" : "#6B7280", flexShrink: 0 }} />
                <span style={{ color: HAS_PROP_LINES ? "#22C55E" : "rgba(255,255,255,0.30)" }}>
                  {HAS_PROP_LINES ? "Live — Odds API connected" : "Not connected"}
                </span>
              </div>
            </div>
          </aside>
          <main className="main-content">
            {activeTool === "picks"    && <TodaysPicks mode={mode} isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "research" && <ResearchHub isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "pitchers" && <PitcherIntel />}
            {activeTool === "abs"      && <ABSTracker />}
            {activeTool === "parks"    && <ParkFactors />}
            {activeTool === "statcast" && <StatcastTool />}
            {activeTool === "backtest" && <Backtester />}
            {activeTool === "tracker"  && <PickTracker />}
            {activeTool === "settings" && <AccountSettings isPremium={isPremium} onUpgrade={handleUpgrade} />}
          </main>
        </div>
      )}
      {showAuth && <AuthModal mode={authMode} onClose={() => setShowAuth(false)} />}
      {showUpgrade && <UpgradeModal onUpgrade={handleUpgrade} onClose={() => setShowUpgrade(false)} isPremium={isPremium} />}
    </div>
  );
}

function LandingScreen({ onSignIn, onSignUp }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 52px)", padding: "40px 20px", textAlign: "center" }}>
      <div style={{ maxWidth: 480 }}>
        <DiamondMark />
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 900, color: "var(--navy)", margin: "12px 0 8px" }}>
          Diamond<span style={{ color: "var(--accent)" }}>IQ</span>
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 28, lineHeight: 1.6 }}>
          Elite MLB hit analytics for Beat the Streak, player props, and DFS. Data-driven picks powered by Statcast, splits, and matchup intelligence.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 36 }}>
          <button className="btn btn-primary" onClick={onSignUp} style={{ padding: "12px 28px", fontSize: 14, fontWeight: 700 }}>
            <span className="material-icons">rocket_launch</span>Get Started Free
          </button>
          <button className="btn" onClick={onSignIn}
            style={{ padding: "12px 28px", fontSize: 14, fontWeight: 700, background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
            Sign In
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, textAlign: "left" }}>
          {[
            { icon: "auto_awesome", title: "Hit Score Algorithm", desc: "Composite scoring from L7, platoon splits, Statcast, park factors & more" },
            { icon: "query_stats", title: "Statcast Integration", desc: "xBA, barrel%, hard hit% — real contact quality data in every score" },
            { icon: "sports_baseball", title: "Pitcher Intel", desc: "Matchup-level data: pitcher stats, rest days, hittability ratings" },
            { icon: "science", title: "Backtester", desc: "Validate the algorithm against historical data before you trust it" },
          ].map(f => (
            <div key={f.title} style={{ padding: "14px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
              <span className="material-icons" style={{ fontSize: 20, color: "var(--accent)", marginBottom: 6, display: "block" }}>{f.icon}</span>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UpgradeModal({ onUpgrade, onClose, isPremium }) {
  if (isPremium) return null;
  const features = [
    { icon: "auto_awesome", label: "Top 3 picks unlocked daily" },
    { icon: "sports_baseball", label: "Pitcher Intel & matchup data" },
    { icon: "query_stats", label: "Full Statcast metrics (xBA, barrel%, exit velo)" },
    { icon: "science", label: "Historical Backtester" },
    { icon: "gavel", label: "ABS Challenge Tracker" },
    { icon: "share", label: "Shareable pick cards" },
    { icon: "trending_up", label: "Live betting odds integration" },
  ];
  return (
    <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="add-pick-modal" style={{ maxWidth: 400 }}>
        <div className="add-pick-modal-header" style={{ background: "linear-gradient(135deg, #0A2342, #132E52)" }}>
          <div>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "white" }}>
              <span className="material-icons" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6, color: "var(--yellow)" }}>star</span>
              DiamondIQ PRO
            </span>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>Unlock the full analytical edge</div>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div className="add-pick-modal-body" style={{ gap: 6 }}>
          {features.map(f => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <span className="material-icons" style={{ fontSize: 16, color: "var(--accent)" }}>{f.icon}</span>
              <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{f.label}</span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 8, textAlign: "center" }}>
            <button className="btn btn-primary" onClick={() => { onUpgrade(); onClose(); }}
              style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14, fontWeight: 800, background: "var(--yellow)", color: "#0A2342", border: "none" }}>
              <span className="material-icons">star</span>Upgrade to PRO
            </button>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8 }}>Monthly & yearly plans available</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountSettings({ isPremium, onUpgrade }) {
  const { user, signOut, HAS_AUTH } = useAuth();
  const [changingPw, setChangingPw] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

  async function handleChangePassword() {
    if (!HAS_AUTH || !newPw || newPw.length < 6) return;
    setPwLoading(true); setPwMsg(null);
    try {
      const { supabase } = await import("./utils/supabase");
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) setPwMsg({ type: "error", text: error.message });
      else { setPwMsg({ type: "ok", text: "Password updated" }); setNewPw(""); setChangingPw(false); }
    } catch (e) { setPwMsg({ type: "error", text: e.message }); }
    setPwLoading(false);
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--navy)", marginBottom: 24 }}>
        <span className="material-icons" style={{ verticalAlign: "middle", marginRight: 8 }}>settings</span>Account Settings
      </h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title"><span className="material-icons">person</span>Profile</span></div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" value={user?.email || "Not signed in"} readOnly style={{ opacity: 0.7 }} />
          </div>
          <div className="form-field">
            <label className="form-label">Account Type</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`badge ${isPremium ? "badge-elite" : "badge-gray"}`} style={{ fontSize: 11 }}>{isPremium ? "PRO" : "Free"}</span>
              {!isPremium && (
                <button className="btn btn-sm" onClick={onUpgrade}
                  style={{ fontSize: 10, background: "var(--yellow)", color: "#0A2342", border: "none", fontWeight: 700 }}>
                  <span className="material-icons" style={{ fontSize: 12 }}>star</span>Upgrade
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title"><span className="material-icons">lock</span>Password</span></div>
        <div style={{ padding: 16 }}>
          {!changingPw ? (
            <button className="btn btn-sm" onClick={() => setChangingPw(true)}
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              Change Password
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="form-field">
                <label className="form-label">New Password</label>
                <input type="password" className="form-input" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 6 characters" minLength={6} />
              </div>
              {pwMsg && <div style={{ fontSize: 12, color: pwMsg.type === "ok" ? "var(--green-light)" : "var(--red-data)", padding: "6px 10px", background: pwMsg.type === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", borderRadius: 6 }}>{pwMsg.text}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={handleChangePassword} disabled={pwLoading || newPw.length < 6}>{pwLoading ? "Saving..." : "Update Password"}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setChangingPw(false); setNewPw(""); setPwMsg(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {isPremium && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span className="card-title"><span className="material-icons">credit_card</span>Subscription</span></div>
          <div style={{ padding: 16, fontSize: 13, color: "var(--text-secondary)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="material-icons" style={{ color: "var(--green-light)", fontSize: 18 }}>verified</span>
              <span style={{ fontWeight: 700 }}>PRO subscription active</span>
            </div>
            <p style={{ lineHeight: 1.6, marginBottom: 12 }}>Manage billing, update payment, or cancel through Stripe's portal.</p>
            <button className="btn btn-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <span className="material-icons" style={{ fontSize: 14 }}>open_in_new</span>Manage Subscription
            </button>
          </div>
        </div>
      )}
      <div className="card" style={{ borderColor: "rgba(239,68,68,0.2)" }}>
        <div className="card-header" style={{ background: "rgba(239,68,68,0.03)" }}>
          <span className="card-title" style={{ color: "var(--red-data)" }}><span className="material-icons">warning</span>Sign Out</span>
        </div>
        <div style={{ padding: 16 }}>
          <button className="btn btn-sm" onClick={signOut}
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", color: "var(--red-data)", fontWeight: 700 }}>
            <span className="material-icons" style={{ fontSize: 14 }}>logout</span>Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function DevProToggle({ on, setOn }) {
  return (
    <button onClick={() => setOn(v => !v)}
      style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.18)", background: on ? "var(--accent)" : "rgba(255,255,255,0.07)", color: "white", cursor: "pointer", textTransform: "uppercase" }}
      title="Toggle PRO features preview">
      {on ? "PRO ✓" : "PRO"} (dev)
    </button>
  );
}
