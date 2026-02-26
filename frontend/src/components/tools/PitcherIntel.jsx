import { useState, useEffect } from "react";
import { fetchGames, fetchPitcherStats, fetchPitcherGameLog, fetchPersonInfo, avgColor } from "../../utils/mlbApi";

const SEASON = new Date().getFullYear();

export default function PitcherIntel() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [pitchers, setPitchers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState("hittability");
  const [sortDir, setSortDir] = useState("desc");
  const [filterHand, setFilterHand] = useState("all");
  const [selectedPitcher, setSelectedPitcher] = useState(null);

  useEffect(() => { load(); }, [date]);

  async function load() {
    setLoading(true); setPitchers([]);
    try {
      const { games } = await fetchGames(date);
      const entries = [];
      for (const g of games) {
        for (const side of ["home","away"]) {
          const p = g[side].pitcher;
          if (p) entries.push({ pitcher: p, game: g, team: g[side] });
        }
      }
      const results = await Promise.allSettled(entries.map(e => loadPitcher(e)));
      setPitchers(results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadPitcher({ pitcher, game, team }) {
    // Resolve pitcher hand if missing
    if (!pitcher.hand) {
      try {
        const info = await fetchPersonInfo(pitcher.id);
        if (info) pitcher = { ...pitcher, hand: info.pitchHand || "?" };
      } catch { pitcher = { ...pitcher, hand: "?" }; }
    }

    const [stats, gl] = await Promise.allSettled([
      fetchPitcherStats(pitcher.id, SEASON),
      fetchPitcherGameLog(pitcher.id, SEASON),
    ]);
    let s = stats.value || {};
    let log = gl.value || [];

    // Spring training fallback when regular season data is empty
    if (!s.avg && !s.era) {
      const [stStats, stGL] = await Promise.allSettled([
        fetchPitcherStats(pitcher.id, SEASON, "S"),
        fetchPitcherGameLog(pitcher.id, SEASON, "S"),
      ]);
      if (!s.avg) s = stStats.value || s;
      if (!log.length) log = stGL.value || log;
    }
    const last2 = log.slice(0, 2);
    const last2Hits = last2.reduce((sum, g) => sum + (+g.hits||0), 0);
    const last2AVG = last2.reduce((sum, g) => sum + (+g.avg||0), 0) / (last2.length || 1);
    const last2Games = last2.length;
    const daysRest = log.length >= 1
      ? Math.round((Date.now() - new Date(log[0].date)) / 86400000)
      : 5;
    // Hittability: higher = easier to hit (bad pitcher = good for batters)
    const avgAgainst = parseFloat(s.avg) || 0.250;
    const era = parseFloat(s.era) || 4.0;
    const hittability = Math.round(Math.min(((avgAgainst / 0.400) * 50) + ((era / 10.0) * 50), 100));
    const isHot = last2AVG > 0.300 || last2Hits >= 14;
    const isCold = last2AVG < 0.200 && last2Games >= 2;
    return { pitcher, game, team, stats: s, last2, last2Hits, last2AVG, daysRest, hittability, isHot, isCold };
  }

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = pitchers
    .filter(p => filterHand === "all" || p.pitcher.hand === filterHand)
    .sort((a, b) => {
      const get = r => {
        if (sortCol === "hittability") return r.hittability;
        if (sortCol === "avg") return parseFloat(r.stats?.avg) || 0;
        if (sortCol === "era") return parseFloat(r.stats?.era) || 0;
        if (sortCol === "last2") return r.last2Hits;
        if (sortCol === "rest") return r.daysRest;
        return 0;
      };
      return sortDir === "desc" ? get(b) - get(a) : get(a) - get(b);
    });

  const hot = filtered.filter(p => p.isHot);
  const cold = filtered.filter(p => p.isCold);

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Pitcher Intel</h1>
          <p className="page-subtitle">Today's starters ranked by hittability — find the vulnerable arms</p>
        </div>
        <div className="page-actions">
          <input type="date" className="filter-input" value={date} onChange={e => setDate(e.target.value)} style={{ height: 36, fontSize: 13 }} />
          <button className="btn btn-ghost btn-sm" onClick={load}><span className="material-icons">refresh</span>Refresh</button>
        </div>
      </div>

      {/* Hot / Cold summary cards */}
      {!loading && pitchers.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ background: "var(--red-data-bg)", borderBottom: "1px solid var(--red-data-border)" }}>
              <span className="card-title" style={{ color: "var(--red-data)" }}>
                <span className="material-icons">local_fire_department</span>
                Getting Hit Hard (Last 2 Starts)
              </span>
              <span className="badge badge-red">{hot.length} pitchers</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Pitcher</th><th>Team</th><th>Last 2 H</th><th>AVG Against</th><th>HR</th></tr></thead>
                <tbody>
                  {hot.slice(0,8).map(p => (
                    <tr key={p.pitcher.id} onClick={() => setSelectedPitcher(p)} style={{ cursor: "pointer" }}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <img src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${p.pitcher.id}/headshot/67/current`}
                            alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", background: "var(--surface)", flexShrink: 0 }}
                            onError={e => { e.target.style.display = "none"; }} />
                          <div>
                            <div className="td-player">{p.pitcher.name}</div>
                            <span className={`badge ${p.pitcher.hand === "L" ? "hand-L" : "hand-R"}`} style={{fontSize:9}}>{p.pitcher.hand || "?"}HP</span>
                          </div>
                        </div>
                      </td>
                      <td style={{fontSize:11}}>{p.team.abbr}</td>
                      <td><span className="badge badge-red" style={{fontSize:11}}>{p.last2Hits} H</span></td>
                      <td className={`td-mono ${avgColor(p.stats?.avg)}`}>{p.stats?.avg || "—"}</td>
                      <td className="td-mono">{p.last2.reduce((s,g)=>s+(+g.homeRuns||0),0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ background: "var(--blue-data-bg)", borderBottom: "1px solid var(--blue-data-border)" }}>
              <span className="card-title" style={{ color: "var(--blue-data)" }}>
                <span className="material-icons">shield</span>
                Dealing (Cold for Hitters, Last 2)
              </span>
              <span className="badge badge-blue">{cold.length} pitchers</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Pitcher</th><th>Team</th><th>Last 2 H</th><th>AVG Against</th><th>K/9</th></tr></thead>
                <tbody>
                  {cold.slice(0,8).map(p => (
                    <tr key={p.pitcher.id} onClick={() => setSelectedPitcher(p)} style={{ cursor: "pointer" }}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <img src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${p.pitcher.id}/headshot/67/current`}
                            alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", background: "var(--surface)", flexShrink: 0 }}
                            onError={e => { e.target.style.display = "none"; }} />
                          <div>
                            <div className="td-player">{p.pitcher.name}</div>
                            <span className={`badge ${p.pitcher.hand === "L" ? "hand-L" : "hand-R"}`} style={{fontSize:9}}>{p.pitcher.hand || "?"}HP</span>
                          </div>
                        </div>
                      </td>
                      <td style={{fontSize:11}}>{p.team.abbr}</td>
                      <td><span className="badge badge-blue" style={{fontSize:11}}>{p.last2Hits} H</span></td>
                      <td className="td-mono">{p.stats?.avg || "—"}</td>
                      <td className="td-mono">{p.stats?.strikeoutsPer9Inn || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Handedness</span>
          <div className="chip-group">
            {["all","R","L"].map(h => (
              <button key={h} className={`chip ${filterHand === h ? "active" : ""}`} onClick={() => setFilterHand(h)}>
                {h === "all" ? "All" : `${h}HP`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginLeft: "auto", alignSelf: "flex-end" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{filtered.length} starters today</span>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading today's starters...</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header">
            <span className="card-title"><span className="material-icons">sports_baseball</span>All Today's Starters — Hittability Ranked</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Higher hittability = easier to hit today</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pitcher</th>
                  <th>Hand</th>
                  <th>Opposing Team</th>
                  <th>Venue</th>
                  <SortTh col="hittability" s={sortCol} d={sortDir} onClick={handleSort} tip="Composite hittability score — higher means easier for batters to hit. Combines AVG against, ERA, and sample data.">Hittability</SortTh>
                  <SortTh col="avg"  s={sortCol} d={sortDir} onClick={handleSort} tip="Batting average allowed — hits divided by at-bats faced this season">AVG Against</SortTh>
                  <SortTh col="era"  s={sortCol} d={sortDir} onClick={handleSort} tip="Earned Run Average — earned runs per 9 innings pitched">ERA</SortTh>
                  <th data-tooltip="Walks + Hits per Inning Pitched — lower is better for the pitcher" title="Walks + Hits per Inning Pitched — lower is better for the pitcher">WHIP</th>
                  <th data-tooltip="Strikeouts per 9 innings — higher means more dominant pitcher" title="Strikeouts per 9 innings — higher means more dominant pitcher">K/9</th>
                  <SortTh col="last2" s={sortCol} d={sortDir} onClick={handleSort} tip="Total hits allowed across last 2 starts — more hits = more hittable recently">Last 2 H</SortTh>
                  <SortTh col="rest"  s={sortCol} d={sortDir} onClick={handleSort} tip="Days since last start — 5+ days rest can mean rust or freshness">Days Rest</SortTh>
                  <th data-tooltip="Hittable = easier to hit today (target these pitchers). Tough = hard to hit (avoid their batters)." title="Hittable = easier to hit today (target these pitchers). Tough = hard to hit (avoid their batters).">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const hColor = p.hittability >= 65 ? "var(--red-data)" : p.hittability >= 50 ? "var(--yellow)" : "var(--green-light)";
                  const oppSide = p.game.home.teamId === p.team.teamId ? "away" : "home";
                  const opp = p.game[oppSide];
                  return (
                    <tr key={p.pitcher.id} onClick={() => setSelectedPitcher(p)} style={{ cursor: "pointer" }}>
                      <td style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{i+1}</td>
                      <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <img src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${p.pitcher.id}/headshot/67/current`}
                          alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", background: "var(--surface)", flexShrink: 0 }}
                          onError={e => { e.target.style.display = "none"; }} />
                        <span className="td-player" style={{ color: "var(--navy)" }}>{p.pitcher.name}</span>
                      </td>
                      <td><span className={`badge ${p.pitcher.hand === "L" ? "hand-L" : "hand-R"}`}>{p.pitcher.hand || "?"}HP</span></td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 700, background: "var(--navy)", color: "white", padding: "2px 7px", borderRadius: 5 }}>
                          {opp?.abbr}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.game.venue}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 60, height: 5, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${p.hittability}%`, background: hColor, borderRadius: 100 }} />
                          </div>
                          <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: hColor }}>{p.hittability}</span>
                        </div>
                      </td>
                      <td className={`td-mono ${avgColor(p.stats?.avg)}`}>{p.stats?.avg || "—"}</td>
                      <td className="td-mono">{p.stats?.era || "—"}</td>
                      <td className="td-mono">{p.stats?.whip || "—"}</td>
                      <td className="td-mono">{p.stats?.strikeoutsPer9Inn || "—"}</td>
                      <td>
                        <span className={`badge ${p.last2Hits >= 12 ? "badge-red" : p.last2Hits <= 6 ? "badge-blue" : "badge-gray"}`}>
                          {p.last2Hits} H
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${p.daysRest >= 5 ? "badge-green" : p.daysRest <= 3 ? "badge-yellow" : "badge-gray"}`}>
                          {p.daysRest}d
                        </span>
                      </td>
                      <td>
                        {p.isHot && <span className="badge badge-red" style={{fontSize:9}}><span className="material-icons" style={{fontSize:10}}>trending_up</span>Hittable — target</span>}
                        {p.isCold && <span className="badge badge-blue" style={{fontSize:9}}><span className="material-icons" style={{fontSize:10}}>shield</span>Tough — avoid</span>}
                        {!p.isHot && !p.isCold && <span className="badge badge-gray" style={{fontSize:9}}>Neutral</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPitcher && (
        <PitcherDetailPanel pitcher={selectedPitcher} onClose={() => setSelectedPitcher(null)} />
      )}
    </div>
  );
}

function PitcherDetailPanel({ pitcher: p, onClose }) {
  const stats = p.stats;
  const gamelog = p.gamelog || [];
  const last5 = gamelog.slice(0, 5);
  const teamName = p.team?.abbr || p.team?.name || "—";
  const hsUrl = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${p.pitcher.id}/headshot/67/current`;

  return (
    <div className="side-panel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="side-panel" style={{ width: "min(520px, 95vw)" }}>
        <div className="side-panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={hsUrl} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,0.1)" }}
              onError={e => { e.target.style.display = "none"; }} />
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "white" }}>
                {p.pitcher.name}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`badge ${p.pitcher.hand === "L" ? "hand-L" : "hand-R"}`} style={{ fontSize: 10 }}>{p.pitcher.hand || "?"}HP</span>
                {teamName} · {p.venue}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div className="side-panel-body">
          {/* Hittability breakdown */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-header"><span className="card-title"><span className="material-icons">analytics</span>Hittability Breakdown</span></div>
            <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--font-display)", color: p.hittability >= 80 ? "var(--red-data)" : p.hittability >= 50 ? "var(--yellow)" : "var(--green-light)" }}>{p.hittability}</div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.8px" }}>Hittability</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--navy)" }}>{stats?.era || "—"}</div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.8px" }}>ERA</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--navy)" }}>{stats?.whip || "—"}</div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.8px" }}>WHIP</div>
              </div>
            </div>
          </div>

          {/* Season stats */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-header"><span className="card-title"><span className="material-icons">bar_chart</span>Season Stats</span></div>
            <div style={{ padding: 12 }}>
              <table style={{ fontSize: 12, width: "100%" }}>
                <thead>
                  <tr>
                    <th data-tooltip="Innings pitched" title="Innings pitched">IP</th>
                    <th data-tooltip="Hits allowed" title="Hits allowed">H</th>
                    <th data-tooltip="Runs allowed" title="Runs allowed">R</th>
                    <th data-tooltip="Earned runs" title="Earned runs">ER</th>
                    <th data-tooltip="Walks issued" title="Walks issued">BB</th>
                    <th data-tooltip="Strikeouts" title="Strikeouts">K</th>
                    <th data-tooltip="Batting average against" title="Batting average against">AVG</th>
                    <th data-tooltip="Strikeouts per 9 innings" title="Strikeouts per 9 innings">K/9</th>
                    <th data-tooltip="Home runs allowed" title="Home runs allowed">HR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="td-mono">{stats?.inningsPitched || "—"}</td>
                    <td className="td-mono">{stats?.hits || "—"}</td>
                    <td className="td-mono">{stats?.runs || "—"}</td>
                    <td className="td-mono">{stats?.earnedRuns || "—"}</td>
                    <td className="td-mono">{stats?.baseOnBalls || "—"}</td>
                    <td className="td-mono">{stats?.strikeOuts || "—"}</td>
                    <td className={`td-mono ${avgColor(stats?.avg)}`} style={{ fontWeight: 700 }}>{stats?.avg || "—"}</td>
                    <td className="td-mono">{stats?.strikeoutsPer9Inn || "—"}</td>
                    <td className="td-mono">{stats?.homeRuns || "—"}</td>
                  </tr>
                </tbody>
              </table>
              {stats?.atBats && (
                <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
                  Sample: {stats.atBats} at-bats faced · {stats.battersFaced || "?"} batters faced
                </div>
              )}
            </div>
          </div>

          {/* Recent game log */}
          {last5.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="card-title"><span className="material-icons">history</span>Last {last5.length} Starts</span></div>
              <div style={{ padding: 0 }}>
                <table style={{ fontSize: 11, width: "100%" }}>
                  <thead><tr><th>Date</th><th>IP</th><th>H</th><th>ER</th><th>K</th><th>BB</th><th>HR</th></tr></thead>
                  <tbody>
                    {last5.map((g, i) => (
                      <tr key={i}>
                        <td className="td-mono" style={{ color: "var(--text-muted)" }}>{g.date}</td>
                        <td className="td-mono">{g.inningsPitched}</td>
                        <td className="td-mono" style={{ color: parseInt(g.hits) >= 6 ? "var(--red-data)" : undefined }}>{g.hits}</td>
                        <td className="td-mono">{g.earnedRuns}</td>
                        <td className="td-mono">{g.strikeOuts}</td>
                        <td className="td-mono">{g.baseOnBalls}</td>
                        <td className="td-mono">{g.homeRuns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortTh({ col, s, d, onClick, tip, children }) {
  return (
    <th className={s === col ? "sorted" : ""} onClick={() => onClick(col)} data-tooltip={tip} title={tip} style={{ cursor: "pointer" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {children}
        <span className="material-icons sort-icon" style={{ fontSize: 12 }}>
          {s === col ? (d === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
        </span>
      </span>
    </th>
  );
}
