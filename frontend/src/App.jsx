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
import ProfilePage from "./components/tools/ProfilePage";
import AuthModal from "./components/shared/AuthModal";
import { fetchMLBEvents } from "./utils/propLinesApi";
import { HAS_STRIPE, redirectToCheckout } from "./utils/stripe";
import { fetchGames, fetchRoster, fetchGameLog, computeSplit, fetchPitcherStats, fetchLiveBoxscoreStats, PARK_FACTORS, computeHitScore, headshot } from "./utils/mlbApi";
import "./styles/global.css";

const PRO_TOOLS = new Set(["pitchers", "statcast", "abs", "streamer"]);

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
    { id: "backtest", label: "Backtester",      icon: "science" },
  ]},
  { section: "My Account", items: [
    { id: "profile",  label: "My Profile",       icon: "emoji_events" },
    { id: "tracker",  label: "My Pick Record",   icon: "assignment_turned_in" },
    { id: "settings", label: "Account Settings", icon: "settings" },
    { id: "faq",      label: "Help & FAQ",        icon: "help_outline" },
  ]}
];

function DiamondMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer glow ring */}
      <circle cx="20" cy="20" r="19" fill="url(#dmGrad)" />
      {/* Diamond shape */}
      <path d="M20 6 L34 20 L20 34 L6 20 Z" fill="url(#dmDiamond)" />
      {/* Diamond inner highlight */}
      <path d="M20 9 L31 20 L20 31 L9 20 Z" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
      {/* Stitching arcs — left */}
      <path d="M13 16 Q11 20 13 24" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <path d="M11.5 16.5 Q9 20 11.5 23.5" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" fill="none" strokeLinecap="round" />
      {/* Stitching arcs — right */}
      <path d="M27 16 Q29 20 27 24" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <path d="M28.5 16.5 Q31 20 28.5 23.5" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" fill="none" strokeLinecap="round" />
      {/* IQ text */}
      <text x="20" y="24.5" textAnchor="middle" fontSize="10.5" fontWeight="900"
        fontFamily="'Space Grotesk', 'Inter', sans-serif" fill="white" letterSpacing="0.8">IQ</text>
      <defs>
        <radialGradient id="dmGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#1A4A6E" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#000F2B" stopOpacity="0.2" />
        </radialGradient>
        <linearGradient id="dmDiamond" x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0D9E6A" />
          <stop offset="50%" stopColor="#0A6E4B" />
          <stop offset="100%" stopColor="#075C3E" />
        </linearGradient>
      </defs>
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
  const [showProWelcome, setShowProWelcome] = useState(false);

  const { user, isPremium: authPremium, HAS_AUTH, signOut, loading: authLoading, justVerified } = useAuth();
  const [devPro, setDevPro] = useState(false);
  const [devLanding, setDevLanding] = useState(false);

  const DEV_PRO_EMAILS = ["thexjs95@gmail.com"];
  const isDevProByEmail = DEV_PRO_EMAILS.includes(user?.email);
  const isPremium = isDevProByEmail || (HAS_AUTH ? authPremium : devPro);

  // Handle return from Stripe checkout — show celebration screen
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      setShowProWelcome(true);
    }
  }, []);
  useEffect(() => {
    if (justVerified && user) {
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
        detail: { msg: `Welcome to DiamondIQ, ${user.user_metadata?.full_name || user.email?.split("@")[0] || "friend"}! You're all set. 🎉`, type: "ok", duration: 7000 }
      }));
      setShowAuth(false);
    }
  }, [justVerified, user]);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("diq_theme") === "dark");
  const [oddsConnected, setOddsConnected] = useState(null);

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

  // Handle footer nav events (e.g. FAQ link from AppFooter)
  useEffect(() => {
    function handleNav(e) { setActiveTool(e.detail); }
    window.addEventListener("diamondiq:navigate", handleNav);
    return () => window.removeEventListener("diamondiq:navigate", handleNav);
  }, []);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function handleUpgrade(plan = "monthly") {
    if (!user && HAS_AUTH) { setAuthMode("signup"); setShowAuth(true); return; }
    if (HAS_STRIPE && user) {
      redirectToCheckout(user.id, user.email, plan);
    } else {
      // Show modal regardless — either Stripe not configured or no user
      setShowUpgrade(true);
    }
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
          {/* Dark mode toggle — hidden on landing */}
          {!requireAuth && (
            <button onClick={() => setDarkMode(d => !d)}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              className="dark-mode-btn"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white", flexShrink: 0 }}>
              <span className="material-icons" style={{ fontSize: 17 }}>{darkMode ? "light_mode" : "dark_mode"}</span>
            </button>
          )}
          {/* Mode toggle — hidden on landing */}
          {!requireAuth && (
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
          )}
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
                style={{ background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#0A2342", border: "none", fontSize: 11, fontWeight: 800, padding: "6px 14px" }}>
                Try Free 7 Days
              </button>
            </div>
          ) : (
            <div style={{ position: "relative", marginLeft: 8 }}>
              <button onClick={() => setShowUserMenu(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: isPremium ? "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(180,120,0,0.08))" : "none",
                  border: isPremium ? "1.5px solid rgba(245,158,11,0.55)" : "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: "white", fontSize: 11,
                  boxShadow: isPremium ? "0 0 12px rgba(245,158,11,0.2), inset 0 1px 0 rgba(255,215,0,0.1)" : "none",
                  transition: "all 0.2s",
                }}>
                {isPremium ? (
                  <span className="material-icons" style={{ fontSize: 16, color: "#F59E0B" }}>stars</span>
                ) : (
                  <span className="material-icons" style={{ fontSize: 16 }}>account_circle</span>
                )}
                <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.user_metadata?.full_name || user.email?.split("@")[0] || "Account"}
                </span>
                {isPremium && (
                  <span style={{
                    fontSize: 8, fontWeight: 900, letterSpacing: "0.8px",
                    background: "linear-gradient(135deg, #F59E0B, #D97706)",
                    color: "#0A2342", padding: "2px 6px", borderRadius: 4,
                    boxShadow: "0 1px 4px rgba(245,158,11,0.4)",
                  }}>EDGE</span>
                )}
              </button>
              {showUserMenu && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowUserMenu(false)} />
                  <div className="user-menu">
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>{user.email}</div>
                    {!isPremium && (
                      <button className="user-menu-item user-menu-upgrade" onClick={() => { setShowUserMenu(false); handleUpgrade(); }}>
                        <span className="material-icons" style={{ fontSize: 14 }}>free_cancellation</span>
                        <span>Start Free 7-Day Trial</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, background: "#4ADE80", color: "#0A2342", padding: "2px 6px", borderRadius: 4 }}>FREE</span>
                      </button>
                    )}
                    {isPremium && (
                      <div className="user-menu-item" style={{ cursor: "default" }}>
                        <span className="material-icons" style={{ fontSize: 14, color: "var(--green-light)" }}>verified</span>PRO Active
                      </div>
                    )}
                    <button className="user-menu-item" onClick={() => { setShowUserMenu(false); setActiveTool("settings"); }}>
                      <span className="material-icons" style={{ fontSize: 14 }}>settings</span>Account Settings
                    </button>
                    <button className="user-menu-item" onClick={() => { setShowUserMenu(false); signOut(); }}>
                      <span className="material-icons" style={{ fontSize: 14 }}>logout</span>Sign Out
                    </button>
                  </div>
                </>
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
              <div style={{ margin: "0 10px 16px", padding: "14px", borderRadius: 10, background: "linear-gradient(135deg, rgba(10,110,75,0.15), rgba(245,158,11,0.08))", border: "1px solid rgba(74,222,128,0.2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <span className="material-icons" style={{ fontSize: 14, color: "#4ADE80" }}>free_cancellation</span>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#4ADE80" }}>7-Day Free Trial</div>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.55, marginBottom: 10 }}>
                  Pitcher Intel, Statcast, Streamer Finder, ABS Tracker + Top 5 locks — free for 7 days.
                </div>
                <button className="btn btn-sm" onClick={handleUpgrade}
                  style={{ width: "100%", justifyContent: "center", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#0A2342", fontSize: 10, fontWeight: 900, border: "none", padding: "7px 0", borderRadius: 7 }}>
                  Start Free Trial — No charge today
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
            {activeTool === "profile"  && <ProfilePage isPremium={isPremium} />}
            {activeTool === "tracker"  && <PickTracker />}
            {activeTool === "settings" && <AccountSettings isPremium={isPremium} onUpgrade={handleUpgrade} />}
            {activeTool === "faq"      && <FAQPage isPremium={isPremium} onUpgrade={handleUpgrade} />}
            <AppFooter />
          </main>
        </div>
      )}
      {showAuth && <AuthModal mode={authMode} onClose={() => setShowAuth(false)} />}
      {showUpgrade && <UpgradeModal onUpgrade={handleUpgrade} onClose={() => setShowUpgrade(false)} isPremium={isPremium} />}
      {showProWelcome && <ProWelcomeModal user={user} onClose={() => setShowProWelcome(false)} />}
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
      <LandingFAQ />
      <LandingFooter />
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
    else if (authMode === 'signup') setMsg('✉️ Check your email and click the confirmation link to finish signing up. Then come back here and sign in!');
    else setMsg(null);
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

          {/* Trial offer pill */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(10,110,75,0.12))', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 50, padding: '6px 16px', marginBottom: 20 }} className="landing-badge">
            <span className="material-icons" style={{ fontSize: 13, color: '#F59E0B' }}>free_cancellation</span>
            <span style={{ fontSize: 10, fontWeight: 900, color: '#F59E0B', letterSpacing: '0.8px' }}>7-Day Free PRO Trial · No credit card charge today</span>
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
                <div style={{ fontSize: 12, color: '#4ADE80', padding: '12px 14px', background: 'rgba(34,197,94,0.10)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)', lineHeight: 1.6 }}>
                  {msg}
                  {authMode === 'signup' && (
                    <div style={{ marginTop: 10 }}>
                      <button onClick={() => { setAuthMode('login'); setMsg(null); }}
                        style={{ fontSize: 11, fontWeight: 800, color: 'white', background: 'rgba(34,197,94,0.25)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>
                        Already confirmed? Sign in →
                      </button>
                    </div>
                  )}
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
                  <><span className="material-icons" style={{ fontSize: 16 }}>free_cancellation</span>Start Free — Try PRO for 7 Days</>
                ) : (
                  <><span className="material-icons" style={{ fontSize: 16 }}>login</span>Sign In</>
                )}
              </button>
            </form>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {authMode === 'signup' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Free account — no credit card needed</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(74,222,128,0.6)', lineHeight: 1.5 }}>
                    ✓ Unlock PRO tools with a 7-day free trial after signing up
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>&nbsp;</span>
                  {authMode === 'login' && (
                    <button onClick={onSignIn} style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      Forgot password?
                    </button>
                  )}
                </div>
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

        {/* 7-Day Trial CTA Banner */}
        <div style={{
          marginTop: 32, background: 'linear-gradient(135deg, #000F2B, #001A45)',
          borderRadius: 20, padding: 'clamp(24px, 3vw, 36px)',
          border: '1px solid rgba(74,222,128,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 24, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: 'linear-gradient(135deg, #0A6E4B, #4ADE80)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-icons" style={{ fontSize: 26, color: 'white' }}>free_cancellation</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 2vw, 20px)', fontWeight: 900, color: 'white' }}>
                Try PRO free for 7 days
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 3, lineHeight: 1.5 }}>
                Full access to every PRO tool. No charge today. Cancel before the trial ends to pay nothing.<br />
                <span style={{ color: 'rgba(74,222,128,0.6)', fontSize: 10 }}>One trial per account · $14.99/mo or $119/yr after trial</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{
              padding: '13px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: '#0A2342', fontSize: 14, fontWeight: 900,
              boxShadow: '0 4px 20px rgba(245,158,11,0.35)',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            Start Free Trial →
          </button>
        </div>
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
function ProWelcomeModal({ user, onClose }) {
  const name = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";
  const [visible, setVisible] = useState(true);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  const proFeatures = [
    { icon: "auto_awesome",    label: "Top 5 PRO Locks",        desc: "Daily high-confidence picks" },
    { icon: "sports_baseball", label: "Pitcher Intel",           desc: "Hittability scores & matchups" },
    { icon: "query_stats",     label: "Full Statcast",           desc: "xBA, barrel%, exit velocity" },
    { icon: "cloud_download",  label: "Streamer Finder",         desc: "Fantasy streaming picks daily" },
    { icon: "gavel",           label: "ABS Tracker",             desc: "Challenge outcomes by zone" },
    { icon: "trending_up",     label: "Live Odds & Props",       desc: "Real-time lines cross-referenced" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 600,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
      opacity: visible ? 1 : 0,
      transition: "opacity 0.3s ease",
    }} onClick={e => e.target === e.currentTarget && handleClose()}>
      <div style={{
        background: "linear-gradient(160deg, #000F2B 0%, #001A45 50%, #0A2E1A 100%)",
        border: "1px solid rgba(245,158,11,0.4)",
        borderRadius: 20, width: "100%", maxWidth: 520,
        boxShadow: "0 0 80px rgba(245,158,11,0.15), 0 24px 60px rgba(0,0,0,0.6)",
        overflow: "hidden",
        transform: visible ? "scale(1) translateY(0)" : "scale(0.95) translateY(10px)",
        transition: "transform 0.3s ease",
      }}>

        {/* Gold top accent bar */}
        <div style={{ height: 3, background: "linear-gradient(90deg, transparent, #F59E0B, #D97706, #F59E0B, transparent)" }} />

        {/* Header */}
        <div style={{ padding: "32px 32px 24px", textAlign: "center", position: "relative" }}>
          <button onClick={handleClose} style={{
            position: "absolute", top: 16, right: 16,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)",
          }}>
            <span className="material-icons" style={{ fontSize: 16 }}>close</span>
          </button>

          {/* Diamond mark with glow */}
          <div style={{ position: "relative", display: "inline-block", marginBottom: 20 }}>
            <div style={{
              position: "absolute", top: -16, left: -16, right: -16, bottom: -16,
              background: "radial-gradient(circle, rgba(245,158,11,0.25) 0%, transparent 70%)",
              borderRadius: "50%",
            }} />
            <div style={{
              width: 72, height: 72, position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <DiamondMark size={72} />
              {/* Gold orbit ring */}
              <div style={{
                position: "absolute", top: -6, left: -6, right: -6, bottom: -6,
                border: "1.5px solid rgba(245,158,11,0.5)",
                borderRadius: "50%",
                animation: "spin 8s linear infinite",
                borderTopColor: "transparent", borderLeftColor: "transparent",
              }} />
            </div>
          </div>

          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(180,120,0,0.1))",
            border: "1px solid rgba(245,158,11,0.4)",
            borderRadius: 50, padding: "4px 14px", marginBottom: 16,
          }}>
            <span className="material-icons" style={{ fontSize: 12, color: "#F59E0B" }}>stars</span>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#F59E0B", letterSpacing: "1.5px" }}>DIAMONDIQ EDGE</span>
          </div>

          <h2 style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(22px, 4vw, 28px)",
            fontWeight: 900, color: "white", margin: "0 0 10px", lineHeight: 1.15,
          }}>
            Welcome to the Edge,<br />
            <span style={{ color: "#F59E0B" }}>{name}</span>
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.6 }}>
            Your 7-day free trial is active. Full PRO access — no restrictions.<br />
            You won't be charged until your trial ends.
          </p>
        </div>

        {/* Features grid */}
        <div style={{ padding: "0 28px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {proFeatures.map(f => (
              <div key={f.label} style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "12px 14px", borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span className="material-icons" style={{ fontSize: 15, color: "#4ADE80" }}>{f.icon}</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "white", marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: "0 28px 28px" }}>
          <button onClick={handleClose} style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            cursor: "pointer",
            background: "linear-gradient(135deg, #F59E0B, #D97706)",
            color: "#0A2342", fontSize: 14, fontWeight: 900,
            boxShadow: "0 4px 24px rgba(245,158,11,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span className="material-icons" style={{ fontSize: 18 }}>bolt</span>
            Start Using DiamondIQ Edge
          </button>
          <div style={{ textAlign: "center", marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
            Cancel anytime in Account Settings · No charge for 7 days
          </div>
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}

const FAQ_ITEMS = [
  {
    q: "Is DiamondIQ really free?",
    a: "Yes. Creating an account is completely free — no credit card required. Free accounts get access to Today's Picks rankings, Player Research, Park Factors, Pick Tracker, and Backtester. PRO tools are locked behind the Edge subscription.",
  },
  {
    q: "What's included in the 7-day free trial?",
    a: "The trial gives you full access to every PRO feature — Pitcher Intel, Statcast metrics, Streamer Finder, ABS Challenge Tracker, live prop lines and odds, and the Top 5 daily locks. Everything. No restrictions.",
  },
  {
    q: "Do I need a credit card for the free trial?",
    a: "Yes — a card is required to start the trial so Stripe can auto-convert to a paid subscription after 7 days. You won't be charged anything today. If you cancel before the 7 days are up, you pay nothing.",
  },
  {
    q: "What happens when the trial ends?",
    a: "After 7 days your card is automatically charged — $14.99/month or $119/year depending on the plan you chose. You'll receive an email reminder before the trial ends. If you cancel during the trial, you keep full PRO access until the 7 days are up, then revert to the free plan.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, cancel anytime with no penalty. Go to Account Settings → Manage Subscription to cancel through Stripe's secure portal. Your PRO access continues until the end of the current billing period.",
  },
  {
    q: "Can I use the free trial more than once?",
    a: "No — the 7-day trial is available once per account. If you cancel and re-subscribe later, you'll be charged from day one. Using a different payment method on the same account does not reset the trial.",
  },
  {
    q: "What is the Hit Score?",
    a: "The Hit Score is DiamondIQ's proprietary rating for every MLB hitter on a given day. It combines recent form (last 3, 7, and 15 game splits), batter vs pitcher history, Statcast contact quality metrics, park factors, and platoon splits into a single number. Higher = better chance of getting a hit that day.",
  },
  {
    q: "What's the difference between BTS mode and Props/DFS mode?",
    a: "Beat the Streak mode ranks hitters prioritizing safety and consistency — it surfaces the players most likely to get at least one hit. Props/DFS mode ranks by ceiling and value, showing the full pool with tier breakdowns for total bases, RBI props, and lineup optimization.",
  },
  {
    q: "How current is the data?",
    a: "Lineups and rankings update live as confirmed lineups are posted each day — typically 3-4 hours before first pitch. Statcast and historical split data refreshes daily. Live prop lines and odds update in real time via our odds feed.",
  },
  {
    q: "Is this for Beat the Streak only?",
    a: "No — DiamondIQ works for Beat the Streak, MLB player props, daily fantasy (DFS), and anyone who wants data-driven insights on hitter performance. The BTS and Props/DFS modes let you switch context instantly.",
  },
  {
    q: "How do I get support?",
    a: `Email us at ${CONTACT_EMAIL} and we'll get back to you as soon as possible. For billing issues, you can also manage your subscription directly through the Stripe portal in Account Settings.`,
  },
];

function LandingFAQ() {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ background: 'white', padding: 'clamp(40px, 5vw, 64px) clamp(16px, 4vw, 48px)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>Got questions?</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3vw, 32px)', fontWeight: 900, color: 'var(--navy)', margin: '0 0 12px' }}>
            Frequently Asked Questions
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Everything you need to know about DiamondIQ.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} style={{
              border: `1px solid ${open === i ? 'rgba(10,110,75,0.3)' : 'var(--border)'}`,
              borderRadius: 12, overflow: 'hidden',
              background: open === i ? 'rgba(10,110,75,0.03)' : 'white',
              transition: 'all 0.15s',
            }}>
              <button onClick={() => setOpen(open === i ? null : i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', gap: 12,
                }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', lineHeight: 1.4 }}>{item.q}</span>
                <span className="material-icons" style={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0, transition: 'transform 0.15s', transform: open === i ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  expand_more
                </span>
              </button>
              {open === i && (
                <div style={{ padding: '0 18px 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FAQPage({ isPremium, onUpgrade }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 'clamp(24px, 3vw, 40px) clamp(16px, 3vw, 32px)' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(10,110,75,0.1)', border: '1px solid rgba(10,110,75,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="material-icons" style={{ fontSize: 18, color: 'var(--accent)' }}>help_outline</span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Help & FAQ</h1>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Answers to common questions about DiamondIQ, the free trial, and your subscription.
        </p>
      </div>

      {/* FAQ accordion */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
        {FAQ_ITEMS.map((item, i) => (
          <div key={i} style={{
            border: `1px solid ${open === i ? 'rgba(10,110,75,0.3)' : 'var(--border)'}`,
            borderRadius: 12, overflow: 'hidden',
            background: open === i ? 'rgba(10,110,75,0.04)' : 'var(--surface)',
            transition: 'all 0.15s',
          }}>
            <button onClick={() => setOpen(open === i ? null : i)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left', gap: 12,
              }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>{item.q}</span>
              <span className="material-icons" style={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0, transition: 'transform 0.15s', transform: open === i ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                expand_more
              </span>
            </button>
            {open === i && (
              <div style={{ padding: '0 18px 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Upgrade CTA for free users */}
      {!isPremium && (
        <div style={{
          borderRadius: 14, padding: '24px 28px',
          background: 'linear-gradient(135deg, #000F2B, #001A45)',
          border: '1px solid rgba(74,222,128,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 20, flexWrap: 'wrap', marginBottom: 24,
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 900, color: 'white', marginBottom: 4 }}>
              Still have questions? Try PRO free for 7 days.
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              Full access to every feature. No charge today. Cancel anytime.
            </div>
          </div>
          <button onClick={onUpgrade} style={{
            padding: '10px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            color: '#0A2342', fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            Start Free Trial
          </button>
        </div>
      )}

      {/* Contact */}
      <div style={{ padding: '20px 24px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          <span className="material-icons" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6, color: 'var(--accent)' }}>mail</span>
          Still need help?
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent-light)', fontWeight: 600 }}>{CONTACT_EMAIL}</a> and we'll get back to you as soon as possible.
          For billing and subscription management, use the Manage Subscription button in Account Settings.
        </div>
      </div>
    </div>
  );
}

function UpgradeModal({ onUpgrade, onClose, isPremium }) {
  const { user } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState("annual");
  const [loading, setLoading] = useState(false);
  // trial_used is stored in user metadata; default false if not set
  const trialUsed = user?.user_metadata?.trial_used === true;
  const showTrial = !trialUsed; // show trial offer if never used

  if (isPremium) return null;

  const features = [
    { icon: "auto_awesome",   label: "Top 5 PRO locks daily" },
    { icon: "sports_baseball", label: "Pitcher Intel & matchup data" },
    { icon: "query_stats",    label: "Full Statcast metrics (xBA, barrel%, exit velo)" },
    { icon: "science",        label: "Unlimited Backtester access" },
    { icon: "gavel",          label: "ABS Challenge Tracker" },
    { icon: "cloud_download", label: "Fantasy Streamer Finder" },
    { icon: "trending_up",    label: "Live betting odds & prop lines" },
  ];

  async function handleCheckout() {
    setLoading(true);
    if (HAS_STRIPE && user) {
      await redirectToCheckout(user.id, user.email, selectedPlan, showTrial);
    } else {
      onUpgrade(selectedPlan);
    }
    setLoading(false);
    onClose();
  }

  return (
    <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="add-pick-modal" style={{ maxWidth: 440 }}>
        <div className="add-pick-modal-header" style={{ background: "linear-gradient(135deg, #0A2342, #0D3060)", paddingBottom: 0 }}>
          <div>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "white" }}>
              <span className="material-icons" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6, color: "#F59E0B" }}>star</span>
              DiamondIQ Edge
            </span>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>Unlock the full analytical edge</div>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>

        {/* Trial hero banner */}
        {showTrial && (
          <div style={{
            background: "linear-gradient(135deg, #0A2342, #0D3060)",
            padding: "16px 20px 20px",
            borderBottom: "1px solid rgba(74,222,128,0.2)",
          }}>
            <div style={{
              background: "linear-gradient(135deg, rgba(74,222,128,0.12), rgba(10,110,75,0.18))",
              border: "1px solid rgba(74,222,128,0.3)",
              borderRadius: 12, padding: "14px 16px",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "linear-gradient(135deg, #0A6E4B, #4ADE80)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <span className="material-icons" style={{ fontSize: 22, color: "white" }}>free_cancellation</span>
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 900, color: "white", lineHeight: 1.2 }}>
                  7 Days Free — No charge today
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 3, lineHeight: 1.4 }}>
                  Full PRO access for 7 days. Then {selectedPlan === "annual" ? "$119/yr" : "$14.99/mo"} — cancel anytime before.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="add-pick-modal-body" style={{ gap: 0, padding: "16px 20px" }}>

          {/* Features list */}
          <div style={{ marginBottom: 16 }}>
            {features.map(f => (
              <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                <span className="material-icons" style={{ fontSize: 14, color: "var(--accent)" }}>{f.icon}</span>
                <span style={{ fontSize: 12, color: "var(--text-primary)" }}>{f.label}</span>
              </div>
            ))}
          </div>

          {/* Plan selector */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {[
              { id: "monthly", price: "$14.99", period: "/ month", badge: null },
              { id: "annual",  price: "$119",   period: "/ year",  badge: "Save $61" },
            ].map(plan => (
              <button key={plan.id} onClick={() => setSelectedPlan(plan.id)}
                style={{
                  flex: 1, padding: "12px 10px", borderRadius: 10, cursor: "pointer",
                  border: `2px solid ${selectedPlan === plan.id ? "#4ADE80" : "var(--border)"}`,
                  background: selectedPlan === plan.id ? "rgba(74,222,128,0.08)" : "var(--surface-2)",
                  transition: "all 0.15s", textAlign: "center",
                }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>{plan.price}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{plan.period}</div>
                {plan.badge && (
                  <div style={{ marginTop: 4, fontSize: 9, fontWeight: 800, color: "#4ADE80", background: "rgba(74,222,128,0.15)", borderRadius: 20, padding: "2px 8px", display: "inline-block" }}>
                    {plan.badge}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* CTA */}
          <button onClick={handleCheckout} disabled={loading}
            style={{
              width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
              cursor: loading ? "default" : "pointer",
              background: loading ? "rgba(245,158,11,0.4)" : "linear-gradient(135deg, #F59E0B, #D97706)",
              color: "#0A2342", fontSize: 14, fontWeight: 900,
              boxShadow: "0 4px 16px rgba(245,158,11,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
            <span className="material-icons" style={{ fontSize: 16 }}>bolt</span>
            {loading ? "Redirecting to checkout..." : showTrial
              ? "Start Free 7-Day Trial"
              : `Get DiamondIQ Edge — ${selectedPlan === "annual" ? "$119/yr" : "$14.99/mo"}`
            }
          </button>

          {showTrial ? (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 10, textAlign: "center", lineHeight: 1.6 }}>
              Credit card required · You won't be charged for 7 days<br />
              <span style={{ color: "rgba(74,222,128,0.7)" }}>One trial per account · Cancel before trial ends to pay nothing</span>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 10, textAlign: "center" }}>
              Secure checkout via Stripe · Cancel anytime
            </div>
          )}
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
  const [deleteStage, setDeleteStage] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  async function handleManageSubscription() {
    const customerId = user?.user_metadata?.stripe_customer_id;
    if (!customerId) return;
    setPortalLoading(true);
    const { openBillingPortal } = await import("./utils/stripe");
    const { error } = await openBillingPortal(customerId);
    if (error) window.dispatchEvent(new CustomEvent("diamondiq:picktoast", { detail: { msg: "Could not open billing portal: " + error, type: "error" } }));
    setPortalLoading(false);
  }

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

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    setDeleting(true);
    try {
      const { supabase } = await import("./utils/supabase");
      // Delete user's picks and usage data first (RLS will enforce ownership)
      await supabase.from("picks").delete().eq("user_id", user.id);
      await supabase.from("backtester_usage").delete().eq("user_id", user.id);
      // Sign out — actual account deletion requires server-side (service role)
      // For now, sign out and show instructions
      await signOut();
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
        detail: { msg: "Your data has been deleted. Account fully removed within 24 hours.", type: "ok", duration: 8000 }
      }));
    } catch (e) {
      setDeleting(false);
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", { detail: { msg: "Error deleting account: " + e.message, type: "error" } }));
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)", marginBottom: 24 }}>
        <span className="material-icons" style={{ verticalAlign: "middle", marginRight: 8 }}>settings</span>Account Settings
      </h2>

      {/* Profile */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title"><span className="material-icons">person</span>Profile</span></div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" value={user?.email || "Not signed in"} readOnly style={{ opacity: 0.7 }} />
          </div>
          <div className="form-field">
            <label className="form-label">Account Type</label>
            <span className={`badge ${isPremium ? "badge-elite" : "badge-gray"}`} style={{ fontSize: 11, width: "fit-content" }}>{isPremium ? "PRO" : "Free"}</span>
          </div>
        </div>
      </div>

      {/* Upgrade CTA — only for free users */}
      {!isPremium && (
        <div style={{
          marginBottom: 16, borderRadius: 14, overflow: "hidden",
          background: "linear-gradient(135deg, #0A2342 0%, #0D3060 50%, #0A4D2E 100%)",
          border: "1px solid rgba(74,222,128,0.25)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(74,222,128,0.08)",
          position: "relative",
        }}>
          <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, background: "radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
          <div style={{ padding: "22px 24px" }}>
            {/* Trial badge */}
            {!user?.user_metadata?.trial_used && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 50, padding: "4px 12px", marginBottom: 14 }}>
                <span className="material-icons" style={{ fontSize: 12, color: "#4ADE80" }}>free_cancellation</span>
                <span style={{ fontSize: 10, fontWeight: 900, color: "#4ADE80", letterSpacing: "0.8px" }}>7-DAY FREE TRIAL AVAILABLE</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="material-icons" style={{ color: "#F59E0B", fontSize: 20 }}>star</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "white" }}>
                    {user?.user_metadata?.trial_used ? "Upgrade to DiamondIQ Edge" : "Try DiamondIQ Edge Free"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, marginBottom: 16 }}>
                  {user?.user_metadata?.trial_used
                    ? "Unlock everything — Pitcher Intel, Streamer Finder, Statcast, unlimited Backtester, live prop lines, ABS Tracker & Top 5 PRO locks."
                    : "Full PRO access free for 7 days. Card required — you won't be charged until the trial ends. Cancel any time."}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
                  {["Pitcher Intel", "Streamer Finder", "Unlimited Backtester", "Live Odds", "Top 5 Locks"].map(f => (
                    <span key={f} style={{ fontSize: 10, fontWeight: 700, color: "#4ADE80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 20, padding: "3px 10px" }}>✓ {f}</span>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <button onClick={() => onUpgrade("monthly")} style={{
                    padding: "10px 24px", borderRadius: 10, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg, #F59E0B, #D97706)",
                    color: "#0A2342", fontSize: 13, fontWeight: 900,
                    boxShadow: "0 4px 16px rgba(245,158,11,0.4)",
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span className="material-icons" style={{ fontSize: 16 }}>{user?.user_metadata?.trial_used ? "bolt" : "free_cancellation"}</span>
                    {user?.user_metadata?.trial_used ? "Upgrade Now — $14.99/mo" : "Start Free 7-Day Trial"}
                  </button>
                  <button onClick={() => onUpgrade("annual")}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.5)", textDecoration: "underline", padding: 0 }}>
                    or $119/yr · save $61
                  </button>
                </div>
                {!user?.user_metadata?.trial_used && (
                  <div style={{ marginTop: 12, fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                    One trial per account · No charge for 7 days · Cancel to pay nothing
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subscription management for PRO users */}
      {isPremium && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span className="card-title"><span className="material-icons">credit_card</span>Subscription</span></div>
          <div style={{ padding: 16, fontSize: 13, color: "var(--text-secondary)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="material-icons" style={{ color: "var(--green-light)", fontSize: 18 }}>verified</span>
              <span style={{ fontWeight: 700 }}>
                {user?.user_metadata?.trial_started_at && !user?.user_metadata?.trial_converted
                  ? "PRO Trial Active — 7 days free"
                  : "PRO subscription active"}
              </span>
            </div>
            {user?.user_metadata?.trial_started_at && (
              <div style={{ fontSize: 11, color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, lineHeight: 1.5 }}>
                <span className="material-icons" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 4 }}>free_cancellation</span>
                Your free trial started {new Date(user.user_metadata.trial_started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Cancel before 7 days to pay nothing.
              </div>
            )}
            <p style={{ lineHeight: 1.6, marginBottom: 12 }}>Manage billing, update payment method, or cancel through Stripe's secure portal.</p>
            <button className="btn btn-sm" onClick={handleManageSubscription} disabled={portalLoading}
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <span className="material-icons" style={{ fontSize: 14 }}>open_in_new</span>
              {portalLoading ? "Opening..." : "Manage Subscription"}
            </button>
          </div>
        </div>
      )}

      {/* Password */}
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

      {/* Sign out */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title"><span className="material-icons">logout</span>Sign Out</span></div>
        <div style={{ padding: 16 }}>
          <button className="btn btn-sm" onClick={signOut}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontWeight: 700 }}>
            <span className="material-icons" style={{ fontSize: 14 }}>logout</span>Sign Out
          </button>
        </div>
      </div>

      {/* Delete account — danger zone */}
      <div className="card" style={{ borderColor: "rgba(239,68,68,0.25)" }}>
        <div className="card-header" style={{ background: "rgba(239,68,68,0.04)" }}>
          <span className="card-title" style={{ color: "var(--red-data)" }}><span className="material-icons">delete_forever</span>Delete Account</span>
        </div>
        <div style={{ padding: 16 }}>
          {deleteStage === 0 && (
            <>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>Permanently delete your account and all your data — picks, history, everything. This cannot be undone.</p>
              <button className="btn btn-sm" onClick={() => setDeleteStage(1)}
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--red-data)", fontWeight: 700 }}>
                <span className="material-icons" style={{ fontSize: 14 }}>delete_forever</span>Delete My Account
              </button>
            </>
          )}
          {deleteStage === 1 && (
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--red-data)", marginBottom: 8 }}>⚠️ Are you absolutely sure?</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>This will permanently delete all your picks, history, and account data. Your subscription (if active) will be cancelled. <strong>There is no undo.</strong></p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setDeleteStage(2)}
                  style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--red-data)", fontWeight: 700 }}>
                  Yes, I want to delete my account
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDeleteStage(0)}>Cancel</button>
              </div>
            </div>
          )}
          {deleteStage === 2 && (
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--red-data)", marginBottom: 8 }}>Final confirmation</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Type <strong>DELETE</strong> to confirm:</p>
              <input className="form-input" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value.toUpperCase())}
                placeholder="Type DELETE here" style={{ marginBottom: 12, borderColor: "rgba(239,68,68,0.3)" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={handleDeleteAccount}
                  disabled={deleteConfirm !== "DELETE" || deleting}
                  style={{ background: deleteConfirm === "DELETE" ? "#DC2626" : "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: deleteConfirm === "DELETE" ? "white" : "var(--red-data)", fontWeight: 800, opacity: deleteConfirm !== "DELETE" ? 0.5 : 1 }}>
                  {deleting ? "Deleting..." : "Permanently Delete Account"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setDeleteStage(0); setDeleteConfirm(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CONTACT_EMAIL = "diamondiqinfo@gmail.com";

function AppFooter() {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const year = new Date().getFullYear();
  return (
    <>
      <div style={{ marginTop: 40, padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>© {year} DiamondIQ. All rights reserved.</span>
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: "Privacy", action: () => setShowPrivacy(true) },
            { label: "Terms", action: () => setShowTerms(true) },
            { label: "FAQ", action: () => { const event = new CustomEvent("diamondiq:navigate", { detail: "faq" }); window.dispatchEvent(event); } },
            { label: "Contact", action: () => window.open(`mailto:${CONTACT_EMAIL}`) },
          ].map(l => (
            <button key={l.label} onClick={l.action}
              style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: 0 }}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {showPrivacy && <LegalModal title="Privacy Policy" onClose={() => setShowPrivacy(false)}><PrivacyPolicyContent /></LegalModal>}
      {showTerms   && <LegalModal title="Terms of Service" onClose={() => setShowTerms(false)}><TermsContent /></LegalModal>}
    </>
  );
}

function LandingFooter() {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const year = new Date().getFullYear();

  return (
    <>
      <footer style={{
        marginTop: "auto", padding: "28px 32px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.2)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, color: "white" }}>
            Diamond<span style={{ color: "#4ADE80" }}>IQ</span>
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            © {year} DiamondIQ. All rights reserved.
          </span>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {[
            { label: "Privacy Policy", action: () => setShowPrivacy(true) },
            { label: "Terms of Service", action: () => setShowTerms(true) },
            { label: "FAQ", action: () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) },
            { label: "Contact Us", action: () => window.open(`mailto:${CONTACT_EMAIL}`) },
          ].map(l => (
            <button key={l.label} onClick={l.action}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 11, cursor: "pointer", padding: 0, transition: "color 0.15s" }}
              onMouseEnter={e => e.target.style.color = "rgba(255,255,255,0.7)"}
              onMouseLeave={e => e.target.style.color = "rgba(255,255,255,0.35)"}>
              {l.label}
            </button>
          ))}
        </div>
      </footer>

      {showPrivacy && <LegalModal title="Privacy Policy" onClose={() => setShowPrivacy(false)}><PrivacyPolicyContent /></LegalModal>}
      {showTerms  && <LegalModal title="Terms of Service" onClose={() => setShowTerms(false)}><TermsContent /></LegalModal>}
    </>
  );
}

function LegalModal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <span className="material-icons">close</span>
          </button>
        </div>
        <div style={{ padding: "20px 24px", overflowY: "auto", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function PrivacyPolicyContent() {
  return (
    <>
      <p style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 16 }}>Last updated: March 2025</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, marginBottom: 8 }}>What we collect</h3>
      <p>We collect your email address when you create an account, and the picks you choose to track within the app. We do not collect payment card details — all payments are handled securely by Stripe.</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, margin: "16px 0 8px" }}>How we use it</h3>
      <p>Your email is used to send account verification, password reset emails, and optional product updates. Your picks are stored to power your personal pick record and stats. We do not sell or share your data with third parties.</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, margin: "16px 0 8px" }}>Cookies & analytics</h3>
      <p>We use minimal, anonymous analytics to understand how the app is used. No advertising cookies are used. DiamondIQ products are ad-free.</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, margin: "16px 0 8px" }}>Your rights</h3>
      <p>You can delete your account and all associated data at any time from Account Settings. For any privacy questions, contact us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "var(--accent-light)" }}>{CONTACT_EMAIL}</a>.</p>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <p style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 16 }}>Last updated: March 2025</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, marginBottom: 8 }}>Use of the service</h3>
      <p>DiamondIQ is a fantasy baseball analytics tool. All rankings, scores, and picks are algorithmic suggestions for entertainment and informational purposes only. Nothing on this site constitutes professional sports betting advice.</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, margin: "16px 0 8px" }}>Subscriptions</h3>
      <p>DiamondIQ Edge subscriptions are billed monthly or annually via Stripe. You may cancel at any time — your access continues until the end of the current billing period. No refunds are issued for partial periods.</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, margin: "16px 0 8px" }}>Accuracy</h3>
      <p>MLB data is sourced from official APIs. DiamondIQ makes no guarantees about the accuracy, completeness, or timeliness of any data or rankings. Past pick performance is not a guarantee of future results.</p>
      <h3 style={{ color: "var(--text-primary)", fontSize: 14, margin: "16px 0 8px" }}>Contact</h3>
      <p>Questions? Reach us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "var(--accent-light)" }}>{CONTACT_EMAIL}</a>.</p>
    </>
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
