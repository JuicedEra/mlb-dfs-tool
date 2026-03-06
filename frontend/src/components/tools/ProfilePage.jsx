import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { dbLoadPicks, dbLoadLeaderboardDays, supabase } from "../../utils/supabase";
import { LeaderboardSummary } from "./Leaderboard";

const CURRENT_SEASON = new Date().getFullYear();

// ── Achievement definitions ────────────────────────────────────────────────
export const ACHIEVEMENTS = [
  // Correct picks
  { id: "rookie",      cat: "picks", name: "Rookie",        threshold: 1,    description: "First correct pick",            emoji: "⚾", color: "#94A3B8", bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.3)" },
  { id: "prospect",    cat: "picks", name: "Hot Prospect",   threshold: 5,    description: "5 correct picks",               emoji: "🔥", color: "#60A5FA", bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.3)"  },
  { id: "allstar",     cat: "picks", name: "All-Star",       threshold: 10,   description: "10 correct picks",              emoji: "⭐", color: "#F59E0B", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)"  },
  { id: "veteran",     cat: "picks", name: "Veteran",        threshold: 25,   description: "25 correct picks",              emoji: "🏆", color: "#C084FC", bg: "rgba(192,132,252,0.15)", border: "rgba(192,132,252,0.3)" },
  { id: "legend",      cat: "picks", name: "Legend",         threshold: 50,   description: "50 correct picks",              emoji: "💎", color: "#4ADE80", bg: "rgba(74,222,128,0.15)",  border: "rgba(74,222,128,0.3)"  },
  { id: "diamond",     cat: "picks", name: "Diamond Elite",  threshold: 100,  description: "100 correct picks",             emoji: "💠", color: "#38BDF8", bg: "rgba(56,189,248,0.15)",  border: "rgba(56,189,248,0.3)"  },
  { id: "centurion",   cat: "picks", name: "Centurion",      threshold: 250,  description: "250 correct picks",             emoji: "🦅", color: "#F97316", bg: "rgba(249,115,22,0.15)",  border: "rgba(249,115,22,0.3)"  },
  { id: "grandmaster", cat: "picks", name: "Grand Master",   threshold: 500,  description: "500 correct picks",             emoji: "👑", color: "#EAB308", bg: "rgba(234,179,8,0.15)",   border: "rgba(234,179,8,0.3)"   },
  { id: "immortal",    cat: "picks", name: "Immortal",       threshold: 1000, description: "1000 correct picks",            emoji: "🌟", color: "#E879F9", bg: "rgba(232,121,249,0.15)", border: "rgba(232,121,249,0.3)" },
  // Streaks (career high)
  { id: "streak3",     cat: "streak", name: "On Fire",       threshold: 3,    description: "3-game win streak",             emoji: "🔥", color: "#FB923C", bg: "rgba(251,146,60,0.15)",  border: "rgba(251,146,60,0.3)"  },
  { id: "streak5",     cat: "streak", name: "Hot Hand",      threshold: 5,    description: "5-game win streak",             emoji: "🌶️", color: "#EF4444", bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.3)"   },
  { id: "streak10",    cat: "streak", name: "Unstoppable",   threshold: 10,   description: "10-game win streak",            emoji: "⚡", color: "#FBBF24", bg: "rgba(251,191,36,0.15)",  border: "rgba(251,191,36,0.3)"  },
  { id: "streak15",    cat: "streak", name: "Elite Caller",  threshold: 15,   description: "15-game win streak",            emoji: "🎯", color: "#34D399", bg: "rgba(52,211,153,0.15)",  border: "rgba(52,211,153,0.3)"  },
  { id: "streak20",    cat: "streak", name: "Machine",       threshold: 20,   description: "20-game win streak",            emoji: "🤖", color: "#60A5FA", bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.3)"  },
  { id: "streak25",    cat: "streak", name: "Godlike",       threshold: 25,   description: "25-game win streak",            emoji: "⚾", color: "#A78BFA", bg: "rgba(167,139,250,0.15)", border: "rgba(167,139,250,0.3)" },
  { id: "streak30",    cat: "streak", name: "Legendary",     threshold: 30,   description: "30-game win streak",            emoji: "🏅", color: "#F472B6", bg: "rgba(244,114,182,0.15)", border: "rgba(244,114,182,0.3)" },
  { id: "streak35",    cat: "streak", name: "Untouchable",   threshold: 35,   description: "35-game win streak",            emoji: "🔮", color: "#38BDF8", bg: "rgba(56,189,248,0.15)",  border: "rgba(56,189,248,0.3)"  },
  { id: "streak40",    cat: "streak", name: "Mythic",        threshold: 40,   description: "40-game win streak",            emoji: "🌠", color: "#4ADE80", bg: "rgba(74,222,128,0.15)",  border: "rgba(74,222,128,0.3)"  },
  { id: "streak45",    cat: "streak", name: "Transcendent",  threshold: 45,   description: "45-game win streak",            emoji: "✨", color: "#FDE68A", bg: "rgba(253,230,138,0.15)", border: "rgba(253,230,138,0.3)" },
  { id: "streak50",    cat: "streak", name: "Hall of Fame",  threshold: 50,   description: "50-game win streak",            emoji: "🏆", color: "#F59E0B", bg: "rgba(245,158,11,0.2)",   border: "rgba(245,158,11,0.4)"  },
  { id: "streak55",    cat: "streak", name: "Immortal Streak",threshold: 55,  description: "55-game win streak",            emoji: "💠", color: "#E879F9", bg: "rgba(232,121,249,0.2)",  border: "rgba(232,121,249,0.4)" },
  { id: "streak57",    cat: "streak", name: "DiamondIQ GOAT",threshold: 57,   description: "57-game streak — never done before",emoji: "💰", color: "#FFD700", bg: "rgba(255,215,0,0.2)", border: "rgba(255,215,0,0.5)"  },
  // Leaderboard days
  { id: "lb1",         cat: "board", name: "Chart Debut",    threshold: 1,    description: "1 day on leaderboard",          emoji: "📊", color: "#94A3B8", bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.3)" },
  { id: "lb2",         cat: "board", name: "Returning",      threshold: 2,    description: "2 days on leaderboard",         emoji: "📈", color: "#60A5FA", bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.3)"  },
  { id: "lb5",         cat: "board", name: "Regular",        threshold: 5,    description: "5 days on leaderboard",         emoji: "🎖️", color: "#34D399", bg: "rgba(52,211,153,0.15)",  border: "rgba(52,211,153,0.3)"  },
  { id: "lb10",        cat: "board", name: "Contender",      threshold: 10,   description: "10 days on leaderboard",        emoji: "🥊", color: "#F59E0B", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)"  },
  { id: "lb20",        cat: "board", name: "Top Analyst",    threshold: 20,   description: "20 days on leaderboard",        emoji: "🔭", color: "#C084FC", bg: "rgba(192,132,252,0.15)", border: "rgba(192,132,252,0.3)" },
  { id: "lb50",        cat: "board", name: "Elite Analyst",  threshold: 50,   description: "50 days on leaderboard",        emoji: "🏅", color: "#EAB308", bg: "rgba(234,179,8,0.15)",   border: "rgba(234,179,8,0.3)"   },
  { id: "lb100",       cat: "board", name: "Pro Handicapper",threshold: 100,  description: "100 days on leaderboard",       emoji: "💡", color: "#F97316", bg: "rgba(249,115,22,0.15)",  border: "rgba(249,115,22,0.3)"  },
  { id: "lb365",       cat: "board", name: "Full Season",    threshold: 365,  description: "365 days on leaderboard",       emoji: "📅", color: "#4ADE80", bg: "rgba(74,222,128,0.2)",   border: "rgba(74,222,128,0.4)"  },
  { id: "lb500",       cat: "board", name: "Perennial",      threshold: 500,  description: "500 days on leaderboard",       emoji: "🌟", color: "#38BDF8", bg: "rgba(56,189,248,0.2)",   border: "rgba(56,189,248,0.4)"  },
  { id: "lb1000",      cat: "board", name: "All-Time Great", threshold: 1000, description: "1000 days on leaderboard",      emoji: "👑", color: "#FFD700", bg: "rgba(255,215,0,0.2)",    border: "rgba(255,215,0,0.5)"   },
];

// ── Starter avatars (always available, no unlock required) ────────────────
export const STARTER_AVATARS = [
  { id: "default_target",    name: "Analyst",     emoji: "🎯", color: "#94A3B8", bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.3)" },
  { id: "default_cap",       name: "Fan",         emoji: "🧢", color: "#60A5FA", bg: "rgba(96,165,250,0.15)",  border: "rgba(96,165,250,0.3)"  },
  { id: "default_chart",     name: "Statistician",emoji: "📊", color: "#34D399", bg: "rgba(52,211,153,0.15)",  border: "rgba(52,211,153,0.3)"  },
  { id: "default_dice",      name: "Gambler",     emoji: "🎲", color: "#F59E0B", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)"  },
  { id: "default_clipboard", name: "Scout",       emoji: "📋", color: "#C084FC", bg: "rgba(192,132,252,0.15)", border: "rgba(192,132,252,0.3)" },
];

// ── PRO-only avatar ───────────────────────────────────────────────────────
export const PRO_AVATAR = { id: "pro_diamond", name: "PRO Member", emoji: "💎", color: "#F59E0B", bg: "rgba(245,158,11,0.2)", border: "rgba(245,158,11,0.5)" };

// Combined list for lookup
export const ALL_AVATARS = [...STARTER_AVATARS, PRO_AVATAR, ...ACHIEVEMENTS];

export function getCurrentTier(correctPicks) {
  const pickTiers = ACHIEVEMENTS.filter(a => a.cat === "picks");
  let tier = null;
  for (const a of pickTiers) {
    if (correctPicks >= a.threshold) tier = a;
  }
  return tier;
}

// Compute career high streak from pick history
export function computeCareerStreaks(picks) {
  // Group picks by date, sorted ascending
  const byDate = {};
  for (const p of picks) {
    if (!p.date) continue;
    if (!byDate[p.date]) byDate[p.date] = [];
    byDate[p.date].push(p);
  }
  const dates = Object.keys(byDate).sort();

  let currentStreak = 0;
  let careerHigh = 0;

  for (const date of dates) {
    const dayPicks = byDate[date].filter(p => p.result === "hit" || p.result === "miss");
    if (dayPicks.length === 0) continue; // push day or no picks — skip entirely

    // BTS rules: ALL picks must hit for streak to continue
    const allHit = dayPicks.every(p => p.result === "hit");
    const anyMissWithAB = dayPicks.some(p => p.result === "miss");

    if (allHit) {
      currentStreak += dayPicks.length;
      careerHigh = Math.max(careerHigh, currentStreak);
    } else if (anyMissWithAB) {
      currentStreak = 0;
    }
    // push (no decided picks): no change — handled by the continue above
  }

  return { currentStreak, careerHigh };
}

// Compute stats filtered by season
function computeStats(picks, seasonFilter) {
  const filtered = seasonFilter === "career"
    ? picks
    : picks.filter(p => {
        const year = p.date ? parseInt(p.date.slice(0, 4)) : 0;
        return year === parseInt(seasonFilter);
      });

  const decided = filtered.filter(p => p.result === "hit" || p.result === "miss");
  const wins = filtered.filter(p => p.result === "hit").length;
  const losses = filtered.filter(p => p.result === "miss").length;
  const pending = filtered.filter(p => !p.result || p.result === "pending").length;
  const winRate = decided.length ? Math.round((wins / decided.length) * 100) : null;

  // Current streak (most recent)
  const byDateSorted = [...decided].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  let streak = 0, streakType = null;
  for (const p of byDateSorted) {
    if (streak === 0) { streakType = p.result; streak = 1; }
    else if (p.result === streakType) streak++;
    else break;
  }

  // Longest streak ever (for this season/career)
  const { careerHigh } = computeCareerStreaks(filtered);

  // LHP/RHP splits
  const vsLHP = decided.filter(p => p.pitcherHand === "L");
  const vsRHP = decided.filter(p => p.pitcherHand === "R");
  const lhpRate = vsLHP.length ? Math.round((vsLHP.filter(p => p.result === "hit").length / vsLHP.length) * 100) : null;
  const rhpRate = vsRHP.length ? Math.round((vsRHP.filter(p => p.result === "hit").length / vsRHP.length) * 100) : null;

  // Most picked players
  const playerMap = {};
  for (const p of filtered) {
    if (!p.playerName) continue;
    if (!playerMap[p.playerName]) playerMap[p.playerName] = { name: p.playerName, total: 0, hits: 0 };
    playerMap[p.playerName].total++;
    if (p.result === "hit") playerMap[p.playerName].hits++;
  }
  const topPlayers = Object.values(playerMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(p => ({ ...p, rate: p.total ? Math.round((p.hits / p.total) * 100) : 0 }));

  // Monthly calendar
  const calMap = {};
  for (const p of decided) {
    if (!p.date) continue;
    const key = p.date.slice(0, 7); // YYYY-MM
    if (!calMap[key]) calMap[key] = { hits: 0, misses: 0 };
    if (p.result === "hit") calMap[key].hits++;
    else calMap[key].misses++;
  }
  const months = Object.entries(calMap)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 6)
    .map(([month, d]) => ({ month, ...d, rate: Math.round((d.hits / (d.hits + d.misses)) * 100) }));

  return { wins, losses, pending, winRate, streak, streakType, careerHigh, lhpRate, rhpRate, vsLHPCount: vsLHP.length, vsRHPCount: vsRHP.length, topPlayers, months, decided };
}

// ── Achievement Card ───────────────────────────────────────────────────────
function AchievementCard({ a, isUnlocked, isEquipped, onEquip, progress, needed }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => isUnlocked && onEquip(a.id)}>
      <div style={{
        width: 86, height: 100, borderRadius: 14, cursor: isUnlocked ? "pointer" : "default",
        background: isUnlocked ? a.bg : "rgba(255,255,255,0.03)",
        border: `2px solid ${isEquipped ? "#4ADE80" : isUnlocked ? a.border : "rgba(255,255,255,0.07)"}`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
        transition: "all 0.18s",
        boxShadow: isEquipped ? `0 0 18px ${a.bg}` : isUnlocked && hovered ? "0 4px 20px rgba(0,0,0,0.35)" : "none",
        transform: isUnlocked && hovered ? "translateY(-3px)" : "none",
        position: "relative", overflow: "hidden",
      }}>
        {/* Category label */}
        <div style={{ position: "absolute", top: 5, left: 0, right: 0, textAlign: "center", fontSize: 7, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", color: isUnlocked ? a.color : "rgba(255,255,255,0.15)", opacity: 0.7 }}>
          {a.cat === "picks" ? "PICKS" : a.cat === "streak" ? "STREAK" : "BOARD"}
        </div>
        <span style={{ fontSize: 28, filter: isUnlocked ? "none" : "grayscale(1) brightness(0.3)" }}>{a.emoji}</span>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.4px", color: isUnlocked ? a.color : "rgba(255,255,255,0.15)", textTransform: "uppercase", textAlign: "center", lineHeight: 1.2, padding: "0 4px" }}>
          {a.name}
        </span>
        <span style={{ fontSize: 8, color: isUnlocked ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)", fontWeight: 700 }}>
          {a.cat === "picks" ? `${a.threshold}` : a.cat === "streak" ? `${a.threshold}G` : `${a.threshold}d`}
        </span>
        {isEquipped && <div style={{ position: "absolute", top: 5, right: 5, width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", boxShadow: "0 0 6px rgba(74,222,128,0.9)" }} />}
        {!isUnlocked && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
            <span className="material-icons" style={{ fontSize: 20, color: "rgba(255,255,255,0.2)" }}>lock</span>
          </div>
        )}
      </div>
      {hovered && (
        <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", whiteSpace: "nowrap", zIndex: 200, boxShadow: "0 4px 16px rgba(0,0,0,0.5)", pointerEvents: "none" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: isUnlocked ? a.color : "var(--text-muted)", marginBottom: 2 }}>{a.name}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {isUnlocked ? (isEquipped ? "✓ Equipped as avatar" : "Click to equip") : `🔒 ${needed} more to unlock`}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{a.description}</div>
          {!isUnlocked && progress > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 100 }}>
                <div style={{ height: "100%", background: a.color, borderRadius: 100, width: `${Math.min(100, progress)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Share Card (canvas) ────────────────────────────────────────────────────
function ShareCard({ user, stats, currentTier, equippedAchievement, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { drawCard(); }, []);

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  async function drawCard() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 600, H = 340;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    // Background
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#060F1E"); grad.addColorStop(1, "#0A2342");
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, W, H, 16); ctx.fill();

    // Gold top bar
    const goldGrad = ctx.createLinearGradient(0, 0, W, 0);
    goldGrad.addColorStop(0, "transparent"); goldGrad.addColorStop(0.3, "#F59E0B");
    goldGrad.addColorStop(0.7, "#D97706"); goldGrad.addColorStop(1, "transparent");
    ctx.fillStyle = goldGrad;
    ctx.fillRect(0, 0, W, 3);

    // DiamondIQ logo area
    ctx.fillStyle = "#15803D";
    roundRect(ctx, 20, 18, 36, 36, 8); ctx.fill();
    ctx.fillStyle = "white"; ctx.font = "bold 13px system-ui"; ctx.textAlign = "center";
    ctx.fillText("IQ", 38, 42);

    ctx.fillStyle = "white"; ctx.font = "bold 18px Georgia"; ctx.textAlign = "left";
    ctx.fillText("Diamond", 64, 34);
    ctx.fillStyle = "#4ADE80";
    ctx.fillText("IQ", 64 + ctx.measureText("Diamond").width, 34);
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "10px system-ui";
    ctx.fillText("MY PERFORMANCE CARD", 64, 48);

    // Avatar circle
    ctx.fillStyle = equippedAchievement?.bg || "rgba(74,222,128,0.15)";
    ctx.beginPath(); ctx.arc(72, 130, 42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = equippedAchievement?.border || "rgba(74,222,128,0.4)";
    ctx.lineWidth = 2; ctx.stroke();
    ctx.font = "36px system-ui"; ctx.textAlign = "center";
    ctx.fillText(equippedAchievement?.emoji || "⚾", 72, 143);

    // Name + tier
    const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Player";
    ctx.fillStyle = "white"; ctx.font = "bold 22px Georgia"; ctx.textAlign = "left";
    ctx.fillText(displayName, 130, 118);
    if (currentTier) {
      ctx.fillStyle = currentTier.color; ctx.font = "bold 12px system-ui";
      ctx.fillText(`${currentTier.emoji} ${currentTier.name}`, 130, 138);
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "11px system-ui";
    ctx.fillText(`${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} · diamondiq.pro`, 130, 158);

    // Stat boxes
    const statItems = [
      { label: "RECORD", value: `${stats.wins}-${stats.losses}` },
      { label: "HIT %", value: stats.winRate !== null ? `${stats.winRate}%` : "—" },
      { label: "STREAK", value: stats.streak > 0 ? `${stats.streak}${stats.streakType === "hit" ? "W" : "L"}` : "—" },
      { label: "CAREER HIGH", value: `${stats.careerHigh}` },
    ];
    const boxW = 120, boxH = 70, startX = 30, startY = 200, gap = 14;
    statItems.forEach((s, i) => {
      const x = startX + i * (boxW + gap), y = startY;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      roundRect(ctx, x, y, boxW, boxH, 10); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "white"; ctx.font = `bold 24px Georgia`; ctx.textAlign = "center";
      ctx.fillText(s.value, x + boxW / 2, y + 38);
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "9px system-ui"; ctx.textAlign = "center";
      ctx.fillText(s.label, x + boxW / 2, y + 56);
    });

    // Bottom bar
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, H - 32, W, 32);
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "10px system-ui"; ctx.textAlign = "center";
    ctx.fillText("DiamondIQ PRO · MLB Hit Analytics · diamondiq.pro", W / 2, H - 12);
  }

  async function handleCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async blob => {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      const link = document.createElement("a");
      link.download = "diamondiq-performance.png";
      link.href = canvas.toDataURL();
      link.click();
    }
  }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(0,8,20,0.88)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", boxSizing:"border-box", overflowY:"auto" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)", borderRadius:16, border:"1px solid var(--border)", width:"min(640px, 100%)", overflow:"hidden", boxShadow:"0 24px 64px rgba(0,0,0,0.6)", display:"flex", flexDirection:"column" }}>
        {/* Header */}
        <div style={{ background:"var(--navy)", padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:28, height:28, borderRadius:6, background:"#15803D", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontWeight:900, fontSize:11, color:"white" }}>IQ</span>
            </div>
            <div>
              <div style={{ fontFamily:"var(--font-display)", fontSize:14, fontWeight:800, color:"white" }}>Share Performance Card</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)" }}>diamondiq.pro · MLB Hit Analytics</div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        {/* Canvas */}
        <div style={{ padding:"14px", background:"#060F1E", display:"flex", justifyContent:"center", flexShrink:0 }}>
          <canvas ref={canvasRef} className="share-modal-canvas" style={{ borderRadius:10, maxWidth:"100%", height:"auto", display:"block", boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }} />
        </div>
        {/* Actions */}
        <div style={{ padding:"12px 18px", display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center", borderTop:"1px solid var(--border)", background:"var(--surface-2)" }}>
          <button className="btn btn-primary btn-sm" onClick={handleCopy} style={{ flex:1, minWidth:120, justifyContent:"center" }}>
            <span className="material-icons" style={{ fontSize: 15 }}>{copied ? "check" : "content_copy"}</span>
            {copied ? "Copied!" : "Copy Image"}
          </button>
          <button className="btn btn-sm" onClick={() => { const link = document.createElement("a"); link.download = "diamondiq-performance.png"; link.href = canvasRef.current.toDataURL(); link.click(); }}
            style={{ flex:1, minWidth:120, justifyContent:"center", background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text-secondary)" }}>
            <span className="material-icons" style={{ fontSize: 15 }}>download</span>Download
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Monthly Calendar strip ─────────────────────────────────────────────────
function MonthlyCalendar({ months }) {
  if (!months.length) return null;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {months.map(m => (
        <div key={m.month} style={{ background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)", padding: "10px 16px", minWidth: 110, textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.5px", marginBottom: 6 }}>
            {new Date(m.month + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 900, color: m.rate >= 60 ? "var(--data-green)" : m.rate >= 45 ? "var(--blue-data)" : "var(--red-data)" }}>
            {m.rate}%
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{m.hits}W-{m.misses}L</div>
          <div style={{ height: 3, background: "var(--border)", borderRadius: 100, marginTop: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", background: m.rate >= 60 ? "var(--accent)" : m.rate >= 45 ? "var(--blue-data)" : "var(--red-data)", borderRadius: 100, width: `${m.rate}%`, transition: "width 0.5s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ProfilePage ───────────────────────────────────────────────────────
export default function ProfilePage({ isPremium, onNavigate }) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lbDays, setLbDays] = useState(0);
  const [seasonFilter, setSeasonFilter] = useState(String(CURRENT_SEASON));
  const [showShare, setShowShare] = useState(false);
  const [activeAchievCat, setActiveAchievCat] = useState("all");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [equippedId, setEquippedId] = useState(() => {
    try { return localStorage.getItem("diamondiq_equipped_avatar") || "default_target"; }
    catch { return "default_target"; }
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [raw, days] = await Promise.all([
        dbLoadPicks(userId),
        dbLoadLeaderboardDays(userId),
      ]);
      if (cancelled) return;
      const normalized = raw.map(p => ({
        result: p.result === "pending" ? null : (p.result || null),
        date: p.game_date?.slice(0, 10) || p.date,
        pitcherHand: p.pitcher_hand || null,
        playerName: p.player_name || p.playerName || "",
        playerId: p.player_id || p.playerId,
      }));
      setPicks(normalized);
      setLbDays(days);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  const stats = computeStats(picks, seasonFilter);
  const careerStats = computeStats(picks, "career");

  // Achievement unlock values (always career-based)
  const careerCorrect = careerStats.wins;
  const { careerHigh: careerStreakHigh } = computeCareerStreaks(picks);

  const unlockedIds = new Set(ACHIEVEMENTS.filter(a => {
    if (a.cat === "picks")  return careerCorrect >= a.threshold;
    if (a.cat === "streak") return careerStreakHigh >= a.threshold;
    if (a.cat === "board")  return lbDays >= a.threshold;
    return false;
  }).map(a => a.id));

  const currentTier = getCurrentTier(careerCorrect);
  const nextPickAchiev = ACHIEVEMENTS.filter(a => a.cat === "picks" && !unlockedIds.has(a.id))[0];
  const progressToNext = nextPickAchiev ? Math.round((careerCorrect / nextPickAchiev.threshold) * 100) : 100;

  function handleEquip(id) {
    // Starters always equippable
    if (STARTER_AVATARS.find(a => a.id === id)) {
      setEquippedId(id);
      try { localStorage.setItem("diamondiq_equipped_avatar", id); } catch {}
      return;
    }
    // PRO avatar — only if active PRO
    if (id === PRO_AVATAR.id) {
      if (!isPremium) return;
      setEquippedId(id);
      try { localStorage.setItem("diamondiq_equipped_avatar", id); } catch {}
      return;
    }
    // Achievement avatar — must be unlocked
    if (!unlockedIds.has(id)) return;
    setEquippedId(id);
    try { localStorage.setItem("diamondiq_equipped_avatar", id); } catch {}
  }

  const equippedAchievement = ACHIEVEMENTS.find(a => a.id === equippedId) || ALL_AVATARS.find(a => a.id === equippedId) || ALL_AVATARS[0];
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Player";

  async function saveName() {
    if (!nameInput.trim() || !supabase || !userId) return;
    setNameSaving(true);
    await supabase.auth.updateUser({ data: { full_name: nameInput.trim() } });
    setNameSaving(false);
    setEditingName(false);
  }

  const filteredAchievements = activeAchievCat === "all"
    ? ACHIEVEMENTS
    : ACHIEVEMENTS.filter(a => a.cat === activeAchievCat);

  // Available seasons — always include current season
  const seasons = ["career", String(CURRENT_SEASON)];
  const pickYears = [...new Set(picks.map(p => p.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  pickYears.forEach(y => { if (!seasons.includes(y)) seasons.push(y); });

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Pick history, achievements, and performance stats</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={() => setShowShare(true)}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <span className="material-icons" style={{ fontSize: 15 }}>share</span>Share Card
          </button>
        </div>
      </div>

      {/* Season filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {seasons.map(s => (
          <button key={s} className={`chip ${seasonFilter === s ? "active" : ""}`}
            onClick={() => setSeasonFilter(s)}
            style={{ textTransform: "capitalize", fontSize: 11 }}>
            {s === "career" ? "Career" : `${s} Season`}
          </button>
        ))}
      </div>

      {/* Hero card */}
      <div className="card" style={{
        marginBottom: 20, padding: "24px",
        background: "linear-gradient(135deg, var(--navy-xdark) 0%, rgba(13,48,96,0.85) 100%)",
        border: `1px solid ${equippedAchievement.border}`,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, background: `radial-gradient(circle, ${equippedAchievement.bg} 0%, transparent 70%)`, pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          {/* Avatar */}
          <div style={{ width: 68, height: 68, borderRadius: 18, flexShrink: 0, background: equippedAchievement.bg, border: `2px solid ${equippedAchievement.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, boxShadow: `0 0 20px ${equippedAchievement.bg}` }}>
            {equippedAchievement.emoji}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Name row */}
            {editingName ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <input className="form-input" value={nameInput} onChange={e => setNameInput(e.target.value)}
                  style={{ fontSize: 14, padding: "4px 10px", height: 32, maxWidth: 200 }}
                  onKeyDown={e => e.key === "Enter" && saveName()} autoFocus />
                <button className="btn btn-primary btn-sm" onClick={saveName} disabled={nameSaving} style={{ padding: "4px 10px", fontSize: 11 }}>
                  {nameSaving ? "..." : "Save"}
                </button>
                <button className="btn btn-sm" onClick={() => setEditingName(false)} style={{ padding: "4px 10px", fontSize: 11, background: "none", border: "none", color: "rgba(255,255,255,0.4)" }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "white" }}>{displayName}</span>
                <button onClick={() => { setNameInput(displayName); setEditingName(true); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.25)", padding: 0 }}>
                  <span className="material-icons" style={{ fontSize: 14 }}>edit</span>
                </button>
              </div>
            )}

            {/* Tier + PRO */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              {currentTier ? (
                <span style={{ fontSize: 11, fontWeight: 800, color: currentTier.color, background: currentTier.bg, border: `1px solid ${currentTier.border}`, borderRadius: 20, padding: "2px 10px" }}>
                  {currentTier.emoji} {currentTier.name}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>No tier yet — log your first pick!</span>
              )}
              {isPremium && <span style={{ fontSize: 10, fontWeight: 800, background: "linear-gradient(135deg,#F59E0B,#D97706)", color: "#0A2342", borderRadius: 20, padding: "2px 10px" }}>PRO</span>}
            </div>

            {/* Stat summary bar */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "Record", value: `${stats.wins}-${stats.losses}` },
                { label: "Hit %", value: stats.winRate !== null ? `${stats.winRate}%` : "—", color: stats.winRate >= 60 ? "#4ADE80" : stats.winRate >= 45 ? "#60A5FA" : stats.winRate ? "#EF4444" : undefined },
                { label: "Streak", value: stats.streak > 0 ? `${stats.streak}${stats.streakType === "hit" ? "W" : "L"}` : "—", color: stats.streakType === "hit" ? "#4ADE80" : stats.streakType === "miss" ? "#EF4444" : undefined },
                { label: "Career High", value: `${careerStreakHigh}G` },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 900, color: s.color || "white", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.6px", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Progress to next unlock */}
            {nextPickAchiev && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>
                  Next: {nextPickAchiev.emoji} {nextPickAchiev.name} — {nextPickAchiev.threshold - careerCorrect} more correct picks
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 100, overflow: "hidden", maxWidth: 220 }}>
                  <div style={{ height: "100%", background: nextPickAchiev.color, borderRadius: 100, width: `${progressToNext}%`, transition: "width 0.6s ease" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pick record */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title"><span className="material-icons">bar_chart</span>Pick Record</span>
          {loading && <div className="spinner" style={{ width: 14, height: 14 }} />}
        </div>
        <div style={{ padding: "16px 20px" }}>
          {!loading && picks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 13 }}>
              <span className="material-icons" style={{ fontSize: 32, display: "block", marginBottom: 8, opacity: 0.3 }}>sports_baseball</span>
              No picks yet — head to Today's Picks to get started
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                {[
                  { label: "Correct", value: loading ? "—" : stats.wins, color: "var(--data-green)", icon: "check_circle" },
                  { label: "Record", value: loading ? "—" : stats.decided.length ? `${stats.wins}-${stats.losses}` : "—", color: "var(--text-primary)", icon: "scoreboard" },
                  { label: "Hit %", value: loading ? "—" : stats.winRate !== null ? `${stats.winRate}%` : "—", color: stats.winRate >= 60 ? "var(--data-green)" : stats.winRate >= 45 ? "var(--blue-data)" : "var(--red-data)", icon: "percent" },
                  { label: "Longest Streak", value: loading ? "—" : `${stats.careerHigh}G`, color: "var(--blue-data)", icon: "bolt" },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "center", padding: "12px 6px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                    <span className="material-icons" style={{ fontSize: 18, color: s.color, display: "block", marginBottom: 4 }}>{s.icon}</span>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.8px", marginTop: 4 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* LHP/RHP splits */}
              {(stats.lhpRate !== null || stats.rhpRate !== null) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>Pitcher Hand Splits</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {stats.lhpRate !== null && (
                      <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 10, padding: "10px 14px", border: "1px solid var(--border)", textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--blue-data)", marginBottom: 4 }}>vs LHP</div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: stats.lhpRate >= 55 ? "var(--data-green)" : "var(--red-data)" }}>{stats.lhpRate}%</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{stats.vsLHPCount} picks</div>
                      </div>
                    )}
                    {stats.rhpRate !== null && (
                      <div style={{ flex: 1, background: "var(--surface-2)", borderRadius: 10, padding: "10px 14px", border: "1px solid var(--border)", textAlign: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--blue-data)", marginBottom: 4 }}>vs RHP</div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: stats.rhpRate >= 55 ? "var(--data-green)" : "var(--red-data)" }}>{stats.rhpRate}%</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{stats.vsRHPCount} picks</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Monthly performance */}
              {stats.months.length > 0 && (
                <div style={{ marginBottom: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>Monthly Performance</div>
                  <MonthlyCalendar months={stats.months} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Leaderboard summary */}
      <LeaderboardSummary userId={userId} onNavigate={onNavigate} />

      {/* Top players */}
      {stats.topPlayers.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title"><span className="material-icons">person</span>Most Picked Players</span>
          </div>
          <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.topPlayers.map((p, i) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", width: 16 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{p.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.hits}W-{p.total - p.hits}L</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: p.rate >= 60 ? "var(--data-green)" : p.rate >= 45 ? "var(--blue-data)" : "var(--red-data)", minWidth: 36, textAlign: "right" }}>{p.rate}%</span>
                <div style={{ width: 60, height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: p.rate >= 60 ? "var(--accent)" : "var(--blue-data)", width: `${p.rate}%`, borderRadius: 100 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="material-icons">emoji_events</span>Achievements</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{unlockedIds.size}/{ACHIEVEMENTS.length} unlocked</span>
        </div>
        <div style={{ padding: "14px 20px" }}>

          {/* Starter avatars — always available */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 10 }}>
              Starter Avatars — always available
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {STARTER_AVATARS.map(a => (
                <AchievementCard key={a.id} a={a} isUnlocked={true} isEquipped={equippedId === a.id} onEquip={handleEquip} progress={100} needed={0} />
              ))}
              {/* PRO avatar */}
              <div style={{ position: "relative" }} onClick={() => isPremium && handleEquip(PRO_AVATAR.id)}>
                <div style={{
                  width: 86, height: 100, borderRadius: 14,
                  cursor: isPremium ? "pointer" : "default",
                  background: isPremium ? PRO_AVATAR.bg : "rgba(255,255,255,0.03)",
                  border: `2px solid ${equippedId === PRO_AVATAR.id ? "#4ADE80" : isPremium ? PRO_AVATAR.border : "rgba(255,255,255,0.07)"}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                  boxShadow: equippedId === PRO_AVATAR.id ? `0 0 18px ${PRO_AVATAR.bg}` : isPremium ? `0 0 12px ${PRO_AVATAR.bg}` : "none",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: 5, left: 0, right: 0, textAlign: "center", fontSize: 7, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", color: isPremium ? PRO_AVATAR.color : "rgba(255,255,255,0.15)", opacity: 0.7 }}>PRO</div>
                  <span style={{ fontSize: 28, filter: isPremium ? "none" : "grayscale(1) brightness(0.3)" }}>{PRO_AVATAR.emoji}</span>
                  <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.4px", color: isPremium ? PRO_AVATAR.color : "rgba(255,255,255,0.15)", textTransform: "uppercase", textAlign: "center", lineHeight: 1.2, padding: "0 4px" }}>{PRO_AVATAR.name}</span>
                  <span style={{ fontSize: 8, color: isPremium ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)", fontWeight: 700 }}>PRO only</span>
                  {equippedId === PRO_AVATAR.id && <div style={{ position: "absolute", top: 5, right: 5, width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", boxShadow: "0 0 6px rgba(74,222,128,0.9)" }} />}
                  {!isPremium && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
                      <span className="material-icons" style={{ fontSize: 20, color: "rgba(255,255,255,0.2)" }}>workspace_premium</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Category filter */}
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 10 }}>
            Unlockable Achievements
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {[["all","All"],["picks","Correct Picks"],["streak","Streaks"],["board","Leaderboard"]].map(([val, label]) => (
              <button key={val} className={`chip ${activeAchievCat === val ? "active" : ""}`}
                onClick={() => setActiveAchievCat(val)} style={{ fontSize: 10 }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {filteredAchievements.map(a => {
              const progress = a.cat === "picks" ? (careerCorrect / a.threshold) * 100
                : a.cat === "streak" ? (careerStreakHigh / a.threshold) * 100
                : (lbDays / a.threshold) * 100;
              const current = a.cat === "picks" ? careerCorrect : a.cat === "streak" ? careerStreakHigh : lbDays;
              return (
                <AchievementCard
                  key={a.id}
                  a={a}
                  isUnlocked={unlockedIds.has(a.id)}
                  isEquipped={equippedId === a.id}
                  onEquip={handleEquip}
                  progress={progress}
                  needed={Math.max(0, a.threshold - current)}
                />
              );
            })}
          </div>

          <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.1)", borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            💡 Starter avatars are free for everyone. Achievements unlock based on career totals and never reset. PRO avatar requires an active subscription. Click any available badge to equip.
            {careerStreakHigh > 0 && <span> Career high streak: <strong style={{ color: "rgba(255,255,255,0.6)" }}>{careerStreakHigh}</strong>.</span>}
            {lbDays > 0 && <span> Leaderboard days: <strong style={{ color: "rgba(255,255,255,0.6)" }}>{lbDays}</strong>.</span>}
          </div>
        </div>
      </div>

      {showShare && (
        <ShareCard
          user={user}
          stats={careerStats}
          currentTier={currentTier}
          equippedAchievement={equippedAchievement}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
