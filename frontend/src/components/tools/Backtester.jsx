import { useState, useRef, useEffect } from "react";
import {
  fetchGames, fetchRoster, fetchGameLog, computeSplit, computeActiveStreak,
  fetchBvP, fetchPlatoonSplits, fetchDayNightSplits, fetchSeasonStats,
  fetchPitcherStats, fetchPitcherGameLog, fetchPersonInfo, PARK_FACTORS,
  computeHitScore, scoreColor, tierBadgeLabel, tierClass, headshot,
} from "../../utils/mlbApi";
import { compute56KillerScore } from "./FiftySixKiller";
import { btGetWeeklyUsage, btRecordUsage } from "../../utils/supabase";
import { useAuth } from "../../contexts/AuthContext";

const FREE_WEEKLY_LIMIT = 3;

const SEASON = new Date().getFullYear();

// Format date string helper
function fmtDate(d) { return d.toLocaleDateString("en-CA"); }
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

export default function Backtester({ isPremium = false, onUpgrade }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const today = new Date();
  const weekAgo = addDays(today, -7);
  const [startDate, setStartDate] = useState(fmtDate(weekAgo));
  const [endDate, setEndDate]     = useState(fmtDate(addDays(today, -2))); // default to 2 days ago for free users
  const [topN, setTopN]           = useState(2);
  const [algoMode, setAlgoMode]   = useState("iq"); // "iq" | "killer" | "both"
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState({ day: "", done: 0, total: 0, msg: "" });
  const [results, setResults]     = useState(null);
  const [resultsAlgoMode, setResultsAlgoMode] = useState(null); // algo mode the results were actually run with
  const [weeklyUsage, setWeeklyUsage] = useState(0);
  const abortRef = useRef(false);

  // Load weekly usage count on mount
  useEffect(() => {
    btGetWeeklyUsage(userId).then(setWeeklyUsage);
  }, [userId]);

  const todayStr     = fmtDate(today);
  const tomorrowStr  = fmtDate(addDays(today, 1));
  const twoDaysAgoStr = fmtDate(addDays(today, -2)); // free users max date

  // Free user rules:
  // 1. Cannot select yesterday, today, or future (would reveal current picks)
  // 2. Limited to FREE_WEEKLY_LIMIT backtests per rolling 7-day window
  function dateBlockedForFree(dateStr) {
    return dateStr >= twoDaysAgoStr; // yesterday + today + future all blocked
  }
  const rangeRestricted = !isPremium && (startDate >= twoDaysAgoStr || endDate >= twoDaysAgoStr);
  const quotaExceeded   = !isPremium && weeklyUsage >= FREE_WEEKLY_LIMIT;
  const freeUsesLeft    = Math.max(0, FREE_WEEKLY_LIMIT - weeklyUsage);

  async function run() {
    abortRef.current = false;
    setRunning(true); setResults(null);
    // Record usage for free users and refresh count
    if (!isPremium) {
      await btRecordUsage(userId);
      setWeeklyUsage(prev => prev + 1);
    }

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

        // 2. Score batters — use actual lineup starters from box scores for accuracy
        const allBatters = [];
        for (const game of games) {
          if (!game.home.pitcher && !game.away.pitcher) continue;
          for (const side of ["home", "away"]) {
            const battingTeam = game[side];
            const pitchingSide = side === "home" ? "away" : "home";
            const pitcher = game[pitchingSide].pitcher;
            if (!pitcher) continue;
            try {
              // Try to get confirmed starters from box score (past dates)
              let starters = [];
              try {
                const boxUrl = `/mlb-proxy/game/${game.gamePk}/boxscore`;
                const boxR = await fetch(boxUrl);
                if (boxR.ok) {
                  const boxData = await boxR.json();
                  const teamData = boxData.teams?.[side];
                  const battingOrder = teamData?.battingOrder || [];
                  const players = teamData?.players || {};
                  starters = battingOrder.slice(0, 9).map(id => {
                    const p = players[`ID${id}`];
                    if (!p) return null;
                    return {
                      id, name: p.person?.fullName || "?",
                      batSide: p.person?.batSide?.code || "R",
                      position: p.position?.abbreviation || "?",
                    };
                  }).filter(Boolean);
                }
              } catch {}
              // Fall back to roster if box score unavailable
              if (starters.length < 5) {
                const roster = await fetchRoster(battingTeam.teamId);
                starters = roster.slice(0, 9);
              }
              starters.forEach((batter, idx) => {
                allBatters.push({ batter, lineupPos: idx + 1, pitcher, game, battingTeam, pitchingSide });
              });
            } catch { /* skip */ }
          }
        }

        // 3. Compute scores (batches of 8 for speed)
        // Route to correct scorer: IQ uses computeHitScore, Killer uses compute56KillerScore
        const BATCH = 8;

        async function runScorer(fn) {
          const scored = [];
          for (let i = 0; i < allBatters.length; i += BATCH) {
            if (abortRef.current) break;
            const batch = allBatters.slice(i, i + BATCH);
            const res = await Promise.allSettled(batch.map(b => fn(b, SEASON, date)));
            for (const r of res) {
              if (r.status === "fulfilled" && r.value) scored.push(r.value);
            }
          }
          return scored.sort((a, b) => b.score - a.score);
        }

        let topPicks = [];
        if (algoMode === "both") {
          // Both mode: top 1 from each algo = exactly 2 picks/day (or topN if topN=1 means 1 total)
          // Intent: show the best IQ pick + best 56K pick, deduped by batterId
          const [iqScored, killerScored] = await Promise.all([
            runScorer(scoreBatter),
            runScorer(scoreKillerBatter),
          ]);
          const iqTop     = iqScored[0]     ? { ...iqScored[0],     algo: "iq"     } : null;
          const iqId      = iqTop?.batterId;
          const killerTop = killerScored.find(p => p.batterId !== iqId);
          const killerPick = killerTop ? { ...killerTop, algo: "killer" } : null;
          topPicks = [iqTop, killerPick].filter(Boolean);
        } else if (algoMode === "killer") {
          const scored = await runScorer(scoreKillerBatter);
          topPicks = scored.slice(0, topN).map(p => ({ ...p, algo: "killer" }));
        } else {
          const scored = await runScorer(scoreBatter);
          topPicks = scored.slice(0, topN).map(p => ({ ...p, algo: "iq" }));
        }

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
    const tierHits = { elite: [0,0], strong: [0,0], solid: [0,0], watch: [0,0], risky: [0,0] };
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
    setResultsAlgoMode(algoMode); // lock the display label to what was actually run
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

      {/* Algo Mode Toggle */}
      <div className="card" style={{ padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)", flexShrink: 0 }}>Algorithm</div>
        <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: 8, padding: 3, gap: 2 }}>
          {[
            { id: "iq",     label: "IQ Picks" },
            { id: "killer", label: "56 Killer" },
            { id: "both",   label: "Both" },
          ].map(opt => (
            <button key={opt.id} onClick={() => setAlgoMode(opt.id)} disabled={running}
              style={{ padding: "6px 16px", borderRadius: 6, border: "none", cursor: running ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700,
                background: algoMode === opt.id ? "var(--navy)" : "transparent",
                color: algoMode === opt.id ? "white" : "var(--text-muted)",
                transition: "all 0.15s" }}>
              {opt.label}
            </button>
          ))}
        </div>
        {/* BTS note — Both mode always produces exactly 2 picks/day */}
        {algoMode === "both" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 6,
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 11 }}>
            <span className="material-icons" style={{ fontSize: 13, color: "var(--yellow)" }}>info</span>
            <span style={{ color: "var(--text-muted)" }}>
              Both mode shows the <strong style={{ color: "var(--text-secondary)" }}>#1 IQ pick + #1 56K pick</strong> per day — always 2 picks, deduped if same player.
            </span>
          </div>
        )}
        {algoMode !== "both" && (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Testing <span style={{ fontWeight: 700, color: "var(--text-secondary)" }}>{algoMode === "iq" ? "IQ Picks" : "56 Killer"}</span> algorithm
          </div>
        )}
      </div>

      {/* Config */}
      <div className="card" style={{ padding: "18px 22px", marginBottom: 20 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, padding: "8px 12px", borderRadius: 6,
          background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)", fontSize: 11 }}>
          <span className="material-icons" style={{ fontSize: 13, color: "var(--green-light)" }}>lock</span>
          <span style={{ color: "var(--text-muted)" }}>
            <span style={{ fontWeight: 700, color: "var(--green-light)" }}>Scores are date-locked</span>
            {" "}— each day is scored using only data available on that date. Results won't shift on re-runs.
          </span>
        </div>
        {/* Free tier usage meter */}
        {!isPremium && (
          <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between",
            background: quotaExceeded ? "rgba(239,68,68,0.08)" : "rgba(21,128,61,0.08)",
            border: `1px solid ${quotaExceeded ? "rgba(239,68,68,0.25)" : "rgba(21,128,61,0.25)"}` }}>
            <div style={{ fontSize: 12 }}>
              <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 6, color: quotaExceeded ? "var(--red-data)" : "var(--data-green)" }}>
                {quotaExceeded ? "lock" : "science"}
              </span>
              {quotaExceeded ? (
                <><span style={{ fontWeight: 700, color: "var(--red-data)" }}>Weekly limit reached</span>
                <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>Free users get {FREE_WEEKLY_LIMIT} backtests per 7 days.</span></>
              ) : (
                <><span style={{ fontWeight: 700, color: "var(--data-green)" }}>Free Backtester</span>
                <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{freeUsesLeft} of {FREE_WEEKLY_LIMIT} uses left this week · Historical dates only (not yesterday/today)</span></>
              )}
            </div>
            {quotaExceeded && (
              <button className="btn btn-sm" onClick={() => onUpgrade && onUpgrade()}
                style={{ marginLeft: 12, flexShrink: 0, fontSize: 9, padding: "2px 10px", background: "var(--yellow)", color: "#0A2342", border: "none", fontWeight: 800 }}>
                Upgrade for Unlimited
              </button>
            )}
          </div>
        )}

        {/* Date restricted warning */}
        {rangeRestricted && (
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12 }}>
              <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle", color: "var(--yellow)", marginRight: 6 }}>lock</span>
              <span style={{ fontWeight: 700, color: "var(--yellow)" }}>PRO required</span>
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>Yesterday and today's rankings are PRO-only — they reveal current picks.</span>
            </span>
            <button className="btn btn-sm" onClick={() => onUpgrade && onUpgrade()}
              style={{ marginLeft: 12, flexShrink: 0, fontSize: 9, padding: "2px 10px", background: "var(--yellow)", color: "#0A2342", border: "none", fontWeight: 800 }}>
              Unlock
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <div className="form-field">
            <label className="form-label">Start Date</label>
            <input type="date" className="form-input" value={startDate}
              max={isPremium ? todayStr : twoDaysAgoStr}
              onChange={e => setStartDate(e.target.value)} disabled={running} />
          </div>
          <div className="form-field">
            <label className="form-label">End Date</label>
            <input type="date" className="form-input" value={endDate}
              max={isPremium ? todayStr : twoDaysAgoStr}
              onChange={e => setEndDate(e.target.value)} disabled={running} />
          </div>
          <div className="form-field">
            <label className="form-label">Top N Picks / Day</label>
            <select className="form-select" value={topN} onChange={e => setTopN(Number(e.target.value))} disabled={running}>
              {[1,2,3,5,10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm"
              onClick={(rangeRestricted || quotaExceeded) ? () => onUpgrade && onUpgrade() : run}
              disabled={running}
              style={(rangeRestricted || quotaExceeded) ? { opacity: 0.65 } : undefined}>
              <span className="material-icons">{(rangeRestricted || quotaExceeded) ? "lock" : "science"}</span>
              {running ? "Running..." : rangeRestricted ? "PRO Required" : quotaExceeded ? "Limit Reached" : "Run Backtest"}
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
          {/* Stale results warning — shown when algo mode has changed since last run */}
          {resultsAlgoMode && resultsAlgoMode !== algoMode && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
              background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", fontSize: 12 }}>
              <span className="material-icons" style={{ fontSize: 15, color: "var(--yellow)", flexShrink: 0 }}>refresh</span>
              <span style={{ color: "var(--text-secondary)" }}>
                Results below are from the <strong>{resultsAlgoMode === "iq" ? "IQ Picks" : resultsAlgoMode === "killer" ? "56 Killer" : "Both"}</strong> run.
                Re-run to see <strong>{algoMode === "iq" ? "IQ Picks" : algoMode === "killer" ? "56 Killer" : "Both"}</strong> results.
              </span>
            </div>
          )}

          {/* Summary Cards */}
          <div className="section-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Summary
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
              background: resultsAlgoMode === "killer" ? "rgba(245,158,11,0.15)" : "rgba(74,222,128,0.1)",
              color: resultsAlgoMode === "killer" ? "var(--yellow)" : "var(--green-light)",
              border: `1px solid ${resultsAlgoMode === "killer" ? "rgba(245,158,11,0.3)" : "rgba(74,222,128,0.2)"}` }}>
              {resultsAlgoMode === "iq" ? "IQ Picks" : resultsAlgoMode === "killer" ? "56 Killer" : "IQ Picks + 56 Killer"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
            <SummaryCard label="Total Picks" value={results.summary.totalPicks} icon="format_list_numbered" />
            <SummaryCard label="Hits" value={results.summary.wins} icon="check_circle" color="var(--green-light)" />
            <SummaryCard label="No Hits" value={results.summary.losses} icon="cancel" color="var(--red-data)" />
            <SummaryCard label="Hit Rate" value={`${results.summary.winRate}%`} icon="percent"
              color={parseFloat(results.summary.winRate) >= 70 ? "var(--green-light)" : parseFloat(results.summary.winRate) >= 55 ? "var(--yellow)" : "var(--red-data)"} />
          </div>

          {/* Tier Breakdown */}
          <div className="card" style={{ padding: "16px 20px", marginBottom: 20 }}>
            <div className="card-header" style={{ padding: 0, marginBottom: 12 }}>
              <span className="card-title"><span className="material-icons">leaderboard</span>Hit Rate by Tier</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {["elite", "strong", "solid", "watch", "risky"].map(tier => {
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
                    {resultsAlgoMode === "both" && <th>Algo</th>}
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
                        {resultsAlgoMode === "both" && (
                          <td>
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
                              background: p.algo === "killer" ? "rgba(245,158,11,0.15)" : "rgba(74,222,128,0.1)",
                              color: p.algo === "killer" ? "var(--yellow)" : "var(--green-light)" }}>
                              {p.algo === "killer" ? "56K" : "IQ"}
                            </span>
                          </td>
                        )}
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
// cutoffDate: only use gamelog entries BEFORE this date — prevents future data leakage
// This makes backtest scores stable and reproducible regardless of when you run them
async function scoreBatter({ batter, lineupPos, pitcher, game, battingTeam, pitchingSide }, season, cutoffDate) {
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
    // ── DATE BOUNDARY: only use data the algo would have had on cutoffDate ──
    // Without this, backtest scores shift every time you re-run because the
    // gamelog reflects current season stats, not what was true on the test date.
    let gl = (gamelog.value || []).filter(g => !cutoffDate || g.date < cutoffDate);
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
      // Apply same date boundary to spring training gamelog
      const stGlBounded = (stGL.value || []).filter(g => !cutoffDate || g.date < cutoffDate);
      if (gl.length < 5) gl = [...gl, ...stGlBounded];
      if (!seasonStat.avg) seasonStat = stSeason.value || seasonStat;
      if (!pitStat.avg) pitStat = stPitStat.value || pitStat;
      if (!pitLog.length) pitLog = stPitLog.value || pitLog;
    }

    const l1 = computeSplit(gl, 1);
    const l3 = computeSplit(gl, 3);
    const l7 = computeSplit(gl, 7);
    const l14 = computeSplit(gl, 14);
    const l15 = computeSplit(gl, 15);
    const l30 = computeSplit(gl, 30);
    const activeStreak = computeActiveStreak(gl);
    const seasonGwH   = gl.filter(g => +g.hits > 0).length;
    const seasonGames = gl.length;
    // prevStreak: scan for broken streak (for bounce-back signal)
    let prevStreak = 0;
    if (gl.length && +gl[0]?.hits === 0) {
      for (let i = 1; i < gl.length; i++) {
        if (+gl[i].hits > 0) prevStreak++;
        else break;
      }
    }
    const platoonKey = pitcher.hand === "L" ? "vs. Left" : "vs. Right";
    const platoonStat = platData[platoonKey] || {};
    const dnKey = game.isNight ? "Night" : "Day";
    const dayNightStat = dnData[dnKey] || {};
    const pf = PARK_FACTORS[game.venue]?.factor || 100;
    // Use cutoffDate as reference for pitcher rest (not Date.now — that gives wrong rest on historical runs)
    const restRef = cutoffDate ? new Date(cutoffDate + "T12:00:00") : new Date();
    const pitcherDaysRest = pitLog.length >= 1 ? Math.round((restRef - new Date(pitLog[0].date)) / 86400000) : 4;
    const hasBvP = !!(bvpStat && (bvpStat.atBats >= 5));

    const scoreData = computeHitScore({
      l1, l3, l7, l14, l15, l30,
      bvp: bvpStat, platoon: platoonStat,
      parkFactor: pf, seasonAvg: seasonStat.avg,
      seasonStats: seasonStat,
      dayNight: dayNightStat, isHome: pitchingSide === "away",
      pitcherSeasonAvgAgainst: pitStat.avg,
      pitcherStats: pitStat,
      hasBvP, lineupPos: lineupPos || 5, pitcherDaysRest,
      weather: game.weather, venue: game.venue,
      seasonGwH, seasonGames,
      activeStreak, prevStreak,
    });

    return {
      batterId: batter.id, batterName: batter.name,
      pitcherId: pitcher.id, pitcherName: pitcher.name, pitcherHand: pitcher.hand,
      teamAbbr: battingTeam.abbr, gamePk: game.gamePk,
      score: scoreData.score, tier: scoreData.tier, hasBvP,
    };
  } catch { return null; }
}

// ─── 56 Killer scorer ────────────────────────────────────────────────────────
// Distinct algorithm from IQ — prioritises lineup position + contact opportunity.
// Only fetches what it needs: gamelog + pitcher K%.
async function scoreKillerBatter({ batter, lineupPos, pitcher, game, battingTeam, pitchingSide }, season, cutoffDate) {
  try {
    const [gamelog, pitcherStat] = await Promise.allSettled([
      fetchGameLog(batter.id, season),
      fetchPitcherStats(pitcher.id, season),
    ]);

    let gl      = (gamelog.value     || []).filter(g => !cutoffDate || g.date < cutoffDate);
    let pitStat = pitcherStat.value  || {};

    // Spring training fallback
    if (gl.length < 5) {
      const stGL = await fetchGameLog(batter.id, season, "S").catch(() => []);
      gl = [...gl, ...stGL.filter(g => !cutoffDate || g.date < cutoffDate)];
    }

    const sorted = [...gl].sort((a, b) => b.date.localeCompare(a.date));

    const sliceHits = (n) => {
      let h = 0, pa = 0;
      for (const g of sorted.slice(0, n)) { h += +(g.hits ?? 0); pa += +(g.atBats ?? g.ab ?? 0); }
      return { hits: h, pa };
    };
    const s7  = sliceHits(7);
    const s14 = sliceHits(14);
    const s30 = sliceHits(30);

    let activeStreak = 0;
    for (const g of sorted) { if ((g.hits ?? 0) > 0) activeStreak++; else break; }

    let prevStreak = 0;
    if ((sorted[0]?.hits ?? 1) === 0) {
      for (const g of sorted.slice(1)) { if ((g.hits ?? 0) > 0) prevStreak++; else break; }
    }

    const seasonHits = sorted.reduce((a, g) => a + +(g.hits ?? 0), 0);
    const seasonAB   = sorted.reduce((a, g) => a + +(g.atBats ?? g.ab ?? 0), 0);
    const seasonAvg  = seasonAB >= 10 ? seasonHits / seasonAB : 0.250;

    const pf          = PARK_FACTORS[game.venue]?.factor || 100;
    const pitcherKPct = pitStat.kPct ?? null;
    const isHome      = pitchingSide === "away";

    const { confidence, tier } = compute56KillerScore({
      lineupPos,
      l7hits: s7.hits,   l7pa: s7.pa,
      l14hits: s14.hits, l14pa: s14.pa,
      l30hits: s30.hits, l30pa: s30.pa,
      parkFactor: pf,
      pitcherKPct,
      isHome,
      activeStreak,
      prevStreak,
      seasonAvg,
      lineupConfirmed: true, // box score starters are confirmed
    });

    return {
      batterId: batter.id, batterName: batter.name,
      pitcherId: pitcher.id, pitcherName: pitcher.name, pitcherHand: pitcher.hand || "R",
      teamAbbr: battingTeam.abbr, gamePk: game.gamePk,
      score: confidence,
      // Normalize tier label to match existing tierClass/tierBadgeLabel helpers
      tier: tier.label === "ELITE"  ? "elite"
          : tier.label === "STRONG" ? "strong"
          : tier.label === "SOLID"  ? "solid"
          : tier.label === "WATCH"  ? "watch"   // ← correct mapping (was "risky")
          : "watch",
      hasBvP: false,
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
