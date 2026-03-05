import { useState, useEffect, useRef } from "react";
import {
  fetchGames, fetchRoster, fetchGameLog, computeSplit, computeActiveStreak,
  fetchBvP, fetchPlatoonSplits, fetchDayNightSplits, fetchSeasonStats,
  fetchPitcherStats, fetchPitcherGameLog, fetchAllLineups, fetchPersonInfo,
  fetchStatcastForPlayer, fetchLiveBoxscoreStats,
  PARK_FACTORS, computeHitScore, avgColor, scoreColor, tierClass, tierBadgeLabel,
  isPlayerHot, headshot,
} from "../../utils/mlbApi";
import { fetchMLBEvents, fetchEventProps, matchEvent, findPlayerLine, fmtOdds, HAS_PROP_LINES } from "../../utils/propLinesApi";
import { openAddPick } from "./PickTracker";
import PlayerPanel from "../shared/PlayerPanel";

const SEASON = new Date().getFullYear();

// Shared prop lines data keyed by gamePk
let _propLinesByGame = {};
async function loadPropLinesForGame(game) {
  if (_propLinesByGame[game.gamePk] !== undefined) return _propLinesByGame[game.gamePk];
  if (!HAS_PROP_LINES) { _propLinesByGame[game.gamePk] = null; return null; }
  try {
    const events = await fetchMLBEvents();
    const ev     = matchEvent(events, game.home.team);
    if (!ev) { _propLinesByGame[game.gamePk] = null; return null; }
    const lines = await fetchEventProps(ev.id, "batter_hits");
    _propLinesByGame[game.gamePk] = lines;
    return lines;
  } catch { _propLinesByGame[game.gamePk] = null; return null; }
}

// Module-level cache — survives component unmount/remount
const _scoreCache = {};

// Domed/retractable-roof venues — no weather display
const DOME_VENUES = new Set([
  "Tropicana Field", "loanDepot Park", "Minute Maid Park", "Globe Life Field",
  "Rogers Centre", "Chase Field", "T-Mobile Park", "American Family Field",
]);

export default function TodaysPicks({ mode, isPremium = false, onUpgrade }) {
  // Always initialize to true calendar today — never auto-advance
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
  const [date, setDate] = useState(todayStr);
  const [picks, setPicks] = useState(() => _scoreCache[todayStr]?.picks || []);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, msg: "" });
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortCol, setSortCol] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [filterTier, setFilterTier] = useState("all");
  const [filterTeam, setFilterTeam] = useState("all");
  const [showBvP, setShowBvP] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [toast, setToast] = useState(null);
  const [quickTrack, setQuickTrack] = useState(null);
  const [liveStats, setLiveStats] = useState({}); // gamePk → { stats: Map, status }
  const PROP_TYPES = ["1+ Hits (BTS)", "2+ Hits", "1+ Home Runs", "1+ Total Bases", "2+ Total Bases"];
  const [teams, setTeams] = useState([]);

  // Listen for pick-tracked toast
  useEffect(() => {
    const handler = e => {
      setToast(e.detail);
      setTimeout(() => setToast(null), 2500);
    };
    window.addEventListener("diamondiq:picktoast", handler);
    return () => window.removeEventListener("diamondiq:picktoast", handler);
  }, []);

  // Listen for track-pick requests from PlayerPanel (prop selector modal)
  useEffect(() => {
    const handler = e => { setQuickTrack({ pick: e.detail }); };
    window.addEventListener("diamondiq:trackpick", handler);
    return () => window.removeEventListener("diamondiq:trackpick", handler);
  }, []);
  const [lineupStatusMap, setLineupStatusMap] = useState({});

  // ── Live stats polling — updates every 90 seconds for games in progress ──
  useEffect(() => {
    async function pollLiveStats() {
      if (!picks.length) return;
      const now = new Date();
      // Get unique gamePks for games that have started or are live/final
      const activePks = [...new Set(
        picks
          .filter(p => p.game.gameDate && new Date(p.game.gameDate) <= now)
          .map(p => p.game.gamePk)
      )];
      if (!activePks.length) return;
      const updates = {};
      await Promise.allSettled(
        activePks.map(async pk => {
          const result = await fetchLiveBoxscoreStats(pk);
          updates[pk] = result;
        })
      );
      setLiveStats(prev => ({ ...prev, ...updates }));
    }

    pollLiveStats(); // immediate on mount / picks change
    const interval = setInterval(pollLiveStats, 90_000); // every 90 sec
    return () => clearInterval(interval);
  }, [picks]);

  useEffect(() => {
    const cached = _scoreCache[date];
    if (cached) {
      setPicks(cached.picks);
      setTeams(cached.teams || []);
      if (cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) return;
    }
    run();
  }, [date]);

  // ── Smart re-run polling ───────────────────────────────────────────────────
  // Polls every 2 min while today's date is selected and unstarted games remain.
  // Re-runs the algorithm when:
  //   (a) A new lineup has been confirmed since the last run, OR
  //   (b) 15+ minutes have elapsed and some games haven't started yet
  // Players whose games have already started are frozen in their ranked position.
  useEffect(() => {
    const todayDate = new Date().toLocaleDateString("en-CA");
    if (date !== todayDate) return; // only auto-poll for today

    const POLL_INTERVAL = 2 * 60_000; // check every 2 min

    async function checkAndRerun() {
      if (loading) return;
      const now = new Date();

      // Stop polling if all picks have started games
      if (picks.length > 0) {
        const allStarted = picks.every(p => p.game.gameDate && new Date(p.game.gameDate) <= now);
        if (allStarted) return;
      }

      // Quick lineup check — count confirmed sides without full re-score
      try {
        const { games } = await fetchGames(date);
        const lineupMap = await fetchAllLineups(games);
        const newConfirmedCount = [...lineupMap.values()]
          .filter(v => v.home.status === "confirmed" || v.away.status === "confirmed").length;

        const cached = _scoreCache[date];
        const lastConfirmed = cached?.confirmedCount ?? 0;
        const minutesSinceRun = cached?.ts ? (Date.now() - cached.ts) / 60_000 : 999;

        const lineupChanged = newConfirmedCount > lastConfirmed;
        const staleEnough   = minutesSinceRun >= 15;

        if (lineupChanged || staleEnough) {
          run(); // full re-score with latest lineups
        }
      } catch { /* silently ignore poll errors */ }
    }

    const interval = setInterval(checkAndRerun, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [date, picks, loading]);

  async function run() {
    setLoading(true);
    if (!_scoreCache[date]) { setPicks([]); }
    setProgress({ done: 0, total: 0, msg: "Loading today's games..." });
    try {
      const { games } = await fetchGames(date);

      // Filter out postponed/cancelled/suspended games
      const activeGames = games.filter(g => !g.isPostponed && !g.isCancelled && !g.isSuspended);

      // Off-day or all postponed
      if (activeGames.length === 0) {
        const hasAny = games.length > 0;
        const msg = hasAny
          ? `All ${games.length} game${games.length > 1 ? "s" : ""} postponed or cancelled`
          : "No MLB games scheduled today";
        setPicks([]);
        _scoreCache[date] = { picks: [], teams: [], ts: Date.now(), confirmedCount: 0, offDay: true, offDayMsg: msg };
        setLoading(false);
        return;
      }

      // ── Fetch confirmed lineups for all games ───────────────────────────
      setProgress({ done: 0, total: 0, msg: "Checking confirmed lineups..." });
      const lineupMap = await fetchAllLineups(activeGames);

      // Build lineup status summary for the UI
      const statusMap = {};
      for (const [gpk, data] of lineupMap) {
        statusMap[gpk] = {
          home: data.home.status,
          away: data.away.status,
        };
      }
      setLineupStatusMap(statusMap);

      const allBatters = [];
      const teamSet = new Set();

      for (const game of activeGames) {
        if (!game.home.pitcher && !game.away.pitcher) continue;

        for (const side of ["home", "away"]) {
          const battingTeam = game[side];
          const pitchingSide = side === "home" ? "away" : "home";
          const pitcher = game[pitchingSide].pitcher;
          if (!pitcher) continue;
          teamSet.add(battingTeam.team);

          const lineupData = lineupMap.get(game.gamePk)?.[side];
          const hasConfirmed = lineupData?.status === "confirmed" && lineupData.players.length >= 9;

          if (hasConfirmed) {
            // ── Use confirmed lineup — only score the 9 starters ──────────
            for (const player of lineupData.players) {
              allBatters.push({
                batter: player,
                pitcher,
                game,
                battingTeam,
                pitchingSide,
                lineupPos: player.order,
                lineupStatus: "confirmed",
              });
            }
          } else {
            // ── Fallback: pull active roster and estimate positions ────────
            try {
              const roster = await fetchRoster(battingTeam.teamId);
              // Only take likely position players (skip pitchers)
              const batters = roster.filter(b => b.position !== "P").slice(0, 13);
              for (let ri = 0; ri < batters.length; ri++) {
                allBatters.push({
                  batter: batters[ri],
                  pitcher,
                  game,
                  battingTeam,
                  pitchingSide,
                  lineupPos: Math.min(ri + 1, 9), // estimate 1-9 based on roster order
                  lineupStatus: "projected",
                });
              }
            } catch { /* skip */ }
          }
        }
      }

      const teamsList = [...teamSet].sort();
      setTeams(teamsList);
      setProgress({ done: 0, total: allBatters.length, msg: "Computing hit scores..." });

      // Process in batches of 6
      const results = [];
      const BATCH = 12;
      for (let i = 0; i < allBatters.length; i += BATCH) {
        const batch = allBatters.slice(i, i + BATCH);
        const batchResults = await Promise.allSettled(batch.map(b => scoreBatter(b)));
        for (const r of batchResults) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        setProgress(p => ({ ...p, done: Math.min(i + BATCH, allBatters.length) }));
      }

      results.sort((a,b) => b.scoreData.score - a.scoreData.score);

      // Deduplicate: keep only highest-scoring entry per player per game
      // (doubleheaders: same player can appear in game 1 AND game 2)
      const seen = new Set();
      const deduped = results.filter(r => {
        const key = `${r.batter.id}:${r.game.gamePk}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // ── Preserve rank positions for players whose games have started ──────
      // If we have previous picks, players with started games keep their
      // original rank slot so the leaderboard doesn't reshuffle mid-game.
      const now = new Date();
      const prevPicks = _scoreCache[date]?.picks || [];
      if (prevPicks.length > 0) {
        const startedPlayerIds = new Set(
          prevPicks
            .filter(p => p.game.gameDate && new Date(p.game.gameDate) <= now)
            .map(p => p.batter.id)
        );

        if (startedPlayerIds.size > 0) {
          // Keep started players at their previous rank, splice in updated unstarted players
          const prevStarted = prevPicks.filter(p => startedPlayerIds.has(p.batter.id));
          const newUnstarted = deduped.filter(p => !startedPlayerIds.has(p.batter.id));

          // Merge: interleave by original rank position
          const prevRankMap = new Map(prevPicks.map((p, i) => [p.batter.id, i]));
          const merged = [...prevStarted, ...newUnstarted];
          merged.sort((a, b) => {
            const aRank = prevRankMap.has(a.batter.id) ? prevRankMap.get(a.batter.id) : 999;
            const bScore = b.scoreData.score;
            const aScore = a.scoreData.score;
            // Started players: preserve original rank
            // Unstarted players: sort by new score, slotted between started players
            if (startedPlayerIds.has(a.batter.id) && startedPlayerIds.has(b.batter.id)) {
              return prevRankMap.get(a.batter.id) - prevRankMap.get(b.batter.id);
            }
            if (startedPlayerIds.has(a.batter.id)) return aRank - 999;
            if (startedPlayerIds.has(b.batter.id)) return 999 - prevRankMap.get(b.batter.id);
            return bScore - aScore;
          });

          setPicks(merged);
          const confirmedCount = [...lineupMap.values()].filter(v => v.home.status === "confirmed" || v.away.status === "confirmed").length;
          _scoreCache[date] = { picks: merged, teams: teamsList || teams, ts: Date.now(), confirmedCount };
          return;
        }
      }

      setPicks(deduped);
      const confirmedCount = [...lineupMap.values()].filter(v => v.home.status === "confirmed" || v.away.status === "confirmed").length;
      _scoreCache[date] = { picks: deduped, teams: teamsList || teams, ts: Date.now(), confirmedCount };
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function scoreBatter({ batter, pitcher, game, battingTeam, pitchingSide, lineupPos = 5, lineupStatus = "projected" }) {
    try {
      // Fix pitcher hand if missing
      let pitcherHand = pitcher.hand;
      if (!pitcherHand || pitcherHand === "?") {
        try {
          const info = await fetchPersonInfo(pitcher.id);
          if (info) pitcherHand = info.pitchHand;
          pitcher = { ...pitcher, hand: pitcherHand || "R" };
        } catch { pitcher = { ...pitcher, hand: "R" }; }
      }

      // Fetch current season data + Statcast
      const [gamelog, bvp, platoon, dayNight, season, pitcherStat, pitcherLog, statcastResult] = await Promise.allSettled([
        fetchGameLog(batter.id, SEASON),
        fetchBvP(batter.id, pitcher.id),
        fetchPlatoonSplits(batter.id, SEASON),
        fetchDayNightSplits(batter.id, SEASON),
        fetchSeasonStats(batter.id, SEASON),
        fetchPitcherStats(pitcher.id, SEASON),
        fetchPitcherGameLog(pitcher.id, SEASON),
        fetchStatcastForPlayer(batter.id, SEASON),
      ]);
      let gl       = gamelog.value || [];
      let bvpStat  = bvp.value;
      let platData = platoon.value || {};
      let dnData   = dayNight.value || {};
      const statcast = statcastResult.value || null;
      let seasonStat = season.value || {};
      let pitStat  = pitcherStat.value || {};
      let pitLog   = pitcherLog.value || [];

      // ── Spring training fallback when regular season data is thin ────────
      const isThin = gl.length < 5 || !seasonStat.avg;
      if (isThin) {
        // Try spring training stats for current year (gameType S/E)
        const [stGL, stSeason, stPitStat, stPitLog] = await Promise.allSettled([
          fetchGameLog(batter.id, SEASON, "S"),
          fetchSeasonStats(batter.id, SEASON, "S"),
          fetchPitcherStats(pitcher.id, SEASON, "S"),
          fetchPitcherGameLog(pitcher.id, SEASON, "S"),
        ]);
        if (gl.length < 5) gl = [...gl, ...(stGL.value || [])];
        if (!seasonStat.avg) seasonStat = stSeason.value || seasonStat;
        if (!pitStat.avg) pitStat = stPitStat.value || pitStat;
        if (!pitLog.length) pitLog = stPitLog.value || pitLog;
      }

      const l1  = computeSplit(gl, 1);
      const l3  = computeSplit(gl, 3);
      const l7  = computeSplit(gl, 7);
      const l15 = computeSplit(gl, 15);
      const streak = computeActiveStreak(gl);

      const platoonKey = pitcher.hand === "L" ? "vs. Left" : "vs. Right";
      const platoonStat = platData[platoonKey] || {};
      const dnKey  = game.isNight ? "Night" : "Day";
      const dayNightStat = dnData[dnKey] || {};
      const pf = PARK_FACTORS[game.venue]?.factor || 100;
      // Days rest: skip any outing on the same calendar date as today's game
      // (pitcher may already appear in the log if they threw earlier today)
      const gameDateStr = (game.gameDate || "").slice(0, 10); // "YYYY-MM-DD"
      const prevOuting = pitLog.find(g => (g.date || "").slice(0, 10) < gameDateStr);
      const pitcherDaysRest = prevOuting
        ? Math.round((new Date(gameDateStr) - new Date(prevOuting.date.slice(0, 10))) / 86400000)
        : 5; // default to 5 if no prior outing found
      const hasBvP = !!(bvpStat && (bvpStat.atBats >= 5));

      const scoreData = computeHitScore({
        l1, l3, l7, l15, bvp: bvpStat, platoon: platoonStat,
        parkFactor: pf, seasonAvg: seasonStat.avg,
        seasonStats: seasonStat,
        dayNight: dayNightStat, isHome: pitchingSide === "away",
        pitcherSeasonAvgAgainst: pitStat.avg,
        pitcherStats: pitStat,
        hasBvP, lineupPos, pitcherDaysRest,
        weather: game.weather, venue: game.venue,
        statcast,
      });

      // Prop line lookup (non-blocking — loads if Odds API key is configured)
      const propLines = await loadPropLinesForGame(game).catch(() => null);
      const propLine  = propLines ? findPlayerLine(propLines, batter.name) : null;

      const hot = isPlayerHot(streak, l7?.avg, scoreData.score);

      return { batter, pitcher, game, battingTeam, scoreData, l1, l3, l7, l15, streak, bvpStat, platoonStat, dayNightStat, seasonStat, pitStat, pf, hasBvP, propLine, hot, lineupPos, lineupStatus, isFallback: isThin, statcast };
    } catch { return null; }
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = picks.filter(p => {
    if (filterTier !== "all" && p.scoreData.tier !== filterTier) return false;
    if (filterTeam !== "all" && p.battingTeam.team !== filterTeam) return false;
    return true;
  });

  const sorted = [...filtered].sort((a,b) => {
    const get = r => {
      if (sortCol === "score")  return showBvP ? r.scoreData.withBvP : r.scoreData.withoutBvP;
      if (sortCol === "l7")     return parseFloat(r.l7?.avg) || 0;
      if (sortCol === "l3")     return parseFloat(r.l3?.avg) || 0;
      if (sortCol === "streak") return r.streak;
      if (sortCol === "season") return parseFloat(r.seasonStat?.avg) || 0;
      if (sortCol === "bvp")    return parseFloat(r.bvpStat?.avg) || 0;
      if (sortCol === "plat")   return parseFloat(r.platoonStat?.avg) || 0;
      if (sortCol === "xba")    return r.scoreData.statcast?.xba || 0;
      if (sortCol === "barrel") return r.scoreData.statcast?.barrelPct || 0;
      return 0;
    };
    return sortDir === "desc" ? get(b) - get(a) : get(a) - get(b);
  });

  // Percentile rank: Top X% of today's pool (1% = best)
  const sortedWithPct = sorted.map((p, i) => ({
    ...p,
    _pct: Math.max(1, Math.ceil(((i + 1) / sorted.length) * 100)),
  }));

  const top10 = sortedWithPct.slice(0, 10);
  const beatStreakMode = mode === "bts";

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Today's Picks</h1>
          <p className="page-subtitle">
            {beatStreakMode ? "Beat the Streak recommendations" : "Props & DFS ranked candidates"} · {date}
          </p>
        </div>
        <div className="page-actions">
          <input type="date" className="filter-input" value={date}
            onChange={e => { setDate(e.target.value); }}
            style={{ height: 36, fontSize: 13 }} />
          <button className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
            <span className="material-icons">refresh</span>
            {loading ? "Running..." : "Run Algorithm"}
          </button>
        </div>
      </div>

      {/* Progress */}
      {loading && picks.length === 0 && (
        <div className="card" style={{ padding: "24px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
            <div className="spinner" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>
                {progress.total > 0 ? "Analyzing matchups..." : "Loading today's slate..."}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {progress.total > 0
                  ? `Scoring ${progress.done} of ${progress.total} players · Checking splits, Statcast, BvP data`
                  : "Fetching games, rosters, and lineup projections"
                }
              </div>
            </div>
            {progress.total > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--navy)" }}>
                {Math.round((progress.done/progress.total)*100)}%
              </span>
            )}
          </div>
          {progress.total > 0 && (
            <div style={{ height: 6, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "linear-gradient(90deg, var(--accent), var(--navy))", borderRadius: 100, width: `${(progress.done/progress.total)*100}%`, transition: "width 0.3s ease" }} />
            </div>
          )}
          {progress.total > 0 && progress.done < progress.total && (
            <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>
              {["Checking L7 batting averages and active streaks...", "Cross-referencing pitcher matchup data...", "Pulling Statcast exit velocity and barrel rates...", "Evaluating platoon and day/night splits...", "Calculating park factor adjustments..."][Math.floor(progress.done / Math.max(progress.total / 5, 1)) % 5]}
            </div>
          )}
        </div>
      )}

      {!loading && picks.length === 0 && (() => {
        const cached = _scoreCache[date];
        const isOffDay = cached?.offDay;
        const offMsg = cached?.offDayMsg || "No MLB games scheduled today";
        const isPostponedDay = offMsg.includes("postponed");
        return (
          <div className="empty-state">
            <div className="empty-icon">
              <span className="material-icons">{isOffDay ? (isPostponedDay ? "cloud_off" : "sports_baseball") : "today"}</span>
            </div>
            <div className="empty-title">{isOffDay ? offMsg : "No picks loaded"}</div>
            <div className="empty-sub">
              {isOffDay
                ? isPostponedDay
                  ? "Check back later — games may be rescheduled as doubleheaders."
                  : "MLB takes occasional off-days during the regular season. Try a different date."
                : "Select a date and click \"Run Algorithm\" to score today's batters"}
            </div>
          </div>
        );
      })()}

      {!loading && picks.length > 0 && (
        <>
          {/* LINEUP STATUS BANNER */}
          <LineupStatusBar statusMap={lineupStatusMap} />

          {/* TOP PICKS HERO */}
          <div className="section-label">
            {beatStreakMode ? "Top Beat the Streak Candidates" : "Top 10 Today"}
            {beatStreakMode && <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 9, letterSpacing: 0 }}>Only showing available picks</span>}
          </div>
          <div className="picks-hero" style={{ gridTemplateColumns: `repeat(5, 1fr)`, position: "relative" }}>
            {!isPremium && (
              <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)", borderRadius: 12, cursor: "pointer" }}
                onClick={onUpgrade}>
                <div style={{ textAlign: "center" }}>
                  <span className="material-icons" style={{ fontSize: 28, color: "var(--yellow)", display: "block", marginBottom: 6 }}>lock</span>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--navy)" }}>Top Picks — PRO Only</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Upgrade to see today's best picks</div>
                </div>
              </div>
            )}
            {(() => {
              const now = new Date();
              const heroPool = top10;
              return heroPool.slice(0, beatStreakMode ? 5 : 10).map((p, i) => (
                <PickCard key={p.batter.id} pick={p} rank={i+1} showBvP={showBvP} onClick={() => setSelectedPlayer(p)} pct={p._pct} mode={mode} liveStats={liveStats} />
              ));
            })()}
          </div>

          {/* Filters */}
          <div className="filter-bar">
            <div className="filter-group">
              <span className="filter-label">Tier</span>
              <div className="chip-group">
                {["all","elite","strong","solid","risky"].map(t => (
                  <button key={t} className={`chip ${filterTier === t ? "active" : ""}`} onClick={() => setFilterTier(t)}>
                    {t === "all" ? "All" : t.charAt(0).toUpperCase()+t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <span className="filter-label">Team</span>
              <select className="filter-select" value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
                <option value="all">All Teams</option>
                {teams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Score Basis</span>
              <div className="chip-group">
                <button className={`chip ${showBvP ? "active" : ""}`} onClick={() => setShowBvP(true)}
                  data-tooltip="Include career BvP stats in score" title="Include career BvP stats in score">With BvP</button>
                <button className={`chip ${!showBvP ? "active" : ""}`} onClick={() => setShowBvP(false)}
                  data-tooltip="Use pitcher season stats as proxy" title="Use pitcher season stats as proxy">Without BvP</button>
              </div>
            </div>
            <div style={{ marginLeft: "auto", alignSelf: "flex-end", display: "flex", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>{sorted.length} players</span>
            </div>
          </div>

          {/* Full ranked table */}
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header">
              <span className="card-title">
                <span className="material-icons">format_list_numbered</span>
                Full Rankings — {date}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Click any row for full breakdown</span>
                {sorted.length > 0 && (
                  <button className="btn btn-sm" onClick={() => setShowShare(true)}
                    style={{ fontSize: 10, padding: "3px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)", gap: 4 }}>
                    <span className="material-icons" style={{ fontSize: 13 }}>share</span>
                    Share
                  </button>
                )}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{width:36}}>#</th>
                    <th style={{width:36}}></th>
                    <th className="sticky-col">Player</th>
                    <th>Team</th>
                    <th>vs. SP</th>
                    <th>Venue</th>
                    <th style={{width:60}} data-tooltip="First pitch time" title="First pitch time">Time</th>
                    <th style={{width:80}} data-tooltip="Game-time weather conditions" title="Game-time weather conditions">Wx</th>
                    <SortTh col="score"  s={sortCol} d={sortDir} onClick={handleSort} tip="Composite hit score — weighted avg of L7, splits, Statcast, matchup data">Score</SortTh>
                    <th data-tooltip="Elite (75+), Strong (60-74), Solid (45-59), Risky (<45)" title="Elite (75+), Strong (60-74), Solid (45-59), Risky (<45)">Tier</th>
                    <SortTh col="l3"    s={sortCol} d={sortDir} onClick={handleSort} tip="Batting average over last 3 games played">L3</SortTh>
                    <SortTh col="l7"    s={sortCol} d={sortDir} onClick={handleSort} tip="Batting average over last 7 games — heaviest weight in Hit Score">L7</SortTh>
                    <SortTh col="streak" s={sortCol} d={sortDir} onClick={handleSort} tip="Consecutive games with at least 1 hit">Streak</SortTh>
                    <SortTh col="bvp"   s={sortCol} d={sortDir} onClick={handleSort} tip="Career batting average vs today's opposing pitcher">BvP</SortTh>
                    <SortTh col="plat"  s={sortCol} d={sortDir} onClick={handleSort} tip="Career AVG vs the pitcher's handedness (LHP or RHP)">Platoon</SortTh>
                    <SortTh col="xba"   s={sortCol} d={sortDir} onClick={handleSort} tip="Expected batting avg from Statcast — based on exit velo and launch angle">
                      xBA {!isPremium && <span className="pro-badge"><span className="material-icons">lock</span>PRO</span>}
                    </SortTh>
                    <SortTh col="barrel" s={sortCol} d={sortDir} onClick={handleSort} tip="% of batted balls hit at optimal exit velo (98+mph) and launch angle (26-30°)">
                      Barrel% {!isPremium && <span className="pro-badge"><span className="material-icons">lock</span>PRO</span>}
                    </SortTh>
                    <th data-tooltip="Park factor — how the venue affects hitting (hitter-friendly vs pitcher-friendly)" title="Park factor — how the venue affects hitting (hitter-friendly vs pitcher-friendly)">Park</th>
                    <th data-tooltip="Prop line odds from sportsbooks (requires Odds API key)" title="Prop line odds from sportsbooks (requires Odds API key)">
                      1+ Hits
                      {!isPremium && <span className="pro-badge"><span className="material-icons">lock</span>PRO</span>}
                    </th>
                    <th data-tooltip="Top scoring factors contributing to this player's Hit Score" title="Top scoring factors contributing to this player's Hit Score">Factors</th>
                    <th style={{width:36}} data-tooltip="Log to My Pick Record" title="Log to My Pick Record"></th>
                  </tr>
                </thead>
                <tbody>
                  {!isPremium && sortedWithPct.length > 5 && (
                    <tr>
                      <td colSpan="99" style={{ padding: "10px 16px", background: "linear-gradient(90deg, rgba(245,158,11,0.06), rgba(21,128,61,0.06))", textAlign: "center", borderBottom: "1px solid rgba(245,158,11,0.1)" }}>
                        <span className="material-icons" style={{ fontSize: 14, verticalAlign: "middle", color: "var(--yellow)", marginRight: 6 }}>lock</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--yellow)" }}>Top 5 picks are PRO-only</span>
                        <button className="btn btn-sm" onClick={onUpgrade}
                          style={{ marginLeft: 12, fontSize: 9, padding: "2px 10px", background: "var(--yellow)", color: "#0A2342", border: "none", fontWeight: 800 }}>
                          Unlock
                        </button>
                      </td>
                    </tr>
                  )}
                  {sortedWithPct.map((p, i) => {
                    const score = showBvP ? p.scoreData.withBvP : p.scoreData.withoutBvP;
                    const color = scoreColor(score);
                    const lockCount = 5;
                    const isLocked = !isPremium && i < lockCount;
                    return (
                      <tr key={`${p.batter.id}-${p.pitcher.id}`}
                        onClick={() => isLocked ? (onUpgrade && onUpgrade()) : setSelectedPlayer(p)}
                        style={isLocked ? { filter: "blur(6px)", pointerEvents: "auto", cursor: "pointer", userSelect: "none", position: "relative" } : undefined}>
                        <td style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{i+1}</td>
                        {/* Photo + flame */}
                        <td style={{ padding: "6px 8px" }}>
                          <PlayerPhoto playerId={p.batter.id} name={p.batter.name} size={32} hot={p.hot} />
                        </td>
                        <td>
                          <div className="td-player">
                            {p.batter.name}
                            {p.lineupStatus === "confirmed" && (
                              <span className="lineup-badge confirmed" title={`Confirmed #${p.lineupPos} in lineup`}>
                                #{p.lineupPos}
                              </span>
                            )}
                            {p.lineupStatus === "projected" && (
                              <span className="lineup-badge projected" title="Projected — lineup not yet confirmed">
                                PROJ
                              </span>
                            )}
                          </div>
                          <div className="td-team">{p.batter.batSide}HB</div>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 700, background: "var(--navy)", color: "white", padding: "2px 7px", borderRadius: 5 }}>
                            {p.battingTeam.abbr}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{p.pitcher.name}</div>
                          <span className={`badge ${p.pitcher.hand === "L" ? "hand-L" : "hand-R"}`} style={{fontSize:9}}>
                            {p.pitcher.hand || "?"}HP
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.game.venue}
                        </td>
                        <td>
                          <GameTime gameDate={p.game.gameDate} mode={mode} gameStatus={p.game} liveGameData={liveStats?.[p.game.gamePk]} />
                          {p.game.doubleHeader === "Y" && (
                            <div style={{ fontSize: 9, fontWeight: 800, color: "var(--yellow)", marginTop: 2 }}>DH G{p.game.gameNumber}</div>
                          )}
                          {/* Inline stat line for started games */}
                          {(() => {
                            const gd = liveStats?.[p.game.gamePk];
                            const ps = gd?.stats?.get(p.batter.id);
                            if (!ps || (gd?.status !== "Live" && gd?.status !== "Final")) return null;
                            return (
                              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", marginTop: 3, display: "flex", gap: 4, alignItems: "center" }}>
                                <span style={{ fontWeight: 900, color: ps.hits > 0 ? "var(--data-green)" : "var(--text-muted)" }}>
                                  {ps.hits}-{ps.atBats}
                                </span>
                                <span style={{ color: "var(--text-muted)" }}>·</span>
                                <span style={{ color: "var(--text-secondary)" }}>{ps.totalBases}TB</span>
                                {ps.rbi > 0 && <><span style={{ color: "var(--text-muted)" }}>·</span><span style={{ color: "var(--text-secondary)" }}>{ps.rbi}RBI</span></>}
                              </div>
                            );
                          })()}
                        </td>
                        <td>
                          <WeatherCell weather={p.game.weather} venue={p.game.venue} />
                        </td>
                        <td title={p.scoreData.breakdown ? `Contact: ${p.scoreData.breakdown.contact}/35 · Form: ${p.scoreData.breakdown.form}/25 · Matchup: ${p.scoreData.breakdown.matchup}/25 · Statcast: ${p.scoreData.breakdown.statcast}/10 · Env: ${p.scoreData.breakdown.env}/5` : ""}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
                            <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                              <span style={{ fontSize:9, fontWeight:700, color:"var(--text-muted)", letterSpacing:"0.3px" }}>
                                T{p._pct}%
                              </span>
                              {!p.hasBvP && <span style={{ fontSize:9, color:"var(--text-muted)" }}>· est</span>}
                            </div>
                            <div style={{ height: 3, width: 50, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 100 }} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${tierClass(p.scoreData.tier)}`} style={{ fontSize: 9 }}>
                            {tierBadgeLabel(p.scoreData.tier)}
                          </span>
                          {p.isFallback && <span className="badge badge-fallback" style={{ marginLeft: 4 }} title="Includes spring training data">ST</span>}
                        </td>
                        <td className={`td-mono ${avgColor(p.l3?.avg)}`}>{p.l3?.avg || "—"}</td>
                        <td className={`td-mono ${avgColor(p.l7?.avg)}`}>{p.l7?.avg || "—"}</td>
                        <td>
                          {p.streak > 0
                            ? <span className="badge badge-green" style={{fontSize:9}}>
                                <span className="material-icons" style={{fontSize:10}}>local_fire_department</span>
                                {p.streak}G
                              </span>
                            : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                        </td>
                        <td className={`td-mono ${p.bvpStat ? avgColor(p.bvpStat.avg) : ""}`}>
                          {p.bvpStat?.avg || <span style={{color:"var(--text-muted)"}}>—</span>}
                        </td>
                        <td className={`td-mono ${avgColor(p.platoonStat?.avg)}`}>
                          {p.platoonStat?.avg || "—"}
                        </td>
                        <td className="td-mono" style={!isPremium ? { filter: "blur(5px)", cursor: "pointer" } : undefined} onClick={!isPremium ? (e) => { e.stopPropagation(); onUpgrade && onUpgrade(); } : undefined}>
                          {p.scoreData.statcast ? (
                            <span className={p.scoreData.statcast.xba >= 0.280 ? "hot" : p.scoreData.statcast.xba >= 0.250 ? "warm" : "cold"}>
                              .{Math.round(p.scoreData.statcast.xba * 1000)}
                            </span>
                          ) : <span style={{color:"var(--text-muted)"}}>—</span>}
                        </td>
                        <td className="td-mono" style={!isPremium ? { filter: "blur(5px)", cursor: "pointer" } : undefined} onClick={!isPremium ? (e) => { e.stopPropagation(); onUpgrade && onUpgrade(); } : undefined}>
                          {p.scoreData.statcast ? (
                            <span style={{color: p.scoreData.statcast.barrelPct >= 10 ? "var(--green-light)" : p.scoreData.statcast.barrelPct >= 6 ? "var(--text-secondary)" : "var(--text-muted)"}}>
                              {p.scoreData.statcast.barrelPct.toFixed(1)}%
                            </span>
                          ) : <span style={{color:"var(--text-muted)"}}>—</span>}
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div className="park-bar-outer" style={{ width: 50 }}>
                              <div className={`park-bar-fill ${PARK_FACTORS[p.game.venue]?.type || "neutral"}`}
                                style={{ width: `${Math.min(Math.max(((p.pf-80)/50)*100,0),100)}%` }} />
                            </div>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: p.pf >= 105 ? "var(--green-light)" : p.pf <= 95 ? "var(--red-data)" : "var(--text-muted)" }}>
                              {p.pf}
                            </span>
                          </div>
                        </td>
                        {/* Prop line — PRO gated */}
                        <td onClick={e => e.stopPropagation()}>
                          <PropLineCell line={p.propLine} isPremium={isPremium} />
                        </td>
                        <td>
                          <div className="factor-pills">
                            {p.scoreData.factors.slice(0,2).map((f,fi) => (
                              <span key={fi} className={`factor-pill fp-${f.type}`}>
                                <span className="material-icons">{f.icon}</span>
                                {f.label}
                              </span>
                            ))}
                          </div>
                        </td>
                        {/* Quick-log to pick tracker */}
                        <td onClick={e => e.stopPropagation()}>
                          <button
                            title="Log to My Pick Record"
                            onClick={() => setQuickTrack({ pick: p })}
                            style={{ background:"none", border:"none", cursor:"pointer", padding:"3px 5px", borderRadius:4, color:"var(--text-muted)", transition:"color 0.15s", display: "flex", alignItems: "center", gap: 3 }}
                            onMouseEnter={e => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "rgba(21,128,61,0.08)"; }}
                            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
                          >
                            <span className="material-icons" style={{ fontSize:14 }}>add_circle</span>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.5px" }}>TRACK</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Player deep dive panel */}
      {selectedPlayer && (
        <PlayerPanel pick={selectedPlayer} onClose={() => setSelectedPlayer(null)} showBvP={showBvP} liveStats={liveStats} />
      )}

      {/* Share card modal */}
      {showShare && (() => {
        const STORAGE_KEY = "diamondiq_picks_v1";
        const now = new Date();
        let todayTracked = [];
        try {
          const allPicks = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
          todayTracked = allPicks.filter(p => p.date === date);
        } catch {}

        // Only allow sharing picks whose games have started (prevents premium leak)
        const lockedTracked = todayTracked.filter(tp => {
          const match = picks.find(s => s.batter.id === tp.playerId && s.game.gamePk === tp.gamePk);
          if (!match) {
            // Fallback: any pick for today where the stored pick has a game that started
            const anyMatch = picks.find(s => s.batter.id === tp.playerId);
            return anyMatch && new Date(anyMatch.game.gameDate) <= now;
          }
          return new Date(match.game.gameDate) <= now;
        });

        // Map to full pick data
        const shareData = lockedTracked
          .map(tp => picks.find(s => s.batter.id === tp.playerId && (s.game.gamePk === tp.gamePk || !tp.gamePk)))
          .filter(Boolean)
          .slice(0, 5);

        return shareData.length > 0 ? (
          <ShareModal picks={shareData} mode={mode} showBvP={showBvP} onClose={() => setShowShare(false)} isPersonal />
        ) : (
          <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && setShowShare(false)}>
            <div className="add-pick-modal" style={{ maxWidth: 380 }}>
              <div className="add-pick-modal-header">
                <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "white" }}>Share My Picks</span>
                <button className="close-btn" onClick={() => setShowShare(false)}><span className="material-icons">close</span></button>
              </div>
              <div className="add-pick-modal-body" style={{ textAlign: "center", padding: 24 }}>
                <span className="material-icons" style={{ fontSize: 36, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>lock_clock</span>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>
                  {todayTracked.length === 0 ? "No picks tracked today" : "Games haven't started yet"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
                  {todayTracked.length === 0
                    ? "Track picks using the TRACK button on any player row, then share once games start."
                    : `You have ${todayTracked.length} tracked pick${todayTracked.length > 1 ? "s" : ""} today. Share cards unlock once the game starts.`}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Track picker */}
      {quickTrack && (() => {
        const p = quickTrack.pick;
        return (
          <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && setQuickTrack(null)}>
            <div className="add-pick-modal" style={{ maxWidth: 340 }}>
              <div className="add-pick-modal-header">
                <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 800, color: "white" }}>
                  Track Pick — {p.batter.name}
                </span>
                <button className="close-btn" onClick={() => setQuickTrack(null)}><span className="material-icons">close</span></button>
              </div>
              <div className="add-pick-modal-body" style={{ gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Select prop type:</div>
                {PROP_TYPES.map(prop => (
                  <button key={prop} className="btn btn-sm" onClick={() => {
                    openAddPick({
                      playerName: p.batter.name, playerId: p.batter.id,
                      team: p.battingTeam.abbr, opponent: p.pitcher.name,
                      date: (p.game.gameDate || date).slice(0, 10),
                      hitScore: showBvP ? p.scoreData.withBvP : p.scoreData.withoutBvP,
                      prop, gamePk: p.game.gamePk,
                    });
                    setQuickTrack(null);
                  }}
                    style={{ width: "100%", justifyContent: "flex-start", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13, padding: "10px 14px" }}>
                    <span className="material-icons" style={{ fontSize: 14, color: "var(--accent)" }}>add_circle</span>
                    {prop}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pick tracked toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "10px 20px", borderRadius: 10,
          background: toast.type === "ok" ? "var(--accent)" : toast.type === "warn" ? "#F59E0B" : "var(--red-data)",
          color: "white", fontSize: 13, fontWeight: 700,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 8,
          animation: "fadeIn 0.2s ease",
        }}>
          <span className="material-icons" style={{ fontSize: 16 }}>
            {toast.type === "ok" ? "check_circle" : toast.type === "warn" ? "info" : "error"}
          </span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function PickCard({ pick, rank, showBvP, onClick, pct, mode, liveStats }) {
  const score = showBvP ? pick.scoreData.withBvP : pick.scoreData.withoutBvP;
  const color = scoreColor(score);
  const tier  = pick.scoreData.tier;
  const line  = pick.propLine;
  const isPropsMode = mode === "props";

  const now = new Date();
  const gameStarted = pick.game.gameDate && new Date(pick.game.gameDate) <= now;
  const gamePk = pick.game.gamePk;
  const gameData = liveStats?.[gamePk];
  const playerStat = gameData?.stats?.get(pick.batter.id);
  // Schedule abstractState is authoritative — "Preview" | "Live" | "Final"
  const scheduleStatus = pick.game.abstractState;
  const gameStatus = (scheduleStatus && scheduleStatus !== "Preview") ? scheduleStatus : (gameData?.status ?? "Preview");
  const isLive  = gameStatus === "Live";
  const isFinal = gameStatus === "Final";

  const factors = pick.scoreData.factors || [];
  const hasPower = factors.some(f => f.label?.toLowerCase().includes("barrel") || f.label?.toLowerCase().includes("xba"));
  const propLabel = hasPower ? "1+ Total Bases" : "1+ Hits";

  function oddsColor(price) {
    if (price == null) return "var(--text-muted)";
    return price < 0 ? "var(--data-green)" : "var(--data-yellow)";
  }
  function oddsBg(price) {
    if (price == null) return "transparent";
    return price < 0 ? "var(--data-green-bg)" : "var(--data-yellow-bg)";
  }

  return (
    <div className={`pick-card ${tier}`} onClick={onClick} style={{ position: "relative", opacity: gameStarted ? 0.92 : 1 }}>

      {/* Lock / live banner */}
      {gameStarted && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          background: isFinal ? "rgba(15,23,42,0.85)" : "rgba(10,35,66,0.80)",
          backdropFilter: "blur(2px)",
          borderRadius: "10px 10px 0 0",
          padding: "5px 10px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          zIndex: 2,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span className="material-icons" style={{ fontSize: 13, color: isFinal ? "rgba(255,255,255,0.45)" : isLive ? "#4ADE80" : "#F59E0B" }}>
              {isFinal ? "check_circle" : isLive ? "sports_baseball" : "lock"}
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase",
              color: isFinal ? "rgba(255,255,255,0.45)" : isLive ? "#4ADE80" : "#F59E0B" }}>
              {isFinal ? "Final" : isLive ? "Live" : "Locked"}
            </span>
          </div>
          {/* Stat line — only show when we actually have data */}
          {playerStat && (isLive || isFinal) ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 900, fontFamily: "var(--font-mono)",
                color: playerStat.hits > 0 ? "#4ADE80" : "rgba(255,255,255,0.6)" }}>
                {playerStat.hits}-{playerStat.atBats}
              </span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>·</span>
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.5)" }}>
                {playerStat.totalBases}TB
              </span>
              {playerStat.rbi > 0 && <>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>·</span>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.5)" }}>{playerStat.rbi}RBI</span>
              </>}
            </div>
          ) : (
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>loading…</span>
          )}
        </div>
      )}

      <div style={{ marginTop: gameStarted ? 30 : 0 }}>
        <div className="pick-rank">#{rank} · {pick.battingTeam.abbr} vs {pick.pitcher.name}</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <PlayerPhoto playerId={pick.batter.id} name={pick.batter.name} size={44} hot={pick.hot} />
          <div>
            <div className="pick-name" style={{ marginBottom:0 }}>
              {pick.batter.name}
              {pick.lineupStatus === "confirmed" && (
                <span className="lineup-badge confirmed" style={{ marginLeft: 6 }}>#{pick.lineupPos}</span>
              )}
            </div>
            <div className="pick-meta" style={{ marginBottom:0 }}>
              {pick.batter.batSide}HB · <GameTime gameDate={pick.game.gameDate} />
              {pick.lineupStatus === "projected" && (
                <span className="lineup-badge projected" style={{ marginLeft: 6 }}>PROJ</span>
              )}
            </div>
            {pick.game.weather?.condition && !DOME_VENUES.has(pick.game.venue) && (
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                {pick.game.weather.temp && `${pick.game.weather.temp}°`} {pick.game.weather.condition}
                {pick.game.weather.wind && ` · ${pick.game.weather.wind.length > 20 ? pick.game.weather.wind.slice(0,20) + "…" : pick.game.weather.wind}`}
              </div>
            )}
          </div>
        </div>
        <div className="pick-score">
          <AnimatedScore target={score} color={color} />
        </div>
        {pct !== undefined && (
          <div style={{ fontSize:10, fontWeight:700, color:"var(--text-muted)", letterSpacing:"0.5px", marginBottom:2 }}>
            TOP {pct}% TODAY
          </div>
        )}
        <div className="pick-bar">
          <div className="pick-bar-fill" style={{ width: `${score}%`, background: color }} />
        </div>
        {isPropsMode && (
          <div style={{ marginTop: 8, padding: "7px 10px", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{propLabel}</span>
            {line ? (
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--navy)" }}>O{line.point}</span>
                <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)", color: oddsColor(line.over), background: oddsBg(line.over), padding: "1px 5px", borderRadius: 4 }}>{fmtOdds(line.over)}</span>
                <span style={{ fontSize: 9, color: "var(--border-dark)" }}>/</span>
                <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)", color: oddsColor(line.under), background: oddsBg(line.under), padding: "1px 5px", borderRadius: 4 }}>{fmtOdds(line.under)}</span>
              </div>
            ) : (
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{HAS_PROP_LINES ? "No line yet" : "—"}</span>
            )}
          </div>
        )}
        <div className="pick-reason" style={{ marginTop: isPropsMode ? 6 : undefined }}>
          {pick.scoreData.factors.slice(0,2).map(f => f.label).join(" · ") || "Consistent hitter"}
          {!pick.hasBvP && " · Est. (no BvP)"}
        </div>
      </div>
    </div>
  );
}
// ── Player Photo with flame badge ─────────────────────────────────────────────
function PlayerPhoto({ playerId, name, size = 36, hot = false }) {
  const [err, setErr] = useState(false);
  const initials = name?.split(" ").map(w => w[0]).slice(0,2).join("") || "?";
  return (
    <div className={`player-photo-wrap ${hot ? "hot" : ""}`} style={{ width: size, height: size }}>
      {!err ? (
        <img
          src={headshot(playerId)}
          alt={name}
          className="player-photo"
          style={{ width: size, height: size }}
          onError={() => setErr(true)}
        />
      ) : (
        <div className="player-avatar" style={{ width: size, height: size, fontSize: size * 0.32 }}>
          {initials}
        </div>
      )}
      {hot && (
        <div className="flame-badge">
          <span className="material-icons">local_fire_department</span>
        </div>
      )}
    </div>
  );
}

// ── Prop Line Cell ────────────────────────────────────────────────────────────
function PropLineCell({ line, isPremium }) {
  if (!isPremium) {
    return (
      <div className="pro-gate">
        <div className="pro-blurred">O0.5 -155 / +130</div>
        <div className="pro-lock-overlay">
          <span className="material-icons">lock</span>
          <span className="pro-lock-label">Pro</span>
        </div>
      </div>
    );
  }
  if (!HAS_PROP_LINES) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>No odds key</span>
        <span style={{ fontSize: 8, color: "var(--text-muted)", opacity: 0.6 }}>Add ODDS_API_KEY</span>
      </div>
    );
  }
  if (!line) {
    return <span style={{ fontSize: 10, color: "var(--text-muted)" }}>—</span>;
  }

  // Color-code odds: favorite (negative) = green tint, underdog (positive) = yellow
  const overColor  = line.over  != null ? (line.over  < 0 ? "var(--data-green)"  : "var(--data-yellow)") : "var(--text-muted)";
  const underColor = line.under != null ? (line.under < 0 ? "var(--data-green)"  : "var(--data-yellow)") : "var(--text-muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
      {/* Line header */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{
          fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)",
          color: "var(--navy)", background: "var(--surface-3)",
          padding: "1px 6px", borderRadius: 4, letterSpacing: "0.3px",
        }}>
          O{line.point}
        </span>
        <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>hits</span>
      </div>
      {/* Over / Under odds */}
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.5px" }}>OVR</span>
          <span style={{
            fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)", color: overColor,
            background: line.over != null ? (line.over < 0 ? "var(--data-green-bg)" : "var(--data-yellow-bg)") : "transparent",
            padding: "1px 5px", borderRadius: 4,
          }}>
            {fmtOdds(line.over)}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "var(--border-dark)" }}>·</span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ fontSize: 8, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.5px" }}>UND</span>
          <span style={{
            fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)", color: underColor,
            background: line.under != null ? (line.under < 0 ? "var(--data-green-bg)" : "var(--data-yellow-bg)") : "transparent",
            padding: "1px 5px", borderRadius: 4,
          }}>
            {fmtOdds(line.under)}
          </span>
        </div>
      </div>
      {/* Bookmaker source */}
      {line.bookmaker && (
        <span style={{ fontSize: 8, color: "var(--text-muted)", opacity: 0.7, letterSpacing: "0.3px" }}>
          {line.bookmaker}
        </span>
      )}
    </div>
  );
}

function AnimatedScore({ target, color }) {
  const [val, setVal] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!target) return;
    const startTime = performance.now();
    const duration  = 900;
    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setVal(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  return <span style={{ color }}>{val}</span>;
}

// ── Game Time ─────────────────────────────────────────────────────────────
function GameTime({ gameDate, mode, gameStatus, liveGameData }) {
  if (!gameDate) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>;

  // Show special status badges for delayed/postponed
  if (gameStatus?.isRainDelay) return (
    <div style={{ fontSize: 10, fontWeight: 800, color: "#60A5FA", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 3 }}>
      <span className="material-icons" style={{ fontSize: 12 }}>water_drop</span>DELAY
    </div>
  );
  if (gameStatus?.isPostponed) return (
    <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", whiteSpace: "nowrap" }}>PPD</div>
  );

  const d = new Date(gameDate);
  const now = new Date();
  const started = now >= d;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
  const isLate = d.getUTCHours() >= 23;

  // Use actual game status from live data if available
  const schedStatus = gameStatus?.abstractState; // from pick.game.abstractState passed as gameStatus prop
  const actualStatus = schedStatus && schedStatus !== "Preview"
    ? schedStatus
    : liveGameData?.status; // fallback to boxscore status
  const isActuallyLive  = actualStatus === "Live";
  const isActuallyFinal = actualStatus === "Final";

  // Only show LOCKED in BTS mode while game hasn't started or is live (not final)
  if (started && mode === "bts") {
    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: isActuallyFinal ? "rgba(255,255,255,0.4)" : "var(--red-data)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 3 }}>
          <span className="material-icons" style={{ fontSize: 12 }}>{isActuallyFinal ? "check_circle" : "lock"}</span>
          {isActuallyFinal ? "Final" : "LOCKED"}
        </div>
        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>{time} ET</div>
      </div>
    );
  }
  if (started) {
    // If liveGameData hasn't loaded yet, show a subtle loading state, not "In Progress"
    if (!liveGameData) {
      return (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {time} ET
          </div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", opacity: 0.5 }}>checking…</div>
        </div>
      );
    }
    const label = isActuallyFinal ? "Final" : isActuallyLive ? "Live" : null;
    const labelColor = isActuallyFinal ? "var(--text-muted)" : "#4ADE80";
    const labelIcon = isActuallyFinal ? "check_circle" : "sports_baseball";
    return (
      <div>
        {label && (
          <div style={{ fontSize: 10, fontWeight: 800, color: labelColor, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 3 }}>
            <span className="material-icons" style={{ fontSize: 11 }}>{labelIcon}</span>{label}
          </div>
        )}
        <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{time} ET</div>
      </div>
    );
  }
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: isLate ? "var(--text-muted)" : "var(--text-secondary)", whiteSpace: "nowrap" }}>
      {time}
      <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 2 }}>ET</span>
    </div>
  );
}

// ── Weather Cell ──────────────────────────────────────────────────────────
const WX_ICONS = { Sunny: "wb_sunny", Clear: "nights_stay", Cloudy: "cloud", Overcast: "cloud", Drizzle: "grain", Rain: "water_drop", Snow: "ac_unit", Dome: "domain", Roof: "roofing" };

function WeatherCell({ weather, venue }) {
  if (DOME_VENUES.has(venue)) {
    return (
      <div className="wx-cell" title="Retractable roof / dome">
        <span className="material-icons" style={{ fontSize: 13, color: "var(--text-muted)" }}>domain</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Dome</span>
      </div>
    );
  }
  if (!weather || !weather.condition) {
    return <span style={{ fontSize: 10, color: "var(--text-muted)" }}>—</span>;
  }
  const cond = weather.condition || "";
  const temp = weather.temp ? `${weather.temp}°` : "";
  const wind = weather.wind || "";
  const icon = WX_ICONS[cond] || "thermostat";
  // Flag extreme conditions
  const tempNum = parseInt(weather.temp);
  const isExtreme = tempNum && (tempNum >= 95 || tempNum <= 45);
  const windMph = parseInt(wind);
  const isWindy = windMph && windMph >= 15;
  const windOut = isWindy && /out/i.test(wind);
  const windIn = isWindy && /in/i.test(wind);

  return (
    <div className="wx-cell" title={`${cond} ${temp} · ${wind}`}>
      <span className="material-icons" style={{ fontSize: 13, color: isExtreme ? "var(--yellow)" : "var(--text-muted)" }}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 1.2 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: isExtreme ? "var(--yellow)" : "var(--text-secondary)" }}>
          {temp} {cond}
        </span>
        {wind && (() => {
          const isOut = /out/i.test(wind);
          const isIn = /in/i.test(wind);
          const isCross = !isOut && !isIn;
          // Only show wind details if actionable (in/out) or strong
          if (isCross && windMph < 10) return null;
          const label = isOut ? `${windMph}mph Out` : isIn ? `${windMph}mph In` : `${windMph}mph`;
          return (
            <span style={{ fontSize: 9, color: isOut ? "var(--green-light)" : isIn ? "var(--red-data)" : "var(--text-muted)" }}>
              {label}
              {isOut && " ↑"}
              {isIn && " ↓"}
            </span>
          );
        })()}
      </div>
    </div>
  );
}

// ── Lineup Status Bar ─────────────────────────────────────────────────────
function LineupStatusBar({ statusMap }) {
  const entries = Object.entries(statusMap);
  if (!entries.length) return null;

  let confirmed = 0, projected = 0;
  for (const [, sides] of entries) {
    if (sides.home === "confirmed") confirmed++; else projected++;
    if (sides.away === "confirmed") confirmed++; else projected++;
  }
  const total = confirmed + projected;

  return (
    <div className="lineup-status-bar">
      <div className="lineup-status-icon">
        <span className="material-icons" style={{ fontSize: 16, color: confirmed === total ? "var(--green-light)" : "var(--yellow)" }}>
          {confirmed === total ? "check_circle" : "schedule"}
        </span>
      </div>
      <div className="lineup-status-text">
        <span style={{ fontWeight: 700 }}>{confirmed}</span> of {total} lineups confirmed
        {projected > 0 && (
          <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>
            · {projected} using roster projections
          </span>
        )}
      </div>
      {confirmed < total && (
        <div className="lineup-status-hint">
          <span className="material-icons" style={{ fontSize: 12 }}>info</span>
          Lineups lock ~1-3 hrs before first pitch
        </div>
      )}
    </div>
  );
}

// ── Shareable Pick Card ───────────────────────────────────────────────────────
function ShareModal({ picks, mode, showBvP, onClose, isPersonal }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  useEffect(() => {
    drawCard();
  }, [picks, showBvP]);

  async function drawCard() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 600, H = 140 + picks.length * 80 + 50;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0A2342");
    grad.addColorStop(1, "#132E52");
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, W, H, 16);
    ctx.fill();

    // Header
    ctx.fillStyle = "#15803D";
    roundRect(ctx, 16, 16, 40, 40, 8);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.font = "bold 14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("IQ", 36, 42);
    ctx.textAlign = "left";
    ctx.font = "bold 20px system-ui";
    ctx.fillText("DiamondIQ", 66, 34);
    ctx.font = "11px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(`${mode === "bts" ? "Beat the Streak" : "Props / DFS"} · ${today}`, 66, 50);

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, 72); ctx.lineTo(W-16, 72); ctx.stroke();

    // Section title
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 9px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(isPersonal ? "MY PICKS TODAY" : "TODAY'S TOP PICKS", 20, 90);

    // Column headers
    ctx.font = "bold 9px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("PLAYER", 50, 110);
    ctx.textAlign = "center";
    ctx.fillText("SCORE", 400, 110);
    ctx.fillText("TIER", 465, 110);
    ctx.fillText("L7", 530, 110);
    ctx.textAlign = "left";

    // Player rows
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const y = 120 + i * 80;
      const score = showBvP ? p.scoreData.withBvP : p.scoreData.withoutBvP;
      const tier = p.scoreData.tierLabel;

      // Row background
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        roundRect(ctx, 12, y, W - 24, 72, 8);
        ctx.fill();
      }

      // Rank circle
      ctx.fillStyle = score >= 75 ? "#F59E0B" : score >= 60 ? "#15803D" : score >= 45 ? "#3B82F6" : "#64748B";
      ctx.beginPath(); ctx.arc(32, y + 36, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), 32, y + 40);
      ctx.textAlign = "left";

      // Player name + matchup
      ctx.fillStyle = "white";
      ctx.font = "bold 14px system-ui";
      ctx.fillText(p.batter.name, 54, y + 30);
      ctx.font = "11px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(`${p.battingTeam.abbr} vs ${p.pitcher.name} · ${p.pitcher.hand || "?"}HP`, 54, y + 48);

      // Factors
      const factors = p.scoreData.factors.slice(0, 3).map(f => f.label).join("  ·  ");
      ctx.font = "9px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(factors, 54, y + 63);

      // Score
      ctx.textAlign = "center";
      ctx.fillStyle = score >= 75 ? "#F59E0B" : score >= 60 ? "#4ADE80" : score >= 45 ? "#60A5FA" : "#94A3B8";
      ctx.font = "bold 22px system-ui";
      ctx.fillText(String(score), 400, y + 38);

      // Score bar
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundRect(ctx, 370, y + 46, 60, 4, 2); ctx.fill();
      ctx.fillStyle = score >= 75 ? "#F59E0B" : score >= 60 ? "#4ADE80" : score >= 45 ? "#60A5FA" : "#94A3B8";
      roundRect(ctx, 370, y + 46, Math.max(score * 0.6, 2), 4, 2); ctx.fill();

      // Tier badge
      const tierColors = { Elite: "#F59E0B", Strong: "#15803D", Solid: "#3B82F6", Risky: "#64748B" };
      ctx.fillStyle = tierColors[tier] || "#64748B";
      roundRect(ctx, 440, y + 24, 50, 20, 4); ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "bold 9px system-ui";
      ctx.fillText(tier, 465, y + 38);

      // L7
      const l7 = p.l7?.avg || "—";
      const l7num = parseFloat(l7);
      ctx.fillStyle = l7num >= 0.300 ? "#4ADE80" : l7num >= 0.265 ? "#FBBF24" : "rgba(255,255,255,0.6)";
      ctx.font = "bold 13px system-ui";
      ctx.fillText(l7, 530, y + 38);
      ctx.textAlign = "left";
    }

    // Footer
    const fy = H - 32;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("diamondiq.app · MLB Hit Analytics", W / 2, fy);
  }

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

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `diamondiq-picks-${new Date().toLocaleDateString("en-CA")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function handleCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: download instead
      handleDownload();
    }
  }

  return (
    <div className="add-pick-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="add-pick-modal" style={{ maxWidth: 640, width: "95vw" }}>
        <div className="add-pick-modal-header">
          <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "white" }}>
            <span className="material-icons" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>share</span>
            Share Today's Picks
          </span>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <canvas ref={canvasRef} style={{ borderRadius: 12, maxWidth: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleDownload}>
              <span className="material-icons">download</span>Download PNG
            </button>
            <button className="btn btn-sm" onClick={handleCopy} style={{ background: copied ? "var(--green-light)" : "var(--surface-2)", color: copied ? "white" : "var(--text-secondary)", border: "1px solid var(--border)" }}>
              <span className="material-icons">{copied ? "check" : "content_copy"}</span>
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            Share on Twitter, Discord, or your group chat
          </div>
        </div>
      </div>
    </div>
  );
}

function SortTh({ col, s, d, onClick, tip, children }) {
  const active = s === col;
  return (
    <th className={active ? "sorted" : ""} onClick={() => onClick(col)} data-tooltip={tip} title={tip}>
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {children}
        <span className="material-icons sort-icon" style={{ fontSize: 12 }}>
          {active ? (d === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
        </span>
      </span>
    </th>
  );
}
