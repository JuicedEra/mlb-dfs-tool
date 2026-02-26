import { useState, useRef } from "react";
import {
  fetchGames, fetchRoster, fetchGameLog, computeSplit, computeActiveStreak,
  fetchBvP, fetchPlatoonSplits, fetchDayNightSplits, fetchSeasonStats,
  fetchPitcherStats, fetchPitcherGameLog, fetchPersonInfo, PARK_FACTORS,
  computeHitScore, scoreColor, tierBadgeLabel, tierClass, headshot,
} from "../../utils/mlbApi";

const SEASON = new Date().getFullYear();

// Format date string helper
function fmtDate(d) { return d.toISOString().split("T")[0]; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// Fetch box score and extract who got hits
async function fetchBoxHits(gamePk) {
  try {
    const url = `/mlb-proxy/game/${gamePk}/boxscore`;
    const r = await fetch(url);
    if (!r.ok) return new Set();
    const data = await r.json();
    const hitSet = new Set();
    for (const side of ["home", "away"]) {
      const players = data.teams?.[side]?.players || {};
      for (const [, p] of Object.entries(players)) {
        const hits = p.stats?.batting?.hits;
        if (hits && Number(hits) > 0) hitSet.add(p.person?.id);
      }
    }
    return hitSet;
  } catch { return new Set(); }
}

export default function Backtester() {
  const today = new Date();
  const weekAgo = addDays(today, -7);
  const [startDate, setStartDate] = useState(fmtDate(weekAgo));
  const [endDate, setEndDate]     = useState(fmtDate(addDays(today, -1)));
  const [topN, setTopN]           = useState(2); // how many top picks per day to evaluate
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState({ day: "", done: 0, total: 0, msg: "" });
  const [results, setResults]     = useState(null); // { days: [...], summary }
  const abortRef = useRef(false);

  async function run() {
    abortRef.current = false;
    setRunning(true); setResults(null);

    const start = new Date(startDate + "T12:00:00");
    const end   = new Date(endDate + "T12:00:00");
    const days  = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(fmtDate(d));

    setProgress({ day: "", done: 0, total: days.length, msg: "Starting backtest..." });

    const dayResults = [];

    for (let di = 0; di < days.length; di++) {
      if (abortRef.current) break;
      const date = days[di];
      setProgress({ day: date, done: di, total: days.length, msg: `Scoring ${date}...` });

      try {
        // 1. Fetch games for this date
        const { games } = await fetchGames(date);
        if (!games.length) { dayResults.push({ date, picks: [], note: "No games" }); continue; }

        // 2. Score all batters (simplified — use roster, no lineup API for past games)
        const allBatters = [];
        for (const game of games) {
          if (!game.home.pitcher && !game.away.pitcher) continue;
          for (const side of ["home", "away"]) {
            const battingTeam = game[side];
            const pitchingSide = side === "home" ? "away" : "home";
            const pitcher = game[pitchingSide].pitcher;
            if (!pitcher) continue;
            try {
              const roster = await fetchRoster(battingTeam.teamId);
              for (const batter of roster.slice(0, 13)) {
                allBatters.push({ batter, pitcher, game, battingTeam, pitchingSide });
              }
            } catch { /* skip */ }
          }
        }

        // 3. Compute scores (batches of 8 for speed)
        const scored = [];
        const BATCH = 8;
        for (let i = 0; i < allBatters.length; i += BATCH) {
          if (abortRef.current) break;
          const batch = allBatters.slice(i, i + BATCH);
          const res = await Promise.allSettled(batch.map(b => scoreBatter(b, SEASON)));
          for (const r of res) {
            if (r.status === "fulfilled" && r.value) scored.push(r.value);
          }
        }

        scored.sort((a, b) => b.score - a.score);
        const topPicks = scored.slice(0, topN);

        // 4. Fetch actual box scores and check hits
        const hitSets = new Map();
        await Promise.allSettled(
          games.map(async g => {
            hitSets.set(g.gamePk, await fetchBoxHits(g.gamePk));
          })
        );

        const picks = topPicks.map(p => {
          const actualHits = hitSets.get(p.gamePk);
          const gotHit = actualHits ? actualHits.has(p.batterId) : null;
          return { ...p, gotHit };
        });

        dayResults.push({ date, picks });
      } catch (e) {
        dayResults.push({ date, picks: [], note: e.message });
      }
    }

    // Summary stats
    let totalPicks = 0, wins = 0, losses = 0, unknown = 0;
    const tierHits = { elite: [0,0], strong: [0,0], solid: [0,0], risky: [0,0] };
    for (const day of dayResults) {
      for (const p of day.picks) {
        totalPicks++;
        if (p.gotHit === true) { wins++; if (tierHits[p.tier]) { tierHits[p.tier][0]++; tierHits[p.tier][1]++; } }
        else if (p.gotHit === false) { losses++; if (tierHits[p.tier]) tierHits[p.tier][1]++; }
        else unknown++;
      }
    }

    setResults({
      days: dayResults,
      summary: { totalPicks, wins, losses, unknown, winRate: totalPicks - unknown > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "—", tierHits },
    });
    setProgress(p => ({ ...p, done: days.length, msg: "Complete" }));
    setRunning(false);
  }

  function abort() { abortRef.current = true; }

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Backtester</h1>
          <p className="page-subtitle">Run the Hit Score algorithm on past dates and verify against actual box scores</p>
        </div>
      </div>

      {/* Config */}
      <div className="card" style={{ padding: "18px 22px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <div className="form-field">
            <label className="form-label">Start Date</label>
            <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={running} />
          </div>
          <div className="form-field">
            <label className="form-label">End Date</label>
            <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={running} />
          </div>
          <div className="form-field">
            <label className="form-label">Top N Picks / Day</label>
            <select className="form-select" value={topN} onChange={e => setTopN(Number(e.target.value))} disabled={running}>
              {[1,2,3,5,10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={run} disabled={running}>
              <span className="material-icons">science</span>
              {running ? "Running..." : "Run Backtest"}
            </button>
            {running && (
              <button className="btn btn-sm" onClick={abort} style={{ background: "var(--surface-2)", color: "var(--red-data)", border: "1px solid var(--border)" }}>
                <span className="material-icons">stop</span> Stop
              </button>
            )}
          </div>
        </div>
        {running && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div className="spinner" />
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{progress.msg}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>{progress.done}/{progress.total} days</span>
            </div>
            <div style={{ height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--navy)", borderRadius: 100, width: `${(progress.done / progress.total) * 100}%`, transition: "width 0.3s" }} />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <>
          {/* Summary Cards */}
          <div className="section-label">Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
            <SummaryCard label="Total Picks" value={results.summary.totalPicks} icon="format_list_numbered" />
            <SummaryCard label="Hits (Wins)" value={results.summary.wins} icon="check_circle" color="var(--green-light)" />
            <SummaryCard label="No Hit (Loss)" value={results.summary.losses} icon="cancel" color="var(--red-data)" />
            <SummaryCard label="Hit Rate" value={`${results.summary.winRate}%`} icon="percent"
              color={parseFloat(results.summary.winRate) >= 70 ? "var(--green-light)" : parseFloat(results.summary.winRate) >= 55 ? "var(--yellow)" : "var(--red-data)"} />
          </div>

          {/* Tier Breakdown */}
          <div className="card" style={{ padding: "16px 20px", marginBottom: 20 }}>
            <div className="card-header" style={{ padding: 0, marginBottom: 12 }}>
              <span className="card-title"><span className="material-icons">leaderboard</span>Hit Rate by Tier</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {["elite", "strong", "solid", "risky"].map(tier => {
                const [w, t] = results.summary.tierHits[tier] || [0,0];
                const pct = t > 0 ? ((w / t) * 100).toFixed(0) : "—";
                return (
                  <div key={tier} style={{ textAlign: "center", padding: "10px 0" }}>
                    <span className={`badge ${tierClass(tier)}`} style={{ fontSize: 10, marginBottom: 6, display: "inline-block" }}>{tierBadgeLabel(tier)}</span>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: pct !== "—" && Number(pct) >= 65 ? "var(--green-light)" : "var(--text-primary)" }}>{pct}{pct !== "—" && "%"}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{w}/{t} picks</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Day-by-Day */}
          <div className="section-label">Day-by-Day Results</div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Pick</th>
                    <th>Team</th>
                    <th>vs SP</th>
                    <th>Score</th>
                    <th>Tier</th>
                    <th style={{ width: 80 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {results.days.map(day =>
                    day.picks.length === 0 ? (
                      <tr key={day.date}>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{day.date}</td>
                        <td colSpan={6} style={{ color: "var(--text-muted)", fontSize: 12 }}>{day.note || "No data"}</td>
                      </tr>
                    ) : day.picks.map((p, pi) => (
                      <tr key={`${day.date}-${pi}`}>
                        {pi === 0 && <td rowSpan={day.picks.length} style={{ fontFamily: "var(--font-mono)", fontSize: 12, verticalAlign: "top" }}>{day.date}</td>}
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <img src={headshot(p.batterId)} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", background: "var(--surface-2)" }}
                              onError={e => { e.target.style.display = "none"; }} />
                            <span style={{ fontWeight: 600, fontSize: 12 }}>{p.batterName}</span>
                          </div>
                        </td>
                        <td><span style={{ fontSize: 11, fontWeight: 700, background: "var(--navy)", color: "white", padding: "2px 7px", borderRadius: 5 }}>{p.teamAbbr}</span></td>
                        <td style={{ fontSize: 12 }}>{p.pitcherName} <span className={`badge ${p.pitcherHand === "L" ? "hand-L" : "hand-R"}`} style={{ fontSize: 9 }}>{p.pitcherHand}HP</span></td>
                        <td><span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: scoreColor(p.score) }}>{p.score}</span></td>
                        <td><span className={`badge ${tierClass(p.tier)}`} style={{ fontSize: 9 }}>{tierBadgeLabel(p.tier)}</span></td>
                        <td>
                          {p.gotHit === true && <span className="badge badge-green" style={{ fontSize: 10 }}><span className="material-icons" style={{ fontSize: 12 }}>check</span> HIT</span>}
                          {p.gotHit === false && <span className="badge badge-red" style={{ fontSize: 10 }}><span className="material-icons" style={{ fontSize: 12 }}>close</span> NO HIT</span>}
                          {p.gotHit === null && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>N/A</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!running && !results && (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">science</span></div>
          <div className="empty-title">No backtest results yet</div>
          <div className="empty-sub">Select a date range and click "Run Backtest" to evaluate the algorithm against real outcomes</div>
        </div>
      )}
    </div>
  );
}

// Simplified scorer for backtesting (no lineup data, no prop lines)
async function scoreBatter({ batter, pitcher, game, battingTeam, pitchingSide }, season) {
  try {
    // Resolve pitcher hand if missing
    if (!pitcher.hand || pitcher.hand === "?") {
      try {
        const info = await fetchPersonInfo(pitcher.id);
        if (info) pitcher = { ...pitcher, hand: info.pitchHand || "R" };
      } catch { pitcher = { ...pitcher, hand: "R" }; }
    }

    const [gamelog, bvp, platoon, dayNight, seasonS, pitcherStat, pitcherLog] = await Promise.allSettled([
      fetchGameLog(batter.id, season),
      fetchBvP(batter.id, pitcher.id),
      fetchPlatoonSplits(batter.id, season),
      fetchDayNightSplits(batter.id, season),
      fetchSeasonStats(batter.id, season),
      fetchPitcherStats(pitcher.id, season),
      fetchPitcherGameLog(pitcher.id, season),
    ]);
    let gl = gamelog.value || [];
    let bvpStat = bvp.value;
    let platData = platoon.value || {};
    let dnData = dayNight.value || {};
    let seasonStat = seasonS.value || {};
    let pitStat = pitcherStat.value || {};
    let pitLog = pitcherLog.value || [];

    // Spring training fallback when regular season data is thin
    const isThin = gl.length < 5 || !seasonStat.avg;
    if (isThin) {
      const [stGL, stSeason, stPitStat, stPitLog] = await Promise.allSettled([
        fetchGameLog(batter.id, season, "S"),
        fetchSeasonStats(batter.id, season, "S"),
        fetchPitcherStats(pitcher.id, season, "S"),
        fetchPitcherGameLog(pitcher.id, season, "S"),
      ]);
      if (gl.length < 5) gl = [...gl, ...(stGL.value || [])];
      if (!seasonStat.avg) seasonStat = stSeason.value || seasonStat;
      if (!pitStat.avg) pitStat = stPitStat.value || pitStat;
      if (!pitLog.length) pitLog = stPitLog.value || pitLog;
    }

    const l7 = computeSplit(gl, 7);
    const l15 = computeSplit(gl, 15);
    const platoonKey = pitcher.hand === "L" ? "vs. Left" : "vs. Right";
    const platoonStat = platData[platoonKey] || {};
    const dnKey = game.isNight ? "Night" : "Day";
    const dayNightStat = dnData[dnKey] || {};
    const pf = PARK_FACTORS[game.venue]?.factor || 100;
    const pitcherDaysRest = pitLog.length >= 1 ? Math.round((Date.now() - new Date(pitLog[0].date)) / 86400000) : 4;
    const hasBvP = !!(bvpStat && (bvpStat.atBats >= 5));

    const scoreData = computeHitScore({
      l7, l15, bvp: bvpStat, platoon: platoonStat,
      parkFactor: pf, seasonAvg: seasonStat.avg,
      dayNight: dayNightStat, isHome: pitchingSide === "away",
      pitcherSeasonAvgAgainst: pitStat.avg,
      hasBvP, lineupPos: 5, pitcherDaysRest,
      weather: game.weather, venue: game.venue,
    });

    return {
      batterId: batter.id, batterName: batter.name,
      pitcherId: pitcher.id, pitcherName: pitcher.name, pitcherHand: pitcher.hand,
      teamAbbr: battingTeam.abbr, gamePk: game.gamePk,
      score: scoreData.score, tier: scoreData.tier, hasBvP,
    };
  } catch { return null; }
}

function SummaryCard({ label, value, icon, color }) {
  return (
    <div className="card" style={{ padding: "14px 16px", textAlign: "center" }}>
      <span className="material-icons" style={{ fontSize: 18, color: color || "var(--text-muted)", marginBottom: 4, display: "block" }}>{icon}</span>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: color || "var(--text-primary)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
}
