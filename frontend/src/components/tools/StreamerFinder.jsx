import { useState, useEffect } from "react";
import {
  fetchGames, fetchPitcherStats, fetchPitcherGameLog,
  PARK_FACTORS, headshot,
} from "../../utils/mlbApi";

// "Available in X% of leagues" = pitcher is NOT rostered in X% of leagues
// So availablePct = 100 - rosterPct
// We filter to show pitchers where availablePct >= threshold (i.e. widely available)
const AVAILABILITY_THRESHOLDS = [
  { label: "50%+ leagues",  value: 50,  desc: "Rostered in fewer than half of leagues" },
  { label: "60%+ leagues",  value: 60,  desc: "Moderate availability" },
  { label: "75%+ leagues",  value: 75,  desc: "Widely available" },
  { label: "90%+ leagues",  value: 90,  desc: "Almost universally available" },
  { label: "Show all",      value: 0,   desc: "All starting pitchers" },
];

// Simulate roster% from pitcher name hash — in production this would come from
// an ESPN/Yahoo fantasy API or a manually maintained dataset.
// We use ERA/WHIP as a proxy: low-profile pitchers (high ERA, low IP) = low rostered%
function estimateRosterPct(stats) {
  const era  = parseFloat(stats?.era)  || 4.50;
  const ip   = parseFloat(stats?.inningsPitched) || 0;
  const whip = parseFloat(stats?.whip) || 1.40;
  const k9   = parseFloat(stats?.strikeoutsPer9Inn) || 7.0;

  // Elite pitchers (low ERA, high IP) = highly rostered
  // Fringe streamers (moderate ERA, low IP) = available
  let pct = 80;
  if (era > 5.00) pct -= 30;
  else if (era > 4.50) pct -= 20;
  else if (era > 4.00) pct -= 10;
  if (ip < 20)  pct -= 25;
  else if (ip < 50)  pct -= 15;
  else if (ip < 80)  pct -= 5;
  if (whip > 1.40) pct -= 10;
  if (k9 > 9.0)  pct += 10;
  return Math.max(2, Math.min(98, Math.round(pct)));
}

// Compute pitcher streamability score (0–100)
function computeStreamerScore({ pitStats, pitLog, game, rosterPct }) {
  let score = 50;
  const era   = parseFloat(pitStats?.era)  || 4.50;
  const whip  = parseFloat(pitStats?.whip) || 1.40;
  const k9    = parseFloat(pitStats?.strikeoutsPer9Inn) || 7.0;
  const ip    = parseFloat(pitStats?.inningsPitched) || 0;
  const wins  = parseInt(pitStats?.wins) || 0;

  // Recent form: last 2 starts
  const recent = (pitLog || []).slice(0, 2);
  const recentEra = recent.length
    ? recent.reduce((s, g) => s + (parseFloat(g.era) || 4.50), 0) / recent.length
    : era;
  const recentQS = recent.filter(g => parseInt(g.inningsPitched) >= 6 && (parseFloat(g.earnedRuns) || 0) <= 3).length;

  // ERA quality
  if (era < 3.00) score += 20;
  else if (era < 3.75) score += 12;
  else if (era < 4.50) score += 5;
  else if (era > 5.50) score -= 15;

  // Recent form boost/penalty
  if (recentEra < era - 0.75) score += 10; // trending better
  else if (recentEra > era + 1.00) score -= 10; // trending worse
  if (recentQS === 2) score += 12;
  else if (recentQS === 1) score += 5;

  // K/9 — strikeout upside matters for fantasy
  if (k9 >= 10.5) score += 15;
  else if (k9 >= 9.0) score += 8;
  else if (k9 >= 7.5) score += 3;
  else if (k9 < 6.0) score -= 8;

  // WHIP
  if (whip < 1.10) score += 10;
  else if (whip < 1.25) score += 5;
  else if (whip > 1.45) score -= 8;

  // Sample size — more IP = more reliable
  if (ip > 100) score += 8;
  else if (ip > 60) score += 4;
  else if (ip < 20) score -= 10;

  // Park factor — pitcher-friendly parks are good for streamers
  const pf = PARK_FACTORS[game?.venue] || { factor: 100 };
  if (pf.factor < 95) score += 8;
  else if (pf.factor > 108) score -= 8;

  // Home/away — home starters get a slight edge
  const isHome = game?.home?.pitcher?.id === pitStats?.id || false;
  if (isHome) score += 3;

  // Availability bonus — rarer = higher value if they score well
  if (rosterPct <= 10) score += 5;
  else if (rosterPct <= 30) score += 2;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getTier(score) {
  if (score >= 72) return { label: "Streamer+", color: "#15803D", bg: "rgba(21,128,61,0.10)", border: "rgba(21,128,61,0.22)" };
  if (score >= 58) return { label: "Solid", color: "#1D4ED8", bg: "rgba(29,78,216,0.09)", border: "rgba(29,78,216,0.22)" };
  if (score >= 44) return { label: "Speculative", color: "#D97706", bg: "rgba(217,119,6,0.09)", border: "rgba(217,119,6,0.22)" };
  return { label: "Risky", color: "#DC2626", bg: "rgba(220,38,38,0.09)", border: "rgba(220,38,38,0.22)" };
}

export default function StreamerFinder({ isPremium, onUpgrade }) {
  const [date, setDate]       = useState(new Date().toLocaleDateString("en-CA"));
  const [streamers, setStreamers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(60); // show pitchers available in 60%+ of leagues
  const [sortBy, setSortBy]   = useState("score");
  const [handFilter, setHandFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [error, setError]     = useState(null);

  useEffect(() => { load(); }, [date]);

  async function load() {
    setLoading(true);
    setError(null);
    setStreamers([]);
    try {
      const { games } = await fetchGames(date);
      const active = games.filter(g => !g.isPostponed && !g.isCancelled);
      if (active.length === 0) {
        setError("No games scheduled for this date.");
        return;
      }

      const season = new Date(date).getFullYear();
      const results = [];

      await Promise.allSettled(
        active.flatMap(game => ["home", "away"].map(async side => {
          const pitcher = game[side].pitcher;
          if (!pitcher?.id) return;
          try {
            const [pitStats, pitLog] = await Promise.all([
              fetchPitcherStats(pitcher.id, season),
              fetchPitcherGameLog(pitcher.id, season),
            ]);
            const rosterPct = estimateRosterPct(pitStats);
            const availablePct = 100 - rosterPct; // % of leagues where pitcher is NOT rostered
            const score = computeStreamerScore({ pitStats, pitLog, game, rosterPct });
            const recent = (pitLog || []).slice(0, 2);
            const recentQS = recent.filter(g => parseInt(g.inningsPitched) >= 6 && (parseFloat(g.earnedRuns) || 0) <= 3).length;

            results.push({
              pitcher,
              pitStats,
              pitLog: pitLog || [],
              game,
              side,
              rosterPct,
              availablePct,
              score,
              tier: getTier(score),
              opponent: game[side === "home" ? "away" : "home"],
              recentQS,
              recent,
            });
          } catch { /* skip */ }
        }))
      );

      setStreamers(results);
    } catch (e) {
      setError("Failed to load pitcher data. Try refreshing.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = streamers
    .filter(s => threshold === 0 || s.availablePct >= threshold)
    .filter(s => handFilter === "all" || (handFilter === "L" && s.pitStats?.pitchHand?.code === "L") || (handFilter === "R" && s.pitStats?.pitchHand?.code === "R"))
    .sort((a, b) => sortBy === "score" ? b.score - a.score : sortBy === "era" ? (parseFloat(a.pitStats?.era) || 99) - (parseFloat(b.pitStats?.era) || 99) : b.availablePct - a.availablePct);

  const topPick = filtered[0];

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Fantasy Streamer Finder</h1>
          <p className="page-subtitle">Pitchers available in most leagues — ready to stream today</p>
        </div>
        <div className="page-actions">
          <input type="date" className="filter-input" value={date} onChange={e => setDate(e.target.value)} style={{ height: 36, fontSize: 13 }} />
          <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>
            <span className="material-icons">refresh</span>{loading ? "Loading..." : "Find Streamers"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <div className="filter-group">
          <span className="filter-label">Available in</span>
          <div className="chip-group">
            {AVAILABILITY_THRESHOLDS.map(t => (
              <button key={t.value} className={`chip ${threshold === t.value ? "active" : ""}`}
                onClick={() => setThreshold(t.value)}>{t.label}</button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Handedness</span>
          <div className="chip-group">
            {[["all","All"],["R","RHP"],["L","LHP"]].map(([v,l]) => (
              <button key={v} className={`chip ${handFilter === v ? "active" : ""}`}
                onClick={() => setHandFilter(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Sort</span>
          <div className="chip-group">
            {[["score","Score"],["era","ERA"],["availablePct","Availability"]].map(([v,l]) => (
              <button key={v} className={`chip ${sortBy === v ? "active" : ""}`}
                onClick={() => setSortBy(v)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="loading"><div className="spinner" />Scoring today's starters...</div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">cloud_off</span></div>
          <div className="empty-title">{error}</div>
        </div>
      )}

      {/* Top pick highlight */}
      {!loading && !error && topPick && (
        <div style={{ background: "linear-gradient(135deg, var(--accent-dark), var(--navy-dark))", borderRadius: 14, padding: "18px 22px", marginBottom: 18, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <img src={headshot(topPick.pitcher.id)} alt={topPick.pitcher.name}
            style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,0.2)", flexShrink: 0 }}
            onError={e => { e.target.src = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/v1/people/${topPick.pitcher.id}/headshot/67/current`; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.5)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 3 }}>
              🔥 Today's Top Streamer Pick
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: "white", marginBottom: 4 }}>
              {topPick.pitcher.name}
              <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.55)", marginLeft: 10 }}>
                {topPick.side === "home" ? "vs" : "@"} {topPick.opponent.abbr} · {topPick.game.venue}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, background: "rgba(255,255,255,0.12)", borderRadius: 6, padding: "2px 8px", color: "white" }}>
                ERA {topPick.pitStats?.era || "—"}
              </span>
              <span style={{ fontSize: 11, background: "rgba(255,255,255,0.12)", borderRadius: 6, padding: "2px 8px", color: "white" }}>
                WHIP {topPick.pitStats?.whip || "—"}
              </span>
              <span style={{ fontSize: 11, background: "rgba(255,255,255,0.12)", borderRadius: 6, padding: "2px 8px", color: "white" }}>
                K/9 {topPick.pitStats?.strikeoutsPer9Inn || "—"}
              </span>
              <span style={{ fontSize: 11, background: "rgba(74,222,128,0.20)", borderRadius: 6, padding: "2px 8px", color: "#4ADE80", fontWeight: 700 }}>
                ~{topPick.availablePct}% available
              </span>
            </div>
          </div>
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 42, fontWeight: 900, color: "white", lineHeight: 1 }}>{topPick.score}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1 }}>Stream Score</div>
          </div>
        </div>
      )}

      {/* Results table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header">
            <span className="card-title">
              <span className="material-icons">cloud_download</span>
              Available Streamers — {filtered.length} pitcher{filtered.length !== 1 ? "s" : ""} available in {threshold === 0 ? "all leagues" : `${threshold}%+ of leagues`}
            </span>
          </div>
          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pitcher</th>
                  <th>Opp</th>
                  <th data-tooltip="Estimated roster % in fantasy leagues">~Rostered</th>
                  <th data-tooltip="Season ERA">ERA</th>
                  <th data-tooltip="Season WHIP">WHIP</th>
                  <th data-tooltip="Strikeouts per 9 innings">K/9</th>
                  <th data-tooltip="Quality starts in last 2">QS L2</th>
                  <th data-tooltip="Park factor — lower = pitcher friendly">Park</th>
                  <th data-tooltip="DiamondIQ streamer composite score">Score</th>
                  <th>Tier</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const pf = PARK_FACTORS[s.game?.venue] || { factor: 100 };
                  const pfColor = pf.factor < 95 ? "var(--data-green)" : pf.factor > 108 ? "var(--data-red)" : "var(--text-muted)";
                  return (
                    <tr key={`${s.pitcher.id}-${s.game.gamePk}`}
                      onClick={() => setSelected(s === selected ? null : s)}
                      style={{ cursor: "pointer", background: selected === s ? "var(--surface-2)" : undefined }}>
                      <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{i + 1}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <img src={headshot(s.pitcher.id)} alt=""
                            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
                            onError={e => { e.target.style.display = "none"; }} />
                          <div>
                            <div className="td-player">{s.pitcher.name}</div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                              {s.pitStats?.pitchHand?.code || "?"} · {s.side === "home" ? "HOME" : "AWAY"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{s.side === "home" ? "vs" : "@"} {s.opponent.abbr}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.opponent.team?.split(" ").pop()}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, fontWeight: 700, color: s.availablePct >= 90 ? "var(--data-green)" : s.availablePct >= 70 ? "var(--data-yellow)" : "var(--text-secondary)" }}>
                          ~{s.availablePct}%
                        </span>
                      </td>
                      <td style={{ color: parseFloat(s.pitStats?.era) < 3.75 ? "var(--data-green)" : parseFloat(s.pitStats?.era) > 5.00 ? "var(--data-red)" : "var(--text-primary)", fontWeight: 700 }}>
                        {s.pitStats?.era || "—"}
                      </td>
                      <td style={{ color: parseFloat(s.pitStats?.whip) < 1.15 ? "var(--data-green)" : parseFloat(s.pitStats?.whip) > 1.40 ? "var(--data-red)" : "var(--text-primary)" }}>
                        {s.pitStats?.whip || "—"}
                      </td>
                      <td style={{ color: parseFloat(s.pitStats?.strikeoutsPer9Inn) >= 9 ? "var(--data-green)" : "var(--text-primary)" }}>
                        {s.pitStats?.strikeoutsPer9Inn || "—"}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {s.recentQS > 0
                          ? <span style={{ color: "var(--data-green)", fontWeight: 700 }}>{s.recentQS}/2</span>
                          : <span style={{ color: "var(--text-muted)" }}>0/2</span>}
                      </td>
                      <td style={{ color: pfColor, fontWeight: 600 }}>{pf.factor}</td>
                      <td>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 900, color: s.tier.color }}>{s.score}</div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: s.tier.bg, color: s.tier.color, border: `1px solid ${s.tier.border}`, fontSize: 9, fontWeight: 800 }}>
                          {s.tier.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && streamers.length > 0 && (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">search_off</span></div>
          <div className="empty-title">No streamers available in {threshold === 0 ? "all leagues" : `${threshold}%+ of leagues`} today</div>
          <div className="empty-sub">Try lowering the availability threshold — starting pitchers today may already be widely rostered.</div>
        </div>
      )}

      {/* Expanded pitcher detail */}
      {selected && (
        <div className="card" style={{ marginTop: 16, padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "var(--navy)" }}>
              {selected.pitcher.name} — Stream Analysis
            </div>
            <button className="close-btn" onClick={() => setSelected(null)}><span className="material-icons">close</span></button>
          </div>
          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              { label: "ERA",   val: selected.pitStats?.era || "—" },
              { label: "WHIP",  val: selected.pitStats?.whip || "—" },
              { label: "K/9",   val: selected.pitStats?.strikeoutsPer9Inn || "—" },
              { label: "IP",    val: selected.pitStats?.inningsPitched || "—" },
              { label: "W",     val: selected.pitStats?.wins || "0" },
              { label: "K",     val: selected.pitStats?.strikeOuts || "—" },
              { label: "Available", val: `~${selected.availablePct}% of leagues` },
              { label: "QS L2", val: `${selected.recentQS}/2` },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{s.val}</div>
              </div>
            ))}
          </div>
          {selected.recent.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>Recent Starts</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selected.recent.map((g, i) => (
                  <div key={i} style={{ display: "flex", gap: 16, fontSize: 12, padding: "8px 12px", borderRadius: 8, background: "var(--surface-2)", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text-muted)", minWidth: 80 }}>{g.gameDate?.slice(0, 10) || `Start ${i + 1}`}</span>
                    <span>{g.inningsPitched || "—"} IP</span>
                    <span style={{ color: parseFloat(g.earnedRuns) <= 2 ? "var(--data-green)" : "var(--data-red)" }}>
                      {g.earnedRuns ?? "?"} ER
                    </span>
                    <span>{g.strikeOuts ?? "?"} K</span>
                    <span style={{ color: parseInt(g.inningsPitched) >= 6 && parseFloat(g.earnedRuns) <= 3 ? "var(--data-green)" : "var(--text-muted)", fontWeight: 700, fontSize: 10 }}>
                      {parseInt(g.inningsPitched) >= 6 && parseFloat(g.earnedRuns) <= 3 ? "✓ QS" : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "var(--accent-bg)", border: "1px solid var(--accent-border)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-light)", marginBottom: 4 }}>
              <span className="material-icons" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 4 }}>tips_and_updates</span>
              Stream Recommendation
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {selected.score >= 72
                ? `${selected.pitcher.name} is a strong streamer pick — solid ratios, favorable matchup${selected.recentQS >= 1 ? ", and quality start in recent starts" : ""}. Worth picking up in leagues where available.`
                : selected.score >= 58
                ? `${selected.pitcher.name} is a speculative but reasonable stream. Check your league's acquisition limits before adding.`
                : `${selected.pitcher.name} carries risk. Consider only in deep leagues or if desperate for a start.`}
              {` Available in an estimated ~${selected.availablePct}% of fantasy leagues — a good streaming target.`}
            </div>
          </div>
        </div>
      )}

      {/* Info footer */}
      <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>
          <span className="material-icons" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 4 }}>info</span>
          <strong>How this works:</strong> The Streamer Score weighs ERA, WHIP, K/9, recent quality starts, park factor, and availability. Roster% is estimated based on pitcher profile — actual availability varies by platform and league settings. Always confirm availability in your app before picking up.
        </div>
      </div>
    </div>
  );
}
