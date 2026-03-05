import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { dbLoadPicks } from "../../utils/supabase";

// ── Achievement definitions ────────────────────────────────────────────────
// threshold = total correct picks needed to unlock
export const ACHIEVEMENTS = [
  {
    id: "rookie",
    name: "Rookie",
    threshold: 1,
    description: "Get your first correct pick",
    emoji: "⚾",
    color: "#94A3B8",
    bgColor: "rgba(148,163,184,0.15)",
    borderColor: "rgba(148,163,184,0.3)",
  },
  {
    id: "prospect",
    name: "Hot Prospect",
    threshold: 5,
    description: "Rack up 5 correct picks",
    emoji: "🔥",
    color: "#60A5FA",
    bgColor: "rgba(96,165,250,0.15)",
    borderColor: "rgba(96,165,250,0.3)",
  },
  {
    id: "allstar",
    name: "All-Star",
    threshold: 10,
    description: "Reach 10 correct picks",
    emoji: "⭐",
    color: "#F59E0B",
    bgColor: "rgba(245,158,11,0.15)",
    borderColor: "rgba(245,158,11,0.3)",
  },
  {
    id: "veteran",
    name: "Veteran",
    threshold: 25,
    description: "Prove yourself with 25 correct picks",
    emoji: "🏆",
    color: "#C084FC",
    bgColor: "rgba(192,132,252,0.15)",
    borderColor: "rgba(192,132,252,0.3)",
  },
  {
    id: "legend",
    name: "Legend",
    threshold: 50,
    description: "50 correct picks — elite status",
    emoji: "💎",
    color: "#4ADE80",
    bgColor: "rgba(74,222,128,0.15)",
    borderColor: "rgba(74,222,128,0.3)",
  },
  {
    id: "diamond",
    name: "Diamond Elite",
    threshold: 100,
    description: "100 correct picks — the pinnacle",
    emoji: "💠",
    color: "#38BDF8",
    bgColor: "rgba(56,189,248,0.15)",
    borderColor: "rgba(56,189,248,0.3)",
  },
];

// Get current achievement tier based on correct picks
export function getCurrentTier(correctPicks) {
  let tier = null;
  for (const a of ACHIEVEMENTS) {
    if (correctPicks >= a.threshold) tier = a;
  }
  return tier;
}

// ── Avatar component ───────────────────────────────────────────────────────
function AvatarCard({ achievement, isUnlocked, isEquipped, onEquip, correctPicks }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ position: "relative", cursor: isUnlocked ? "pointer" : "default" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => isUnlocked && onEquip(achievement.id)}
    >
      {/* Card */}
      <div style={{
        width: 90, height: 90,
        borderRadius: 16,
        background: isUnlocked ? achievement.bgColor : "rgba(255,255,255,0.03)",
        border: `2px solid ${isEquipped ? "#4ADE80" : isUnlocked ? achievement.borderColor : "rgba(255,255,255,0.08)"}`,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 4,
        transition: "all 0.2s",
        boxShadow: isEquipped ? "0 0 16px rgba(74,222,128,0.35)" : isUnlocked && hovered ? "0 4px 20px rgba(0,0,0,0.3)" : "none",
        transform: isUnlocked && hovered ? "translateY(-2px)" : "none",
        filter: isUnlocked ? "none" : "blur(0px) brightness(0.4)",
        position: "relative", overflow: "hidden",
      }}>
        {/* Emoji avatar */}
        <span style={{ fontSize: 32, filter: isUnlocked ? "none" : "blur(3px) grayscale(1)" }}>
          {achievement.emoji}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: "0.5px",
          color: isUnlocked ? achievement.color : "rgba(255,255,255,0.2)",
          textTransform: "uppercase", textAlign: "center", lineHeight: 1.2,
          filter: isUnlocked ? "none" : "blur(2px)",
        }}>
          {achievement.name}
        </span>

        {/* Equipped indicator */}
        {isEquipped && (
          <div style={{
            position: "absolute", top: 6, right: 6,
            width: 10, height: 10, borderRadius: "50%",
            background: "#4ADE80",
            boxShadow: "0 0 6px rgba(74,222,128,0.8)",
          }} />
        )}

        {/* Lock icon for locked */}
        {!isUnlocked && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}>
            <span className="material-icons" style={{ fontSize: 22, color: "rgba(255,255,255,0.25)" }}>lock</span>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hovered && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "8px 12px",
          whiteSpace: "nowrap", zIndex: 100,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: isUnlocked ? achievement.color : "var(--text-muted)", marginBottom: 2 }}>
            {achievement.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {isUnlocked
              ? isEquipped ? "✓ Equipped" : "Click to equip"
              : `🔒 Unlock at ${achievement.threshold} correct picks (${Math.max(0, achievement.threshold - correctPicks)} more to go)`
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ProfilePage ───────────────────────────────────────────────────────
export default function ProfilePage({ isPremium }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [equippedId, setEquippedId] = useState(() => {
    try { return localStorage.getItem("diamondiq_equipped_avatar") || "rookie"; }
    catch { return "rookie"; }
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const raw = await dbLoadPicks(userId);
      if (cancelled) return;
      // Normalize from DB or localStorage format
      const normalized = raw.map(p => ({
        result: p.result === "pending" ? null : (p.result || null),
        date: p.game_date?.slice(0, 10) || p.date,
      }));
      setPicks(normalized);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const decided = picks.filter(p => p.result && p.result !== "pending");
  const wins = picks.filter(p => p.result === "hit").length;
  const losses = picks.filter(p => p.result === "miss").length;
  const winRate = decided.length ? Math.round((wins / decided.length) * 100) : null;

  // Current streak
  const byDate = [...decided].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  let streak = 0, streakType = null;
  for (const p of byDate) {
    if (streak === 0) { streakType = p.result; streak = 1; }
    else if (p.result === streakType) streak++;
    else break;
  }

  // Achievements
  const correctPicks = wins;
  const unlockedIds = new Set(ACHIEVEMENTS.filter(a => correctPicks >= a.threshold).map(a => a.id));
  const currentTier = getCurrentTier(correctPicks);

  // Next unlock
  const nextAchievement = ACHIEVEMENTS.find(a => correctPicks < a.threshold);
  const progressToNext = nextAchievement
    ? Math.round((correctPicks / nextAchievement.threshold) * 100)
    : 100;

  function handleEquip(id) {
    if (!unlockedIds.has(id)) return;
    setEquippedId(id);
    try { localStorage.setItem("diamondiq_equipped_avatar", id); } catch {}
  }

  const equippedAchievement = ACHIEVEMENTS.find(a => a.id === equippedId) || ACHIEVEMENTS[0];
  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Player";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Your pick history, achievements, and avatar</p>
        </div>
      </div>

      {/* Profile hero card */}
      <div className="card" style={{
        marginBottom: 20, padding: "24px",
        background: "linear-gradient(135deg, var(--navy-xdark) 0%, rgba(13,48,96,0.8) 100%)",
        border: "1px solid rgba(74,222,128,0.15)",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, background: "radial-gradient(circle, rgba(74,222,128,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          {/* Equipped avatar */}
          <div style={{
            width: 72, height: 72, borderRadius: 18, flexShrink: 0,
            background: equippedAchievement.bgColor,
            border: `2px solid ${equippedAchievement.borderColor}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 36,
            boxShadow: `0 0 20px ${equippedAchievement.bgColor}`,
          }}>
            {equippedAchievement.emoji}
          </div>

          {/* Name + tier */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "white", marginBottom: 4 }}>
              {displayName}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {currentTier ? (
                <span style={{ fontSize: 11, fontWeight: 800, color: currentTier.color, background: currentTier.bgColor, border: `1px solid ${currentTier.borderColor}`, borderRadius: 20, padding: "2px 10px" }}>
                  {currentTier.emoji} {currentTier.name}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>No tier yet — make your first pick!</span>
              )}
              {isPremium && (
                <span style={{ fontSize: 10, fontWeight: 800, background: "var(--accent)", color: "white", borderRadius: 20, padding: "2px 10px" }}>PRO</span>
              )}
            </div>

            {/* Progress to next unlock */}
            {nextAchievement && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>
                  {nextAchievement.emoji} {nextAchievement.name} — {nextAchievement.threshold - correctPicks} more correct picks to unlock
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 100, overflow: "hidden", width: 200 }}>
                  <div style={{ height: "100%", background: "var(--accent)", borderRadius: 100, width: `${progressToNext}%`, transition: "width 0.6s ease" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pick record stats */}
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Correct", value: loading ? "—" : wins, color: "var(--data-green)", icon: "check_circle" },
                { label: "Record", value: loading ? "—" : decided.length ? `${wins}-${losses}` : "—", color: "var(--text-primary)", icon: "scoreboard" },
                { label: "Hit %", value: loading ? "—" : winRate !== null ? `${winRate}%` : "—", color: winRate >= 70 ? "var(--data-green)" : winRate >= 50 ? "var(--blue-data)" : "var(--red-data)", icon: "percent" },
                { label: "Streak", value: loading ? "—" : streak > 0 ? `${streak}${streakType === "hit" ? "W" : "L"}` : "—", color: streakType === "hit" ? "var(--data-green)" : streakType === "miss" ? "var(--red-data)" : "var(--text-muted)", icon: "bolt" },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center", padding: "12px 8px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <span className="material-icons" style={{ fontSize: 18, color: s.color, display: "block", marginBottom: 4 }}>{s.icon}</span>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.8px", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Avatar collection */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="material-icons">emoji_events</span>Achievements & Avatars</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{unlockedIds.size}/{ACHIEVEMENTS.length} unlocked</span>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
            Unlock avatars by earning correct picks. Click an unlocked avatar to equip it.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {ACHIEVEMENTS.map(a => (
              <AvatarCard
                key={a.id}
                achievement={a}
                isUnlocked={unlockedIds.has(a.id)}
                isEquipped={equippedId === a.id}
                onEquip={handleEquip}
                correctPicks={correctPicks}
              />
            ))}
          </div>
          <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.1)", borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            💡 More avatar styles and rarer characters coming soon — keep stacking those hits.
          </div>
        </div>
      </div>
    </div>
  );
}
