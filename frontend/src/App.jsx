import { useState, useEffect } from "react";
import { useAuth } from "./contexts/AuthContext";
import TodaysPicks from "./components/tools/TodaysPicks";
import ResearchHub from "./components/tools/ResearchHub";
import PitcherIntel from "./components/tools/PitcherIntel";
import ParkFactors from "./components/tools/ParkFactors";
import StatcastTool from "./components/tools/StatcastTool";
import PickTracker from "./components/tools/PickTracker";
import Backtester from "./components/tools/Backtester";
import ABSTracker from "./components/tools/ABSTracker";
import StreamerFinder from "./components/tools/StreamerFinder";
import AuthModal from "./components/shared/AuthModal";
import { fetchMLBEvents } from "./utils/propLinesApi";
import { HAS_STRIPE, redirectToCheckout } from "./utils/stripe";
import { fetchGames, fetchRoster, fetchGameLog, computeSplit, fetchPitcherStats, fetchLiveBoxscoreStats, PARK_FACTORS, computeHitScore, headshot } from "./utils/mlbApi";
import "./styles/global.css";

const PRO_TOOLS = new Set(["pitchers", "statcast", "backtest", "abs", "streamer"]);

const NAV = [
  { section: "Today", items: [
    { id: "picks",    label: "Today's Picks",   icon: "auto_awesome",       badge: "LIVE" },
    { id: "research", label: "Player Research",  icon: "manage_search" },
    { id: "pitchers", label: "Pitcher Intel",    icon: "sports_baseball",    pro: true },
    { id: "abs",      label: "ABS Challenges",   icon: "gavel",              pro: true, badge: "NEW" },
    { id: "streamer", label: "Streamer Finder",   icon: "cloud_download",     pro: true, badge: "NEW" },
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
  const [devLanding, setDevLanding] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("diq_theme") === "dark");
  const [oddsConnected, setOddsConnected] = useState(null);
  const isPremium = HAS_AUTH ? authPremium : devPro;

  // Apply dark mode theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("diq_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Check odds API connection status once on mount
  useEffect(() => {
    fetchMLBEvents().then(events => {
      setOddsConnected(Array.isArray(events) && events.length >= 0);
    }).catch(() => setOddsConnected(false));
  }, []);

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

  const requireAuth = devLanding || (HAS_AUTH && !authLoading && !user);

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
          {/* Dark mode toggle — always visible */}
          <button onClick={() => setDarkMode(d => !d)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            className="dark-mode-btn"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white", flexShrink: 0 }}>
            <span className="material-icons" style={{ fontSize: 17 }}>{darkMode ? "light_mode" : "dark_mode"}</span>
          </button>
          {/* Mode toggle — compact on mobile, full text on desktop */}
          <div className="mode-toggle header-mode-toggle">
            <button className={`mode-btn ${mode === "bts" ? "active" : ""}`} onClick={() => setMode("bts")}>
              <span className="mode-btn-full">Beat the Streak</span>
              <span className="mode-btn-short">BTS</span>
            </button>
            <button className={`mode-btn ${mode === "props" ? "active" : ""}`} onClick={() => setMode("props")}>
              <span className="mode-btn-full">Props / DFS</span>
              <span className="mode-btn-short">Props</span>
            </button>
          </div>
          {!HAS_AUTH ? (
            <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
              <DevProToggle on={devPro} setOn={setDevPro} />
              <DevLandingToggle on={devLanding} setOn={setDevLanding} />
            </div>
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
              {/* Mobile mode toggle — visible only on mobile (header toggle hidden) */}
              <div className="sidebar-mobile-mode-toggle">
                <button className={`mode-btn ${mode === "bts" ? "active" : ""}`} onClick={() => setMode("bts")} style={{ flex: 1, justifyContent: "center" }}>Beat the Streak</button>
                <button className={`mode-btn ${mode === "props" ? "active" : ""}`} onClick={() => setMode("props")} style={{ flex: 1, justifyContent: "center" }}>Props / DFS</button>
              </div>
              <div className="sidebar-mode-name sidebar-mode-label-desktop" style={{ color: mode === "bts" ? "var(--accent-light)" : "#7DD3FC" }}>
                {mode === "bts" ? "Beat the Streak" : "Props / DFS"}
              </div>
              <div className="sidebar-mode-desc">
                {mode === "bts" ? "Top 5 picks optimized for Beat the Streak — prioritizing consistency and safety." : "Full ranked pool with value tiers for props and DFS."}
              </div>
            </div>
            {!isPremium && (
              <div style={{ margin: "0 10px 16px", padding: "12px", borderRadius: 8, background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(21,128,61,0.10))", border: "1px solid rgba(245,158,11,0.15)" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--yellow)", marginBottom: 4 }}>
                  <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4 }}>star</span>Unlock PRO
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 8 }}>
                  Top 5 picks, Pitcher Intel, Streamer Finder, Statcast, Backtester, ABS Tracker, live odds & more
                </div>
                <button className="btn btn-sm" onClick={handleUpgrade}
                  style={{ width: "100%", justifyContent: "center", background: "var(--yellow)", color: "#0A2342", fontSize: 10, fontWeight: 800, border: "none", padding: "6px 0" }}>
                  Upgrade Now
                </button>
              </div>
            )}
            <div style={{ margin: "0 10px 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 4 }}>Prop Lines / Odds</div>
              <div style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: oddsConnected === true ? "#22C55E" : oddsConnected === false ? "#6B7280" : "#D97706", flexShrink: 0 }} />
                <span style={{ color: oddsConnected === true ? "#22C55E" : oddsConnected === false ? "rgba(255,255,255,0.30)" : "#D97706" }}>
                  {oddsConnected === true ? "Live — Odds API connected" : oddsConnected === false ? "Add ODDS_API_KEY in Vercel" : "Checking..."}
                </span>
              </div>
            </div>
          </aside>
          <main className="main-content">
            {activeTool === "picks"    && <TodaysPicks mode={mode} isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "research" && <ResearchHub isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "pitchers" && <PitcherIntel isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "abs"      && <ABSTracker />}
            {activeTool === "streamer" && <StreamerFinder isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "parks"    && <ParkFactors />}
            {activeTool === "statcast" && <StatcastTool />}
            {activeTool === "backtest" && <Backtester isPremium={isPremium} onUpgrade={handleUpgrade} />}
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
  useEffect(() => {
    import('./components/tools/TodaysPicks').catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column' }}>
      <LandingHero onSignIn={onSignIn} onSignUp={onSignUp} />
      <LandingFeatures />
    </div>
  );
}

function LandingHero({ onSignIn, onSignUp }) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [authMode, setAuthMode] = useState('signup'); // 'signup' | 'login'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [msg, setMsg]           = useState(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setMsg(null); setLoading(true);
    const fn = authMode === 'login' ? signInWithEmail : signUpWithEmail;
    const { error: err } = await fn(email, password);
    setLoading(false);
    if (err) setError(err.message);
    else if (authMode === 'signup') setMsg('Check your email to confirm your account');
  }

  async function handleGoogle() {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err.message);
  }

  // Load yesterday's top picks — only shows players who ACTUALLY got a hit
  const [showcasePicks, setShowcasePicks] = useState([]);
  const [showcaseLoading, setShowcaseLoading] = useState(true);
  useEffect(() => {
    async function loadYesterday() {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yDate = yesterday.toLocaleDateString("en-CA");
        const season = yesterday.getFullYear();

        // Step 1: Get yesterday's schedule
        const { games } = await fetchGames(yDate);
        const completed = (games || []).filter(g => !g.isPostponed && !g.isCancelled);
        if (!completed.length) { setShowcaseLoading(false); return; }

        // Step 2: Fetch box scores for all games in parallel (capped to 8 games for speed)
        const gameSlice = completed.slice(0, 8);
        const boxResults = await Promise.allSettled(
          gameSlice.map(g => fetchLiveBoxscoreStats(g.gamePk).then(bs => ({ gamePk: g.gamePk, game: g, bs })))
        );

        // Collect all batters who got a hit — box score has names and stats
        const hitters = [];
        for (const r of boxResults) {
          if (r.status !== "fulfilled" || !r.value.bs?.stats?.size) continue;
          const { game, bs } = r.value;
          for (const [playerId, stat] of bs.stats) {
            if (stat.atBats === 0 || stat.hits === 0) continue;
            if (!stat.name) continue; // skip if no name in box score
            const pitcherHome = game.away?.pitcher?.name || "";
            const pitcherAway = game.home?.pitcher?.name || "";
            hitters.push({ playerId, stat, game, pitcherName: pitcherHome || pitcherAway });
          }
        }

        if (hitters.length < 2) { setShowcaseLoading(false); return; }

        // Step 4: For the top candidates, fetch game logs in parallel to score them
        // Limit to 12 hitters max to keep it fast
        const topHitters = hitters.slice(0, 12);
        const scored = await Promise.allSettled(
          topHitters.map(async ({ playerId, stat, game, pitcherName }) => {
            try {
              const gl = await fetchGameLog(playerId, season);
              const l7 = computeSplit(gl, 7);
              const l3 = computeSplit(gl, 3);
              const pf = PARK_FACTORS[game.venue] || { factor: 100 };
              const scoreData = computeHitScore({
                l7, l3, l15: l7, seasonAvg: l7.avg,
                parkFactor: pf.factor,
                pitcherSeasonAvgAgainst: 0.250,
              });
              return {
                name: stat.name,
                id: playerId,
                team: game.home?.team || game.away?.team || "",
                score: Math.round(scoreData.withoutBvP),
                hits: stat.hits,
                atBats: stat.atBats,
                totalBases: stat.totalBases,
                rbi: stat.rbi,
                factors: [`L7: ${l7.avg || ".---"}`, pitcherName ? `vs ${pitcherName.split(" ").pop()}` : ""].filter(Boolean),
                img: headshot(playerId),
              };
            } catch { return null; }
          })
        );

        const candidates = scored
          .filter(r => r.status === "fulfilled" && r.value?.name)
          .map(r => r.value)
          .sort((a, b) => b.score - a.score);

        if (candidates.length >= 2) {
          setShowcasePicks(candidates.slice(0, 2).map((p, i) => ({ ...p, rank: i + 1 })));
        }
      } catch (e) { console.warn("Landing picks failed:", e); }
      finally { setShowcaseLoading(false); }
    }
    loadYesterday();
  }, []);

  return (
    <div style={{
      flex: 1,
      background: 'linear-gradient(135deg, #000F2B 0%, #001A45 40%, #00142E 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background texture */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(255,255,255,1) 40px, rgba(255,255,255,1) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,1) 40px, rgba(255,255,255,1) 41px)',
        pointerEvents: 'none',
      }} />
      {/* Glow orbs */}
      <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(10,110,75,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-10%', right: '-5%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0,45,114,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: 'clamp(32px, 5vw, 64px) clamp(16px, 4vw, 48px)',
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
        gap: 'clamp(32px, 5vw, 80px)', alignItems: 'center',
      }}
        className="landing-hero-grid"
      >
        {/* LEFT — copy + auth form */}
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(10,110,75,0.15)', border: '1px solid rgba(10,110,75,0.30)', borderRadius: 50, padding: '5px 14px', marginBottom: 24 }} className="landing-badge">
            <span className="material-icons" style={{ fontSize: 12, color: '#4ADE80' }}>auto_awesome</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#4ADE80', letterSpacing: '1.5px', textTransform: 'uppercase' }}>2026 Season · Live Daily Updates</span>
          </div>

          <h1 className="landing-h1" style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(30px, 4vw, 52px)', fontWeight: 900, color: 'white', margin: '0 0 16px', lineHeight: 1.08, letterSpacing: '-0.5px' }}>
            Know who's getting<br />
            a hit{' '}
            <span style={{ color: '#4ADE80', position: 'relative', display: 'inline-block' }}>
              before first pitch
              <span style={{ position: 'absolute', bottom: -2, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #4ADE80, #0A6E4B)', borderRadius: 2, opacity: 0.6 }} />
            </span>
          </h1>

          <p className="landing-sub" style={{ fontSize: 'clamp(13px, 1.5vw, 16px)', color: 'rgba(255,255,255,0.55)', maxWidth: 440, lineHeight: 1.75, margin: '0 0 32px' }}>
            DiamondIQ scores every MLB hitter daily — K%, BABIP, Statcast, matchups, and more — distilled into one number. Built for Beat the Streak, player props, and DFS.
          </p>

          {/* Inline auth form */}
          <div className="landing-auth-box" style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 16, padding: 'clamp(20px, 3vw, 28px)',
            backdropFilter: 'blur(12px)',
          }}>
            {/* Tab toggle */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: 3, marginBottom: 20, gap: 3 }}>
              {['signup', 'login'].map(m => (
                <button key={m} onClick={() => { setAuthMode(m); setError(null); setMsg(null); }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    background: authMode === m ? 'white' : 'transparent',
                    color: authMode === m ? 'var(--navy)' : 'rgba(255,255,255,0.45)',
                    transition: 'all 0.18s ease',
                  }}>
                  {m === 'signup' ? 'Create Account' : 'Sign In'}
                </button>
              ))}
            </div>

            {/* Google */}
            <button onClick={handleGoogle} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(255,255,255,0.06)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 14,
            }}>
              <svg width="15" height="15" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.10)' }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.5px' }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.10)' }} />
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="Email address"
                style={{
                  padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.07)', color: 'white', fontSize: 13, outline: 'none',
                  '::placeholder': { color: 'rgba(255,255,255,0.3)' },
                }} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                placeholder="Password (min 6 characters)"
                style={{
                  padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.07)', color: 'white', fontSize: 13, outline: 'none',
                }} />

              {error && (
                <div style={{ fontSize: 12, color: '#FCA5A5', padding: '8px 12px', background: 'rgba(239,68,68,0.12)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                  {error}
                </div>
              )}
              {msg && (
                <div style={{ fontSize: 12, color: '#4ADE80', padding: '8px 12px', background: 'rgba(34,197,94,0.10)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)' }}>
                  {msg}
                </div>
              )}

              <button type="submit" disabled={loading} style={{
                padding: '11px 0', borderRadius: 10, border: 'none', cursor: loading ? 'default' : 'pointer',
                background: loading ? 'rgba(10,110,75,0.5)' : 'linear-gradient(135deg, #0A6E4B, #0D8A5E)',
                color: 'white', fontSize: 14, fontWeight: 800,
                boxShadow: loading ? 'none' : '0 4px 16px rgba(10,110,75,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                {loading ? 'Please wait...' : authMode === 'signup' ? (
                  <><span className="material-icons" style={{ fontSize: 16 }}>rocket_launch</span>Get Started Free</>
                ) : (
                  <><span className="material-icons" style={{ fontSize: 16 }}>login</span>Sign In</>
                )}
              </button>
            </form>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {authMode === 'signup' ? (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>No credit card required</span>
              ) : (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>&nbsp;</span>
              )}
              {authMode === 'login' && (
                <button onClick={onSignIn} style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Forgot password?
                </button>
              )}
            </div>
          </div>

          {/* Mobile-only: yesterday's confirmed picks (desktop shows these in right column) */}
          <div className="landing-mobile-picks" style={{ display: 'none', marginTop: 20, flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="material-icons" style={{ fontSize: 13, color: '#4ADE80' }}>check_circle</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '1px', textTransform: 'uppercase' }}>Yesterday's Top Picks — Confirmed Hits</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>{new Date(Date.now() - 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </div>
            {showcasePicks.length >= 2 ? showcasePicks.map((p, idx) => (
              <PlayerShowcaseCard key={p.id || p.name} player={p} rank={idx + 1} />
            )) : showcaseLoading ? (
              [1, 2].map(i => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(74,222,128,0.3)', borderTopColor: '#4ADE80', animation: 'spin 1s linear infinite' }} />
                </div>
              ))
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px 16px', textAlign: 'center' }}>
                <span className="material-icons" style={{ fontSize: 22, color: 'rgba(255,255,255,0.15)', display: 'block', marginBottom: 6 }}>sports_baseball</span>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Season results coming soon</div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — player card showcase */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} className="landing-cards-col">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="material-icons" style={{ fontSize: 14, color: '#4ADE80' }}>check_circle</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: '1px', textTransform: 'uppercase' }}>Yesterday&apos;s Top Picks — Confirmed Hits</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>{new Date(Date.now() - 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          </div>

          {showcasePicks.length >= 2 ? showcasePicks.map((p, idx) => (
            <PlayerShowcaseCard key={p.id || p.name} player={p} rank={idx + 1} />
          )) : showcaseLoading ? (
            // Skeleton cards while loading
            [1, 2].map(i => (
              <div key={i} style={{ background: 'linear-gradient(135deg, rgba(10,35,66,0.95), rgba(0,20,46,0.98))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '18px 20px', height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(74,222,128,0.3)', borderTopColor: '#4ADE80', animation: 'spin 1s linear infinite' }} />
              </div>
            ))
          ) : (
            // No data available (spring training / no games)
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '32px 20px', textAlign: 'center' }}>
              <span className="material-icons" style={{ fontSize: 28, color: 'rgba(255,255,255,0.15)', display: 'block', marginBottom: 8 }}>sports_baseball</span>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Results available once the regular season starts</div>
            </div>
          )}

          {/* Teaser row */}
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.10)',
            borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-icons" style={{ fontSize: 18, color: 'rgba(255,255,255,0.2)' }}>lock</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.25)' }}>+18 more hitters ranked today</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', marginTop: 2 }}>Sign up free to unlock the full board</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .landing-hero-grid { grid-template-columns: 1fr !important; }
          .landing-cards-col { display: none !important; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.85); }
        }
        input::placeholder { color: rgba(255,255,255,0.28) !important; }
        @media (max-width: 768px) {
          .landing-hero-grid { grid-template-columns: 1fr !important; gap: 24px !important; padding: 24px 16px !important; }
          .landing-cards-col { display: none !important; }    /* desktop picks col — hidden on mobile */
          .landing-mobile-picks { display: flex !important; } /* mobile picks — shown below auth */
          .landing-mobile-stats { display: none; }
          .landing-h1 { font-size: 28px !important; }
          .landing-sub { font-size: 13px !important; margin-bottom: 20px !important; }
          .landing-badge { margin-bottom: 16px !important; }
          .landing-auth-box { padding: 18px !important; }
        }
      `}</style>
    </div>
  );
}

function PlayerShowcaseCard({ player: p, rank }) {
  const scoreColor = p.score >= 70 ? '#4ADE80' : p.score >= 55 ? '#60A5FA' : '#94A3B8';
  const hitLabel = p.hits === 1 ? '1 Hit' : `${p.hits} Hits`;
  const tbLabel  = p.totalBases > p.hits ? ` · ${p.totalBases}TB` : '';
  const rbiLabel = p.rbi > 0 ? ` · ${p.rbi}RBI` : '';

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(10,35,66,0.95), rgba(0,20,46,0.98))',
      border: '1px solid rgba(74,222,128,0.22)',
      borderRadius: 16, padding: '18px 20px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(74,222,128,0.08)',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Subtle green glow — confirmed success */}
      <div style={{ position: 'absolute', top: -30, right: -30, width: 130, height: 130, background: 'radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: 14, left: 16,
        width: 26, height: 26, borderRadius: '50%',
        background: rank === 1 ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'rgba(255,255,255,0.08)',
        border: rank === 1 ? 'none' : '1px solid rgba(255,255,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 900, color: rank === 1 ? '#0A2342' : 'rgba(255,255,255,0.5)',
        zIndex: 1,
      }}>#{rank}</div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
        {/* Headshot with checkmark */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(74,222,128,0.40)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={p.img} alt={p.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentNode.innerHTML = `<span class="material-icons" style="font-size:28px;color:rgba(255,255,255,0.2)">person</span>`; }} />
          </div>
          {/* Green checkmark badge — confirmed hit */}
          <div style={{
            position: 'absolute', bottom: -3, right: -3,
            background: '#16A34A', borderRadius: '50%', width: 20, height: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #000F2B', boxShadow: '0 0 8px rgba(74,222,128,0.5)',
          }}>
            <span className="material-icons" style={{ fontSize: 11, color: 'white' }}>check</span>
          </div>
        </div>

        {/* Name + team + factors */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{p.team}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {p.factors.map(f => (
              <span key={f} style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 50, background: 'rgba(74,222,128,0.10)', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.18)', letterSpacing: '0.2px' }}>{f}</span>
            ))}
          </div>
        </div>

        {/* Score */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{p.score}</div>
          <div style={{ fontSize: 8, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '1.5px', marginTop: 2 }}>Hit Score</div>
        </div>
      </div>

      {/* Confirmed result banner */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(74,222,128,0.22)',
        borderRadius: 10, padding: '8px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-icons" style={{ fontSize: 14, color: '#4ADE80' }}>check_circle</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#4ADE80', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Confirmed Hit
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 900, color: 'white', letterSpacing: '0.3px' }}>
          {p.hits}-{p.atBats}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
            {tbLabel}{rbiLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function LandingFeatures() {
  const features = [
    {
      icon: 'auto_awesome', color: '#2563EB', bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.15)',
      title: 'Daily Hit Rankings',
      desc: 'Every MLB hitter scored and ranked before first pitch. Algorithm updates live as lineups confirm.',
      badge: 'FREE',
    },
    {
      icon: 'person_search', color: '#0891B2', bg: 'rgba(8,145,178,0.08)', border: 'rgba(8,145,178,0.15)',
      title: 'Player Research',
      desc: 'Deep dive on any hitter — recent splits, BvP history, Statcast, platoon data, and park context.',
      badge: 'FREE',
    },
    {
      icon: 'sports_baseball', color: '#D97706', bg: 'rgba(217,119,6,0.08)', border: 'rgba(217,119,6,0.15)',
      title: 'Pitcher Intel',
      desc: 'Hittability scores, recent form trends, and start logs. Instantly see which arms to target today.',
      badge: 'PRO',
    },
    {
      icon: 'monetization_on', color: '#7C3AED', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.15)',
      title: 'Live Prop Lines',
      desc: 'Real-time betting lines for hits, total bases, and RBI props — cross-referenced with our rankings.',
      badge: 'PRO',
    },
    {
      icon: 'cloud_download', color: '#15803D', bg: 'rgba(21,128,61,0.08)', border: 'rgba(21,128,61,0.15)',
      title: 'Streamer Finder',
      desc: 'Fantasy baseball streaming picks ranked by score, availability, and matchup — updated daily.',
      badge: 'PRO',
    },
    {
      icon: 'query_stats', color: '#EA580C', bg: 'rgba(234,88,12,0.08)', border: 'rgba(234,88,12,0.15)',
      title: 'Statcast Metrics',
      desc: 'xBA, barrel rate, exit velocity, and hard-hit % — all the Baseball Savant data surfaced.',
      badge: 'PRO',
    },
    {
      icon: 'assignment_turned_in', color: '#BE185D', bg: 'rgba(190,24,93,0.08)', border: 'rgba(190,24,93,0.15)',
      title: 'Pick Tracker',
      desc: 'Log picks, auto-resolve results from live box scores, and track your hit rate over time.',
      badge: 'FREE',
    },
    {
      icon: 'science', color: '#6D28D9', bg: 'rgba(109,40,217,0.08)', border: 'rgba(109,40,217,0.15)',
      title: 'Backtester',
      desc: 'Replay the algorithm on any past date and see how the rankings held up against real results.',
      badge: 'PRO',
    },
    {
      icon: 'gavel', color: '#0369A1', bg: 'rgba(3,105,161,0.08)', border: 'rgba(3,105,161,0.15)',
      title: 'ABS Challenges',
      desc: 'Track automatic ball-strike system challenge outcomes by batter, pitcher, and umpire zone.',
      badge: 'PRO',
    },
  ];

  const badgeStyle = (badge) => ({
    fontSize: 8, fontWeight: 900, letterSpacing: '0.8px',
    padding: '2px 6px', borderRadius: 4,
    background: badge === 'PRO' ? 'rgba(245,158,11,0.12)' : 'rgba(21,128,61,0.12)',
    color: badge === 'PRO' ? '#D97706' : '#15803D',
    border: `1px solid ${badge === 'PRO' ? 'rgba(245,158,11,0.2)' : 'rgba(21,128,61,0.2)'}`,
  });

  return (
    <div style={{ background: '#F0F4F8', padding: 'clamp(40px, 5vw, 64px) clamp(16px, 4vw, 48px)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>Everything you need</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3vw, 32px)', fontWeight: 900, color: 'var(--navy)', margin: 0 }}>
            The full analytical edge
          </h2>
        </div>

        {/* Responsive feature grid — 3 across on desktop, 1 col on mobile */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}
          className="features-grid">
          {features.map(f => (
            <div key={f.title} style={{ background: 'white', borderRadius: 16, padding: '20px 18px', border: `1px solid ${f.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: f.bg, border: `1px solid ${f.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-icons" style={{ fontSize: 20, color: f.color }}>{f.icon}</span>
                </div>
                <span style={badgeStyle(f.badge)}>{f.badge}</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--navy)', marginBottom: 5 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.65 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Scoring factors — with algorithm context description */}
        <div style={{ marginTop: 36, background: 'white', borderRadius: 16, border: '1px solid var(--border)', padding: 'clamp(20px, 3vw, 32px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Proprietary Algorithm</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--navy)', margin: '0 0 10px' }}>Multiple factors. One score.</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
              These are the inputs that power DiamondIQ's Hit Score — the proprietary model behind every daily pick ranking, whether you're playing Beat the Streak, player props, or DFS.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {[
              { label: 'Contact Quality', desc: 'Plate discipline, lineup position, PA volume', color: '#15803D', icon: 'sports_baseball' },
              { label: 'Recent Form',     desc: 'Short-window averages, streaks, last results',  color: '#D97706', icon: 'local_fire_department' },
              { label: 'Matchup',         desc: 'Platoon splits, pitcher tendencies, fatigue',   color: '#2563EB', icon: 'swap_horiz' },
              { label: 'Statcast',        desc: 'Expected outcomes from batted ball data',        color: '#7C3AED', icon: 'query_stats' },
              { label: 'Environment',     desc: 'Park factors, weather, day/night conditions',   color: '#6B7280', icon: 'wb_sunny' },
            ].map(t => (
              <div key={t.label} style={{ flex: '1 1 140px', maxWidth: 180, background: 'var(--surface-2)', borderRadius: 12, padding: '14px 12px', border: `1px solid ${t.color}22`, textAlign: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: t.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                  <span className="material-icons" style={{ fontSize: 16, color: t.color }}>{t.icon}</span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--navy)', marginBottom: 4 }}>{t.label}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .features-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 480px) {
          .features-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
function UpgradeModal({ onUpgrade, onClose, isPremium }) {
  if (isPremium) return null;
  const features = [
    { icon: "auto_awesome", label: "Top 5 picks unlocked daily" },
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
      style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.18)", background: on ? "var(--accent)" : "rgba(255,255,255,0.07)", color: "white", cursor: "pointer", textTransform: "uppercase" }}
      title="Toggle PRO features preview">
      {on ? "PRO ✓" : "PRO"} (dev)
    </button>
  );
}

function DevLandingToggle({ on, setOn }) {
  return (
    <button onClick={() => setOn(v => !v)}
      style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.18)", background: on ? "#7C3AED" : "rgba(255,255,255,0.07)", color: "white", cursor: "pointer", textTransform: "uppercase" }}
      title="Preview landing page">
      {on ? "LANDING ✓" : "LANDING"} (dev)
    </button>
  );
}
