import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase, dbLoadLeaderboardDays, getEquippedEmoji } from "../../utils/supabase";

const CURRENT_SEASON = new Date().getFullYear();
const MIN_PICKS = 10;

// Composite score formula (100 pts max)
// 40% win rate, 30% correct picks, 15% active streak, 10% career high, 5% leaderboard days
function computeScore({ winPct, correct, streak, careerHigh, lbDays }) {
  const winScore     = (winPct / 100) * 40;
  const pickScore    = correct > 0 ? (Math.log(correct) / Math.log(500)) * 30 : 0;
  const streakScore  = streak > 0 ? (Math.log(streak + 1) / Math.log(58)) * 15 : 0;
  const highScore    = careerHigh > 0 ? (Math.log(careerHigh + 1) / Math.log(58)) * 10 : 0;
  const lbScore      = lbDays > 0 ? (Math.log(lbDays + 1) / Math.log(366)) * 5 : 0;
  return Math.min(100, winScore + pickScore + streakScore + highScore + lbScore);
}

function ScoreBar({ score }) {
  const color = score >= 70 ? "#4ADE80" : score >= 45 ? "#60A5FA" : "#F59E0B";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden", minWidth: 60 }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 100, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "var(--font-display)", color, minWidth: 32 }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function RankBadge({ rank }) {
  if (rank === 1) return <span style={{ fontSize: 20 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: 20 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: 20 }}>🥉</span>;
  return (
    <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 900, color: "var(--text-muted)", minWidth: 28, textAlign: "center" }}>
      #{rank}
    </span>
  );
}

// ── Main Leaderboard ───────────────────────────────────────────────────────
export default function Leaderboard({ isPremium, onNavigate }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [tab, setTab] = useState("season");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myStats, setMyStats] = useState(null);
  const [myRank, setMyRank] = useState(null);
  const [myLbDays, setMyLbDays] = useState(0);

  useEffect(() => {
    loadLeaderboard();
  }, [tab]);

  async function loadLeaderboard() {
    if (!supabase) return;
    setLoading(true);
    try {
      // Load leaderboard stats from view
      let query = supabase
        .from("leaderboard_stats")
        .select("*")
        .gte("decided", MIN_PICKS);

      if (tab === "season") {
        query = query.eq("season", CURRENT_SEASON);
      }
      // For all-time: group by user (sum across seasons) — use a different approach
      const { data: statsData, error } = await query;
      if (error) throw error;

      // For all-time tab, aggregate per user across all seasons
      let aggregated = statsData || [];
      if (tab === "alltime") {
        const byUser = {};
        for (const row of aggregated) {
          if (!byUser[row.user_id]) byUser[row.user_id] = { user_id: row.user_id, decided: 0, correct: 0, incorrect: 0 };
          byUser[row.user_id].decided  += row.decided  || 0;
          byUser[row.user_id].correct  += row.correct  || 0;
          byUser[row.user_id].incorrect+= row.incorrect|| 0;
        }
        aggregated = Object.values(byUser).map(u => ({
          ...u,
          win_pct: u.decided > 0 ? Math.round((u.correct / u.decided) * 1000) / 10 : 0,
        })).filter(u => u.decided >= MIN_PICKS);
      }

      // Load public usernames
      const userIds = aggregated.map(r => r.user_id);
      let usernameMap = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("user_id, username")
          .in("user_id", userIds);
        for (const p of profiles || []) {
          usernameMap[p.user_id] = p.username;
        }
      }

      // Load leaderboard days for all users
      let lbDaysMap = {};
      if (userIds.length > 0) {
        const { data: lbData } = await supabase
          .from("leaderboard_appearances")
          .select("user_id")
          .in("user_id", userIds);
        for (const row of lbData || []) {
          lbDaysMap[row.user_id] = (lbDaysMap[row.user_id] || 0) + 1;
        }
      }

      // Build rows with composite scores
      const scored = aggregated.map(r => {
        const winPct    = parseFloat(r.win_pct) || 0;
        const correct   = r.correct || 0;
        const lbDays    = lbDaysMap[r.user_id] || 0;
        const score     = computeScore({ winPct, correct, streak: 0, careerHigh: 0, lbDays });
        const username  = usernameMap[r.user_id] || `Player_${r.user_id.slice(0,6)}`;
        return { userId: r.user_id, username, winPct, correct, decided: r.decided, lbDays, score, isMe: r.user_id === userId };
      }).sort((a, b) => b.score - a.score);

      // Assign ranks
      const ranked = scored.map((r, i) => ({ ...r, rank: i + 1 }));
      setRows(ranked);

      // Find current user's stats and rank
      const me = ranked.find(r => r.isMe);
      setMyRank(me || null);

      // Load my own stats even if below threshold
      if (userId) {
        const lbDays = await dbLoadLeaderboardDays(userId);
        setMyLbDays(lbDays);

        // Get my pick stats
        const { data: myPickStats } = await supabase
          .from("leaderboard_stats")
          .select("*")
          .eq("user_id", userId);

        if (myPickStats && myPickStats.length > 0) {
          let myDecided = 0, myCorrect = 0;
          if (tab === "season") {
            const seasonRow = myPickStats.find(r => r.season === CURRENT_SEASON);
            myDecided = seasonRow?.decided || 0;
            myCorrect = seasonRow?.correct || 0;
          } else {
            myDecided = myPickStats.reduce((s, r) => s + (r.decided || 0), 0);
            myCorrect = myPickStats.reduce((s, r) => s + (r.correct || 0), 0);
          }
          const myWinPct = myDecided > 0 ? Math.round((myCorrect / myDecided) * 1000) / 10 : 0;
          setMyStats({ decided: myDecided, correct: myCorrect, winPct: myWinPct });
        } else {
          setMyStats({ decided: 0, correct: 0, winPct: 0 });
        }
      }

      // Record leaderboard appearance if user is ranked
      if (me && supabase && userId) {
        const today = new Date().toLocaleDateString("en-CA");
        await supabase.from("leaderboard_appearances")
          .upsert({ user_id: userId, appearance_date: today, rank: me.rank }, { onConflict: "user_id,appearance_date" });
      }
    } catch (e) {
      console.warn("Leaderboard load error:", e.message);
    }
    setLoading(false);
  }

  const picksNeeded = myStats ? Math.max(0, MIN_PICKS - myStats.decided) : MIN_PICKS;
  const isRanked = myRank !== null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Leaderboard</h1>
          <p className="page-subtitle">Top analysts ranked by composite score — min {MIN_PICKS} picks to qualify</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["season", `${CURRENT_SEASON} Season`], ["alltime", "All-Time"]].map(([val, label]) => (
          <button key={val} className={`chip ${tab === val ? "active" : ""}`}
            onClick={() => setTab(val)} style={{ fontSize: 12 }}>
            {label}
          </button>
        ))}
      </div>

      {/* My rank card — always visible */}
      {userId && (
        <div className="card" style={{
          marginBottom: 20, padding: "16px 20px",
          background: isRanked
            ? "linear-gradient(135deg, rgba(74,222,128,0.08), rgba(10,35,66,0.9))"
            : "linear-gradient(135deg, rgba(96,165,250,0.06), rgba(10,35,66,0.9))",
          border: `1px solid ${isRanked ? "rgba(74,222,128,0.25)" : "rgba(96,165,250,0.2)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flexShrink: 0 }}>
              {isRanked
                ? <RankBadge rank={myRank.rank} />
                : <span className="material-icons" style={{ fontSize: 28, color: "rgba(255,255,255,0.2)" }}>person</span>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 800, color: "white", marginBottom: 2 }}>
                {user?.user_metadata?.full_name || user?.email?.split("@")[0] || "You"}
                <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 8, color: "rgba(255,255,255,0.4)" }}>YOU</span>
              </div>
              {myStats && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>{myStats.correct} correct</span>
                  <span>{myStats.winPct}% win rate</span>
                  <span>{myLbDays} leaderboard day{myLbDays !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              {isRanked ? (
                <>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 900, color: "#4ADE80" }}>
                    #{myRank.rank}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    Score: {myRank.score.toFixed(1)}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
                    Not ranked yet
                  </div>
                  {picksNeeded > 0 && (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                      {picksNeeded} more pick{picksNeeded !== 1 ? "s" : ""} needed
                    </div>
                  )}
                  <button className="btn btn-sm" onClick={() => onNavigate?.("tracker")}
                    style={{ marginTop: 6, fontSize: 10, padding: "3px 10px", background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: "#60A5FA" }}>
                    Log picks →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Score legend */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["Win %","40pts"],["Correct Picks","30pts"],["Active Streak","15pts"],["Career High","10pts"],["LB Days","5pts"]].map(([label, pts]) => (
          <div key={label} style={{ fontSize: 10, padding: "3px 8px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{label}</span> {pts}
          </div>
        ))}
      </div>

      {/* Board */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-header">
          <span className="card-title">
            <span className="material-icons">leaderboard</span>
            {tab === "season" ? `${CURRENT_SEASON} Season Rankings` : "All-Time Rankings"}
          </span>
          {loading && <div className="spinner" style={{ width: 14, height: 14 }} />}
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{rows.length} analysts ranked</span>
        </div>

        {!loading && rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
            <span className="material-icons" style={{ fontSize: 40, display: "block", marginBottom: 12, opacity: 0.3 }}>leaderboard</span>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No analysts ranked yet</div>
            <div style={{ fontSize: 12 }}>
              {tab === "season"
                ? `Be the first — log ${MIN_PICKS}+ picks this season to qualify`
                : `Log ${MIN_PICKS}+ picks to appear on the all-time board`}
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>Rank</th>
                  <th>Analyst</th>
                  <th style={{ width: 70 }}>Win %</th>
                  <th style={{ width: 70 }}>Correct</th>
                  <th style={{ width: 60 }}>Decided</th>
                  <th style={{ width: 60 }}>LB Days</th>
                  <th style={{ minWidth: 140 }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.userId}
                    style={{ background: row.isMe ? "rgba(74,222,128,0.04)" : undefined,
                             outline: row.isMe ? "1px solid rgba(74,222,128,0.15)" : undefined }}>
                    <td style={{ textAlign: "center" }}><RankBadge rank={row.rank} /></td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: row.isMe ? "rgba(74,222,128,0.15)" : "var(--surface-2)", border: `1px solid ${row.isMe ? "rgba(74,222,128,0.3)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: row.isMe ? 16 : 13, flexShrink: 0 }}>
                          {row.isMe ? getEquippedEmoji() : row.username.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>
                            {row.username}
                            {row.isMe && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, background: "rgba(74,222,128,0.2)", color: "#4ADE80", padding: "1px 5px", borderRadius: 4 }}>YOU</span>}
                          </div>
                          {row.rank <= 3 && (
                            <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                              {row.lbDays} leaderboard day{row.lbDays !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 800,
                        color: row.winPct >= 60 ? "var(--data-green)" : row.winPct >= 45 ? "var(--blue-data)" : "var(--red-data)" }}>
                        {row.winPct}%
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                        {row.correct}
                      </span>
                    </td>
                    <td className="td-mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.decided}</td>
                    <td className="td-mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.lbDays}</td>
                    <td><ScoreBar score={row.score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
        💡 Composite score: Win Rate (40%) + Correct Picks (30%) + Active Streak (15%) + Career High (10%) + Leaderboard Days (5%).
        Minimum {MIN_PICKS} decided picks to qualify. Leaderboard appearances are recorded daily.
      </div>
    </div>
  );
}

// ── Leaderboard Summary (for My Profile) ─────────────────────────────────
export function LeaderboardSummary({ userId, onNavigate }) {
  const [top5, setTop5] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    async function load() {
      try {
        const { data, error } = await supabase
          .from("leaderboard_stats")
          .select("*")
          .eq("season", CURRENT_SEASON)
          .gte("decided", MIN_PICKS);
        if (error) throw error;

        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("user_id, username");
        const usernameMap = {};
        for (const p of profiles || []) usernameMap[p.user_id] = p.username;

        const scored = (data || []).map(r => ({
          userId: r.user_id,
          username: usernameMap[r.user_id] || `Player_${r.user_id.slice(0,6)}`,
          winPct: parseFloat(r.win_pct) || 0,
          correct: r.correct || 0,
          score: computeScore({ winPct: parseFloat(r.win_pct)||0, correct: r.correct||0, streak:0, careerHigh:0, lbDays:0 }),
          isMe: r.user_id === userId,
        })).sort((a,b) => b.score - a.score).map((r,i) => ({ ...r, rank: i+1 }));

        setTop5(scored.slice(0, 5));
        setMyRank(scored.find(r => r.isMe) || null);
      } catch {}
      setLoading(false);
    }
    load();
  }, [userId]);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <span className="card-title"><span className="material-icons">leaderboard</span>Leaderboard</span>
        <button className="btn btn-sm" onClick={() => onNavigate?.("leaderboard")}
          style={{ fontSize: 10, padding: "3px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          View Full Board →
        </button>
      </div>
      <div style={{ padding: "12px 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 16 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
        ) : top5.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
            No analysts ranked yet this season — log {MIN_PICKS}+ picks to qualify.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {top5.map(row => (
                <div key={row.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                  background: row.isMe ? "rgba(74,222,128,0.04)" : undefined, borderRadius: 6 }}>
                  <RankBadge rank={row.rank} />
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: row.isMe ? "rgba(74,222,128,0.15)" : "var(--surface-2)", border: `1px solid ${row.isMe ? "rgba(74,222,128,0.3)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: row.isMe ? 13 : 11, flexShrink: 0 }}>
                    {row.isMe ? getEquippedEmoji() : row.username.slice(0,1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: row.isMe ? 800 : 600, color: "var(--text-primary)" }}>
                    {row.username}
                    {row.isMe && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#4ADE80" }}>YOU</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{row.winPct}%</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 800,
                    color: row.score >= 70 ? "#4ADE80" : row.score >= 45 ? "#60A5FA" : "#F59E0B" }}>
                    {row.score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
            {myRank ? (
              <div style={{ fontSize: 11, color: "var(--green-light)", padding: "6px 10px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 6 }}>
                You're ranked <strong>#{myRank.rank}</strong> this season
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }}>
                Not ranked yet — log {MIN_PICKS}+ picks to appear on the board
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
