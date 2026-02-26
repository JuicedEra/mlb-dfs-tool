import { useState, useEffect } from "react";
import { fetchGames, fetchRoster, searchPlayers, headshot, fetchGameLog, fetchSeasonStats, computeSplit, computeActiveStreak } from "../../utils/mlbApi";

const STORAGE_KEY = "diamondiq_picks_v1";
const PROP_TYPES  = ["1+ Hits (BTS)", "2+ Hits", "1+ Home Runs", "1+ Total Bases", "2+ Total Bases", "Custom"];

function loadPicks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function savePicks(picks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
}

// Fetch box score hits for a single game — returns Set of player IDs who got 1+ hit
async function fetchBoxHits(gamePk) {
  try {
    const r = await fetch(`/mlb-proxy/game/${gamePk}/boxscore`);
    if (!r.ok) return null;
    const data = await r.json();
    const result = {};
    for (const side of ["home", "away"]) {
      const players = data.teams?.[side]?.players || {};
      for (const [, p] of Object.entries(players)) {
        const id = p.person?.id;
        if (!id) continue;
        const stats = p.stats?.batting || {};
        result[id] = {
          hits: Number(stats.hits || 0),
          totalBases: Number(stats.totalBases || 0),
          homeRuns: Number(stats.homeRuns || 0),
        };
      }
    }
    return result;
  } catch { return null; }
}

// Check if a pick is a win based on prop type and actual stats
function evaluatePick(prop, stats) {
  if (!stats) return null;
  if (prop === "1+ Hits")        return stats.hits >= 1;
  if (prop === "2+ Hits")        return stats.hits >= 2;
  if (prop === "1+ Total Bases") return stats.totalBases >= 1;
  if (prop === "2+ Total Bases") return stats.totalBases >= 2;
  if (prop === "Home Run")       return stats.homeRuns >= 1;
  // Default: 1+ hits
  return stats.hits >= 1;
}

// Called from TodaysPicks to directly log a pick — works even when PickTracker isn't mounted
export function openAddPick(prefill = {}) {
  const STORAGE_KEY = "diamondiq_picks_v1";
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const newPick = {
      id: Date.now(),
      playerName: prefill.playerName || "",
      playerId: prefill.playerId || null,
      team: prefill.team || "",
      opponent: prefill.opponent || "",
      date: prefill.date || new Date().toISOString().split("T")[0],
      prop: prefill.prop || "1+ Hits (BTS)",
      hitScore: prefill.hitScore || null,
      gamePk: prefill.gamePk || null,
      result: null,
    };
    // Avoid duplicates: same player + date + prop
    const dup = existing.find(p => p.playerId === newPick.playerId && p.date === newPick.date && p.prop === newPick.prop);
    if (dup) {
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", { detail: { msg: `${prefill.playerName} already tracked for today`, type: "warn" } }));
      return;
    }
    existing.unshift(newPick);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    window.dispatchEvent(new CustomEvent("diamondiq:picktoast", { detail: { msg: `${prefill.playerName} added to Pick Record`, type: "ok" } }));
    // Also dispatch for PickTracker if it's mounted
    window.dispatchEvent(new CustomEvent("diamondiq:addpick", { detail: prefill }));
  } catch (e) {
    console.error("Failed to save pick:", e);
  }
}

export default function PickTracker() {
  const [picks, setPicks]       = useState(loadPicks);
  const [showAdd, setShowAdd]   = useState(false);
  const [prefill, setPrefill]   = useState({});
  const [filterResult, setFilterResult] = useState("all");
  const [search, setSearch]     = useState("");
  const [sortDir, setSortDir]   = useState("desc");
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState(null);
  const [selectedPick, setSelectedPick] = useState(null);
  const [playerStats, setPlayerStats] = useState(null);

  // Listen for quick-add events — reload picks from storage when added externally
  useEffect(() => {
    const handler = () => { setPicks(loadPicks()); };
    window.addEventListener("diamondiq:addpick", handler);
    return () => window.removeEventListener("diamondiq:addpick", handler);
  }, []);

  // Auto-resolve on mount if there are pending picks from past dates
  useEffect(() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split("T")[0];
    const hasPast = picks.some(p => p.result === "pending" && p.date <= yStr);
    if (hasPast) autoResolve();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function autoResolve() {
    setResolving(true); setResolveMsg("Checking box scores...");
    const pending = picks.filter(p => p.result === "pending");
    if (!pending.length) { setResolving(false); setResolveMsg(null); return; }

    // Group pending picks by date
    const byDate = {};
    for (const p of pending) {
      if (!byDate[p.date]) byDate[p.date] = [];
      byDate[p.date].push(p);
    }

    // Only resolve dates that are in the past (not today)
    const today = new Date().toISOString().split("T")[0];
    const datesToResolve = Object.keys(byDate).filter(d => d < today);

    if (!datesToResolve.length) {
      setResolving(false);
      setResolveMsg("All pending picks are for today — will resolve after games finish");
      setTimeout(() => setResolveMsg(null), 3000);
      return;
    }

    let resolved = 0, failed = 0;
    const updatedPicks = [...picks];

    for (const date of datesToResolve) {
      setResolveMsg(`Checking ${date}...`);
      try {
        // Fetch all games for this date
        const { games } = await fetchGames(date);

        // Fetch box scores for all games
        const boxDataByGame = {};
        await Promise.allSettled(
          games.map(async g => {
            boxDataByGame[g.gamePk] = await fetchBoxHits(g.gamePk);
          })
        );

        // Merge all player stats across games
        const allPlayerStats = {};
        for (const [, gData] of Object.entries(boxDataByGame)) {
          if (!gData) continue;
          for (const [pid, stats] of Object.entries(gData)) {
            allPlayerStats[pid] = stats;
          }
        }

        // Try to resolve each pending pick for this date
        for (const pick of byDate[date]) {
          const idx = updatedPicks.findIndex(p => p.id === pick.id);
          if (idx === -1) continue;

          let stats = null;

          // Method 1: direct playerId match (from any game that day)
          if (pick.playerId && allPlayerStats[pick.playerId]) {
            stats = allPlayerStats[pick.playerId];
          }

          // Method 1b: if we have gamePk, try that specific box score
          if (!stats && pick.playerId && pick.gamePk && boxDataByGame[pick.gamePk]) {
            const gameBox = boxDataByGame[pick.gamePk];
            if (gameBox && gameBox[pick.playerId]) {
              stats = gameBox[pick.playerId];
            }
          }

          // Method 2: name search fallback
          if (!stats && pick.playerName) {
            try {
              const searchResults = await searchPlayers(pick.playerName);
              for (const sr of searchResults) {
                if (allPlayerStats[sr.id]) {
                  stats = allPlayerStats[sr.id];
                  updatedPicks[idx] = { ...updatedPicks[idx], playerId: sr.id };
                  break;
                }
              }
            } catch {}
          }

          if (stats !== null) {
            const won = evaluatePick(pick.prop || "1+ Hits", stats);
            if (won !== null) {
              updatedPicks[idx] = { ...updatedPicks[idx], result: won ? "hit" : "miss", autoResolved: true };
              resolved++;
            } else { failed++; }
          } else { failed++; }
        }
      } catch { failed += byDate[date].length; }
    }

    setPicks(updatedPicks);
    savePicks(updatedPicks);
    setResolving(false);
    setResolveMsg(resolved > 0
      ? `Auto-resolved ${resolved} pick${resolved > 1 ? "s" : ""}${failed > 0 ? ` (${failed} couldn't be matched)` : ""}`
      : `Couldn't match ${failed} pick${failed > 1 ? "s" : ""} to box scores`
    );
    setTimeout(() => setResolveMsg(null), 5000);
  }

  function updateResult(id, result) {
    const updated = picks.map(p => p.id === id ? { ...p, result } : p);
    setPicks(updated); savePicks(updated);
  }
  function removePick(id) {
    const updated = picks.filter(p => p.id !== id);
    setPicks(updated); savePicks(updated);
  }
  function addPick(pick) {
    const updated = [{ ...pick, id: `${Date.now()}-${Math.random()}`, result: "pending", autoResolved: false, gamePk: pick.gamePk || null }, ...picks];
    setPicks(updated); savePicks(updated);
    setShowAdd(false); setPrefill({});
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const decided  = picks.filter(p => p.result !== "pending");
  const wins     = picks.filter(p => p.result === "hit").length;
  const losses   = picks.filter(p => p.result === "miss").length;
  const pending  = picks.filter(p => p.result === "pending").length;
  const winRate  = decided.length ? Math.round((wins / decided.length) * 100) : null;

  // Current streak
  const byDate = [...decided].sort((a,b) => b.date.localeCompare(a.date));
  let streak = 0, streakType = null;
  for (const p of byDate) {
    if (streak === 0) { streakType = p.result; streak = 1; }
    else if (p.result === streakType) streak++;
    else break;
  }

  // ── Filtered picks ─────────────────────────────────────────────────────────
  const filtered = picks
    .filter(p => {
      if (filterResult !== "all" && p.result !== filterResult) return false;
      if (search && !p.playerName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a,b) => sortDir === "desc"
      ? b.date.localeCompare(a.date)
      : a.date.localeCompare(b.date));

  const today = new Date().toISOString().split("T")[0];

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">My Pick Record</h1>
          <p className="page-subtitle">Track picks you've tailed — see how well DiamondIQ is performing for you</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={autoResolve} disabled={resolving}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <span className="material-icons">{resolving ? "hourglass_top" : "fact_check"}</span>
            {resolving ? "Resolving..." : "Auto-Resolve"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setPrefill({}); setShowAdd(true); }}>
            <span className="material-icons">add</span>Log a Pick
          </button>
        </div>
      </div>

      {/* Auto-resolve status */}
      {resolveMsg && (
        <div style={{ padding: "10px 16px", marginBottom: 12, background: resolving ? "var(--surface-2)" : "rgba(34,197,94,0.08)",
          border: `1px solid ${resolving ? "var(--border)" : "rgba(34,197,94,0.2)"}`, borderRadius: "var(--radius)",
          fontSize: 12, color: resolving ? "var(--text-secondary)" : "var(--green-light)", display: "flex", alignItems: "center", gap: 8 }}>
          {resolving && <div className="spinner" style={{ width: 14, height: 14 }} />}
          {!resolving && <span className="material-icons" style={{ fontSize: 16 }}>check_circle</span>}
          {resolveMsg}
        </div>
      )}

      {/* Record summary strip */}
      <div className="record-strip">
        <div className="record-card">
          <div className="record-card-label">Overall Record</div>
          <div className="record-card-val" style={{ color: winRate >= 55 ? "var(--data-green-light)" : winRate >= 45 ? "var(--data-yellow)" : picks.length ? "var(--data-red)" : "var(--text-muted)" }}>
            {wins}-{losses}
          </div>
          <div className="record-card-sub">{pending} pending</div>
        </div>

        <div className="record-card">
          <div className="record-card-label">Win Rate</div>
          <div className="record-card-val" style={{ color: winRate >= 60 ? "var(--data-green-light)" : winRate >= 50 ? "var(--data-yellow)" : winRate !== null ? "var(--data-red)" : "var(--text-muted)" }}>
            {winRate !== null ? `${winRate}%` : "—"}
          </div>
          <div className="record-card-sub">{decided.length} decided picks</div>
        </div>

        <div className="record-card">
          <div className="record-card-label">Current Streak</div>
          <div className="record-card-val" style={{ color: streakType === "hit" ? "var(--data-green-light)" : streakType === "miss" ? "var(--data-red)" : "var(--text-muted)" }}>
            {streak > 0 ? `${streak}${streakType === "hit" ? "W" : "L"}` : "—"}
          </div>
          <div className="record-card-sub">{streakType === "hit" ? "winning streak" : streakType === "miss" ? "losing streak" : "no streak yet"}</div>
        </div>

        <div className="record-card">
          <div className="record-card-label">Total Picks</div>
          <div className="record-card-val" style={{ color: "var(--navy)" }}>{picks.length}</div>
          <div className="record-card-sub">since you started tracking</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Search</span>
          <div className="filter-input-icon" style={{ minWidth: 200 }}>
            <span className="material-icons">search</span>
            <input className="filter-input" style={{ paddingLeft: 34, width: "100%" }}
              placeholder="Filter by player..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Result</span>
          <div className="chip-group">
            {[["all","All"],["pending","Pending"],["hit","Hits"],["miss","Misses"]].map(([val,label]) => (
              <button key={val} className={`chip ${filterResult === val ? "active" : ""}`} onClick={() => setFilterResult(val)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Date</span>
          <div className="chip-group">
            <button className={`chip ${sortDir==="desc"?"active":""}`} onClick={() => setSortDir("desc")}>Newest first</button>
            <button className={`chip ${sortDir==="asc"?"active":""}`}  onClick={() => setSortDir("asc")}>Oldest first</button>
          </div>
        </div>
        <div style={{ marginLeft:"auto", alignSelf:"flex-end", fontSize:12, color:"var(--text-muted)" }}>
          {filtered.length} picks
        </div>
      </div>

      {picks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">assignment</span></div>
          <div className="empty-title">No picks logged yet</div>
          <div className="empty-sub">
            Start tracking picks you tail. Use the "+" button on Today's Picks rows, or log manually with "Log a Pick" above.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => { setPrefill({}); setShowAdd(true); }}>
            <span className="material-icons">add</span>Log your first pick
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">search_off</span></div>
          <div className="empty-title">No results</div>
          <div className="empty-sub">Try a different filter</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header">
            <span className="card-title">
              <span className="material-icons">assignment</span>
              Pick Log
            </span>
            <span style={{ fontSize:11, color:"var(--text-muted)" }}>click Hit / Miss to record result</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Player</th>
                  <th>Prop</th>
                  <th>Score</th>
                  <th>Notes</th>
                  <th>Result</th>
                  <th style={{width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}
                    className={p.result === "hit" ? "pick-row-hit" : p.result === "miss" ? "pick-row-miss" : ""}>
                    <td className="td-mono" style={{ color:"var(--text-muted)", fontSize:11, whiteSpace:"nowrap" }}>
                      {p.date === today ? (
                        <span style={{ color:"var(--accent)", fontWeight:700 }}>Today</span>
                      ) : p.date}
                    </td>
                    <td>
                      <div className="td-player" style={{ color: "var(--navy)", cursor: "pointer" }}
                        onClick={async () => {
                          setSelectedPick(p);
                          if (p.playerId) {
                            try {
                              const SEASON = new Date().getFullYear();
                              const [gl, ss] = await Promise.allSettled([
                                fetchGameLog(p.playerId, SEASON),
                                fetchSeasonStats(p.playerId, SEASON),
                              ]);
                              const gamelog = gl.value || [];
                              const season = ss.value || {};
                              const l7 = computeSplit(gamelog, 7);
                              const l3 = computeSplit(gamelog, 3);
                              const streak = computeActiveStreak(gamelog);
                              setPlayerStats({ l7, l3, streak, season, gamelog: gamelog.slice(0, 5) });
                            } catch { setPlayerStats(null); }
                          }
                        }}>
                        {p.playerName}
                      </div>
                      {p.team && <div className="td-sub">{p.team}{p.opponent ? ` vs ${p.opponent}` : ""}</div>}
                    </td>
                    <td>
                      <span className="badge badge-navy" style={{ fontSize:9 }}>{p.prop}</span>
                    </td>
                    <td>
                      {p.hitScore ? (
                        <span style={{ fontFamily:"var(--font-display)", fontWeight:800, fontSize:16,
                          color: p.hitScore >= 75 ? "#D97706" : p.hitScore >= 60 ? "var(--accent)" : p.hitScore >= 45 ? "var(--data-blue)" : "var(--text-muted)" }}>
                          {p.hitScore}
                        </span>
                      ) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={{ fontSize:12, color:"var(--text-secondary)", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {p.notes || "—"}
                    </td>
                    <td>
                      <div className="result-btn-group">
                        <button className={`result-btn ${p.result === "hit" ? "hit" : ""}`}
                          onClick={() => updateResult(p.id, p.result === "hit" ? "pending" : "hit")}>
                          Hit
                        </button>
                        <button className={`result-btn ${p.result === "miss" ? "miss" : ""}`}
                          onClick={() => updateResult(p.id, p.result === "miss" ? "pending" : "miss")}>
                          Miss
                        </button>
                      </div>
                      {p.autoResolved && (
                        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2, textAlign: "center" }} title="Auto-resolved from box score">
                          <span className="material-icons" style={{ fontSize: 10, verticalAlign: "middle" }}>smart_toy</span> auto
                        </div>
                      )}
                    </td>
                    <td>
                      <button onClick={() => removePick(p.id)}
                        style={{ background:"none", border:"none", cursor:"pointer", color:"var(--text-muted)", padding:"2px 4px" }}
                        title="Remove pick">
                        <span className="material-icons" style={{ fontSize:15 }}>close</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Player stat card */}
      {selectedPick && (
        <div className="add-pick-modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setSelectedPick(null); setPlayerStats(null); } }}>
          <div className="add-pick-modal" style={{ maxWidth: 400 }}>
            <div className="add-pick-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {selectedPick.playerId && (
                  <img src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${selectedPick.playerId}/headshot/67/current`}
                    alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }}
                    onError={e => { e.target.style.display = "none"; }} />
                )}
                <div>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "white" }}>{selectedPick.playerName}</span>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{selectedPick.team} · {selectedPick.prop}</div>
                </div>
              </div>
              <button className="close-btn" onClick={() => { setSelectedPick(null); setPlayerStats(null); }}><span className="material-icons">close</span></button>
            </div>
            <div className="add-pick-modal-body">
              {playerStats ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                    {[
                      { label: "L3 AVG", val: playerStats.l3?.avg || "—" },
                      { label: "L7 AVG", val: playerStats.l7?.avg || "—" },
                      { label: "Streak", val: playerStats.streak ? `${playerStats.streak}G` : "—" },
                      { label: "Season", val: playerStats.season?.avg || "—" },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: "center", padding: "10px 0", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--navy)" }}>{s.val}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {playerStats.gamelog?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "1px" }}>Recent Games</div>
                      <table style={{ fontSize: 11, width: "100%" }}>
                        <thead><tr><th>Date</th><th>H</th><th>AB</th><th>AVG</th><th>HR</th><th>RBI</th></tr></thead>
                        <tbody>
                          {playerStats.gamelog.map((g, i) => (
                            <tr key={i}>
                              <td className="td-mono" style={{ color: "var(--text-muted)" }}>{g.date}</td>
                              <td className="td-mono" style={{ fontWeight: parseInt(g.hits) > 0 ? 700 : 400, color: parseInt(g.hits) > 0 ? "var(--accent)" : undefined }}>{g.hits}</td>
                              <td className="td-mono">{g.atBats}</td>
                              <td className="td-mono">{g.avg}</td>
                              <td className="td-mono">{g.homeRuns}</td>
                              <td className="td-mono">{g.rbi}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>
                  <div className="spinner" style={{ margin: "0 auto 8px" }} />Loading stats...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <AddPickModal
          prefill={prefill}
          today={today}
          onAdd={addPick}
          onClose={() => { setShowAdd(false); setPrefill({}); }}
        />
      )}
    </div>
  );
}

// ── Add Pick Modal ────────────────────────────────────────────────────────────
function AddPickModal({ prefill, today, onAdd, onClose }) {
  const [query, setQuery]           = useState(prefill.playerName || "");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching]   = useState(false);
  const [selected, setSelected]     = useState(prefill.playerId ? prefill : null);
  const [prop, setProp]             = useState(prefill.prop || "1+ Hits");
  const [notes, setNotes]           = useState("");
  const [todayGames, setTodayGames] = useState([]);
  const [todayRosters, setTodayRosters] = useState({}); // playerId -> game context

  // Load today's slate on mount to enable instant matching
  useEffect(() => {
    let cancelled = false;
    async function loadSlate() {
      try {
        const { games } = await fetchGames(today);
        if (cancelled) return;
        setTodayGames(games);
        // Build player -> game context map
        const rosterMap = {};
        await Promise.allSettled(games.map(async (game) => {
          for (const side of ["home", "away"]) {
            const team = game[side];
            const oppSide = side === "home" ? "away" : "home";
            const opp = game[oppSide];
            try {
              const roster = await fetchRoster(team.teamId);
              for (const p of roster) {
                rosterMap[p.id] = {
                  playerId: p.id,
                  playerName: p.name,
                  team: team.abbr,
                  teamId: team.teamId,
                  opponent: opp.abbr,
                  opponentSP: game[oppSide].pitcher ? game[oppSide].pitcher.name : null,
                  venue: game.venue,
                  gameDate: game.gameDate,
                  gamePk: game.gamePk,
                  batSide: p.batSide,
                  position: p.position,
                };
              }
            } catch {}
          }
        }));
        if (!cancelled) setTodayRosters(rosterMap);
      } catch {}
    }
    loadSlate();
    return () => { cancelled = true; };
  }, [today]);

  // Search: first check today's rosters (instant), then fall back to API search
  useEffect(() => {
    if (selected) return; // already selected, don't search
    if (query.length < 2) { setSuggestions([]); return; }

    const q = query.toLowerCase();

    // Instant local match from today's rosters
    const localMatches = Object.values(todayRosters)
      .filter(p => p.playerName.toLowerCase().includes(q))
      .slice(0, 8);

    if (localMatches.length > 0) {
      setSuggestions(localMatches.map(p => ({
        ...p,
        isToday: true,
        label: `${p.playerName} · ${p.team} vs ${p.opponent}`,
      })));
      return;
    }

    // Debounced API search for players not in today's slate
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlayers(query);
        setSuggestions(results.map(p => ({
          playerId: p.id,
          playerName: p.name,
          team: "",
          opponent: "",
          opponentSP: null,
          position: p.position,
          batSide: p.batSide,
          isToday: false,
          label: `${p.name} · ${p.position || ""}`,
        })));
      } catch {}
      setSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, selected, todayRosters]);

  function handleSelect(s) {
    setSelected(s);
    setQuery(s.playerName);
    setSuggestions([]);
  }

  function handleClear() {
    setSelected(null);
    setQuery("");
    setSuggestions([]);
  }

  function handleSubmit() {
    if (!selected && !query.trim()) return;
    const name = selected ? selected.playerName : query.trim();
    onAdd({
      playerName: name,
      playerId: selected ? selected.playerId : null,
      team: selected ? selected.team : "",
      opponent: selected ? (selected.opponentSP || selected.opponent) : "",
      date: selected && selected.gameDate ? selected.gameDate.split("T")[0] : today,
      gamePk: selected ? selected.gamePk : null,
      prop,
      hitScore: prefill.hitScore || null,
      notes,
    });
  }

  return (
    <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="add-pick-modal" style={{ maxWidth: 420 }}>
        <div className="add-pick-modal-header">
          <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "white" }}>Log a Pick</span>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div className="add-pick-modal-body" style={{ gap: 10 }}>
          {/* Player search */}
          <div className="form-field" style={{ position: "relative" }}>
            <label className="form-label">Player *</label>
            <div style={{ position: "relative" }}>
              <span className="material-icons" style={{ position: "absolute", left: 10, top: 10, fontSize: 16, color: "var(--text-muted)" }}>search</span>
              <input className="form-input" value={query}
                onChange={e => { setQuery(e.target.value); if (selected) setSelected(null); }}
                placeholder="Start typing a player name..."
                autoFocus
                style={{ paddingLeft: 32 }} />
              {selected && (
                <button onClick={handleClear} style={{ position: "absolute", right: 8, top: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
                  <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                </button>
              )}
            </div>

            {/* Dropdown */}
            {suggestions.length > 0 && !selected && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0 0 8px 8px",
                maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)"
              }}>
                {suggestions.map((s, i) => (
                  <div key={s.playerId || i} onClick={() => handleSelect(s)}
                    style={{
                      padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                      borderBottom: "1px solid var(--border)", transition: "background 0.1s"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; }}>
                    <img src={headshot(s.playerId)}
                      alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", background: "var(--surface-2)", flexShrink: 0 }}
                      onError={e => { e.target.style.display = "none"; }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.playerName}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {s.isToday
                          ? `${s.team} vs ${s.opponent}${s.opponentSP ? " (SP: " + s.opponentSP + ")" : ""} · Today`
                          : `${s.position || ""} · ${s.batSide ? s.batSide + "HB" : ""}`
                        }
                      </div>
                    </div>
                    {s.isToday && (
                      <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, background: "var(--accent)", color: "white", padding: "2px 6px", borderRadius: 4, flexShrink: 0 }}>TODAY</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {searching && !selected && query.length >= 2 && suggestions.length === 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0 0 8px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                Searching...
              </div>
            )}
          </div>

          {/* Auto-filled context */}
          {selected && (
            <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center" }}>
              <img src={headshot(selected.playerId)}
                alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", background: "var(--surface)", flexShrink: 0 }}
                onError={e => { e.target.style.display = "none"; }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.playerName}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                  {selected.team && <span className="badge badge-navy" style={{ fontSize: 9 }}>{selected.team}</span>}
                  {selected.opponent && <span style={{ fontSize: 11 }}>vs {selected.opponent}</span>}
                  {selected.opponentSP && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>SP: {selected.opponentSP}</span>}
                  {selected.position && <span style={{ fontSize: 10 }}>{selected.position}</span>}
                  {selected.batSide && <span style={{ fontSize: 10 }}>{selected.batSide}HB</span>}
                </div>
              </div>
            </div>
          )}

          {/* Prop type */}
          <div className="form-field">
            <label className="form-label">Prop Type</label>
            <div className="chip-group">
              {PROP_TYPES.map(t => (
                <button key={t} type="button" className={`chip ${prop === t ? "active" : ""}`}
                  onClick={() => setProp(t)} style={{ fontSize: 11 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="form-field">
            <label className="form-label">Notes (optional)</label>
            <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Hot streak, good platoon matchup..." />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit}
              disabled={!selected && !query.trim()}>
              <span className="material-icons">check</span>Log Pick
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
