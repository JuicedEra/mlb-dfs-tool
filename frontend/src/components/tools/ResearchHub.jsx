import { useState, useEffect, useRef } from "react";
import {
  fetchGames, fetchRoster, fetchGameLog, computeSplit,
  computeActiveStreak, computeGamesWithHit,
  fetchPlatoonSplits, fetchHomeAwaySplits, fetchDayNightSplits,
  fetchSeasonStats, fetchStatcastForPlayer, avgColor, headshot
} from "../../utils/mlbApi";
import PlayerPanel from "../shared/PlayerPanel";

const SEASON = new Date().getFullYear();

const LENSES = [
  { id: "streaks",    label: "Active Streaks",     icon: "local_fire_department", desc: "Current consecutive-game hit streaks",          context: "Players on an active hit streak entering today. The longer the streak, the hotter the bat — your most reliable Beat the Streak candidates." },
  { id: "season_gwh", label: "Most Games w/ Hit",  icon: "military_tech",         desc: "Season total — games with at least one hit",     context: "Season-long consistency leaders. High games-with-a-hit totals signal players who make contact reliably, not just when they go 3-for-4." },
  { id: "l7",         label: "Hot Last 7",          icon: "trending_up",           desc: "Highest AVG over the last 7 games",              context: "Who's been the hottest bat over the past week? L7 AVG carries the most weight in the DiamondIQ Hit Score algorithm." },
  { id: "l3",         label: "Last 3 Days",         icon: "bolt",                  desc: "Scorching — last 3 games only",                  context: "The most recent form signal. Players hitting well in the last 3 games are often in a mechanical groove that doesn't disappear overnight." },
  { id: "yesterday",  label: "Hit Yesterday",       icon: "history",               desc: "Players who recorded a hit in their last game",  context: "Simple but powerful — players who got a hit yesterday are in rhythm. Cross-reference with today's matchup for quick, confident picks." },
  { id: "platoon",    label: "Platoon Advantage",   icon: "swap_horiz",            desc: "Best career splits vs today's opposing SP hand", context: "Players whose AVG vs the opposing starter's handedness (LHP or RHP) significantly exceeds their overall average. A core Hit Score factor." },
  { id: "homeaway",   label: "Home / Away Splits",  icon: "home",                  desc: "Sorted by today's relevant split (home or away)", context: "Context-aware: sorted by each player's split that applies to today's game. Home players rank by Home AVG, away players by Away AVG." },
  { id: "daynight",   label: "Day / Night Splits",  icon: "wb_sunny",              desc: "Filtered to match each player's game time today", context: "Day game performance can differ significantly. This lens auto-tags today's game time and shows each player's relevant split AVG." },
  { id: "multi_hit",  label: "Multi-Hit Games",     icon: "looks_two",             desc: "Players with the most 2+ hit games",             context: "Multi-hit games signal batters who don't just get lucky singles — they barrel up multiple times per game. Great for total bases props." },
  { id: "season_avg", label: "Season AVG Leaders",  icon: "emoji_events",          desc: "Highest season batting average",                 context: "The purest measure of hitting ability. Season AVG leaders are the most consistent contact makers in the league right now." },
  { id: "xba",        label: "Statcast xBA",        icon: "query_stats",           desc: "Expected batting avg from Statcast",             context: "xBA measures quality of contact independent of luck. Players with high xBA are squaring the ball up well — a leading indicator of future hits.", pro: true },
  { id: "power",      label: "Power + Contact",     icon: "speed",                 desc: "Highest SLG with above-average AVG",             context: "Players who combine power (SLG) with consistent contact (AVG). These hitters drive the ball hard and put it in play — ideal for total bases props.", pro: true },
];

export default function ResearchHub({ isPremium = false, onUpgrade }) {
  const [activeLens, setActiveLens]     = useState("streaks");
  const [allData, setAllData]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [date, setDate]                 = useState(new Date().toISOString().split("T")[0]);
  const [search, setSearch]             = useState("");
  const [sortDir, setSortDir]           = useState("desc");
  const [extraCols, setExtraCols]       = useState({ tb: true, slg: true, k: false });
  const [filterTeam, setFilterTeam]     = useState("all");
  const [teams, setTeams]               = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [pinnedIds, setPinnedIds]       = useState(new Set());
  const [showComparison, setShowComparison] = useState(false);

  // Cache keyed by date — lens switches are instant, no re-fetch
  const cacheRef = useRef({});

  useEffect(() => {
    setSearch("");
    setFilterTeam("all");
    if (cacheRef.current[date]) {
      const { data, teams: cachedTeams } = cacheRef.current[date];
      setAllData(data);
      setTeams(cachedTeams);
    } else {
      loadAllPlayers(false);
    }
  }, [date]);

  async function loadAllPlayers(force = false) {
    if (force) delete cacheRef.current[date];
    if (cacheRef.current[date]) {
      const { data, teams: cachedTeams } = cacheRef.current[date];
      setAllData(data);
      setTeams(cachedTeams);
      return;
    }
    setLoading(true);
    setAllData([]);
    try {
      const { games } = await fetchGames(date);
      const batters = [];
      const seen = new Set();
      const teamSet = new Set();

      for (const game of games) {
        for (const side of ["home", "away"]) {
          const team = game[side];
          teamSet.add(team.team);
          try {
            const roster = await fetchRoster(team.teamId);
            for (const b of roster.slice(0, 13)) {
              if (seen.has(b.id)) continue;
              seen.add(b.id);
              batters.push({ batter: b, team, game });
            }
          } catch { /* skip */ }
        }
      }

      const teamsList = [...teamSet].sort();
      setTeams(teamsList);

      const results = await Promise.allSettled(
        batters.map(({ batter, team, game }) => loadBatterData(batter, team, game))
      );
      const data = results
        .filter(r => r.status === "fulfilled" && r.value)
        .map(r => r.value);

      cacheRef.current[date] = { data, teams: teamsList };
      setAllData(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadBatterData(batter, team, game) {
    try {
      let gl = await fetchGameLog(batter.id, SEASON);

      // Spring training fallback
      if (gl.length < 3) {
        const stGL = await fetchGameLog(batter.id, SEASON, "S");
        if (stGL && stGL.length > gl.length) gl = [...gl, ...stGL];
      }

      const l7     = computeSplit(gl, 7);
      const l3     = computeSplit(gl, 3);
      const l1     = computeSplit(gl, 1);
      const streak = computeActiveStreak(gl);
      const gwh    = computeGamesWithHit(gl);

      const [pl, ha, dn, ss, sc] = await Promise.allSettled([
        fetchPlatoonSplits(batter.id, SEASON),
        fetchHomeAwaySplits(batter.id, SEASON),
        fetchDayNightSplits(batter.id, SEASON),
        fetchSeasonStats(batter.id, SEASON),
        fetchStatcastForPlayer(batter.id, SEASON),
      ]);
      const platoon  = pl.value || {};
      const homeaway = ha.value || {};
      const daynight = dn.value || {};
      const season   = ss.value || {};
      const statcast = sc.value || null;

      const oppSide    = game.home.teamId === team.teamId ? "away" : "home";
      const oppHand    = game[oppSide]?.pitcher?.hand || "R";
      const platoonKey = oppHand === "L" ? "vs. Left" : "vs. Right";
      const isHome     = game.home.teamId === team.teamId;

      return { batter, team, game, l7, l3, l1, streak, gwh, platoon, platoonKey, homeaway, daynight, season, gl, oppHand, isHome, statcast };
    } catch { return null; }
  }

  function togglePin(batterId) {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(batterId)) next.delete(batterId);
      else if (next.size < 4) next.add(batterId);
      return next;
    });
  }

  function openPlayerPanel(d) {
    const oppSide = d.game.home.teamId === d.team.teamId ? "away" : "home";
    setSelectedPlayer({
      batter:      d.batter,
      pitcher:     d.game[oppSide]?.pitcher || null,
      game:        d.game,
      battingTeam: d.team,
      scoreData:   null,
    });
  }

  const lens = LENSES.find(l => l.id === activeLens);

  const getPrimary = d => {
    switch (activeLens) {
      case "streaks":    return d.streak;
      case "season_gwh": return d.gwh;
      case "l7":         return parseFloat(d.l7?.avg) || 0;
      case "l3":         return parseFloat(d.l3?.avg) || 0;
      case "yesterday":  return d.l1?.hits || 0;
      case "platoon":    return parseFloat(d.platoon[d.platoonKey]?.avg) || 0;
      case "homeaway":   return parseFloat(d.isHome ? d.homeaway["Home"]?.avg : d.homeaway["Away"]?.avg) || 0;
      case "daynight":   return parseFloat(d.daynight[d.game.isNight ? "Night" : "Day"]?.avg) || 0;
      case "multi_hit":  return d.gl?.filter(g => parseInt(g.hits) >= 2).length || 0;
      case "season_avg": return parseFloat(d.season?.avg) || 0;
      case "xba":        return parseFloat(d.statcast?.est_ba) || 0;
      case "power": {
        const slg = parseFloat(d.season?.slg) || 0;
        const avg = parseFloat(d.season?.avg) || 0;
        return avg >= 0.200 ? slg : 0; // Must have respectable AVG
      }
      default: return 0;
    }
  };

  const filtered = allData
    .filter(d => {
      if (activeLens === "streaks"   && d.streak === 0) return false;
      if (activeLens === "yesterday" && (d.l1?.hits || 0) === 0) return false;
      if (filterTeam !== "all" && d.team.team !== filterTeam) return false;
      if (search && !d.batter.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => sortDir === "desc" ? getPrimary(b) - getPrimary(a) : getPrimary(a) - getPrimary(b));

  const pinnedPlayers = allData.filter(d => pinnedIds.has(d.batter.id));
  const hasTBSLK = ["l7", "l3", "yesterday"].includes(activeLens);

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Player Research Hub</h1>
          <p className="page-subtitle">
            {loading ? "Loading player data..." : `${allData.length} players loaded · lens switches are instant`}
          </p>
        </div>
        <div className="page-actions">
          <input type="date" className="filter-input" value={date}
            onChange={e => setDate(e.target.value)}
            style={{ height: 36, fontSize: 13 }} />
          <button className="btn btn-primary btn-sm" onClick={() => loadAllPlayers(true)} disabled={loading}>
            <span className="material-icons">refresh</span>
            {loading ? "Loading..." : "Reload"}
          </button>
          {pinnedIds.size > 0 && (
            <button className="btn btn-navy btn-sm" onClick={() => setShowComparison(true)}>
              <span className="material-icons">compare_arrows</span>
              Compare ({pinnedIds.size})
            </button>
          )}
          {pinnedIds.size > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPinnedIds(new Set())}>
              Clear pins
            </button>
          )}
        </div>
      </div>

      {/* Lens grid */}
      <div className="lens-grid">
        {LENSES.map(l => {
          const locked = l.pro && !isPremium;
          return (
            <button key={l.id} className={`lens-card ${activeLens === l.id ? "active" : ""} ${locked ? "lens-locked" : ""}`}
              onClick={() => {
                if (locked) { onUpgrade && onUpgrade(); return; }
                setActiveLens(l.id); setSortDir("desc");
              }}
              style={locked ? { opacity: 0.55 } : undefined}>
              <span className="material-icons lens-icon">{l.icon}</span>
              <div className="lens-name">
                {l.label}
                {locked && <span className="material-icons" style={{ fontSize: 12, color: "var(--yellow)", marginLeft: 4, verticalAlign: "middle" }}>lock</span>}
              </div>
              <div className="lens-desc">{l.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Context banner */}
      {lens && !loading && allData.length > 0 && (
        <div className="info-banner accent">
          <span className="material-icons">{lens.icon}</span>
          <div><strong>{lens.label}:</strong> {lens.context}</div>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Search</span>
          <div className="filter-input-icon" style={{ minWidth: 220 }}>
            <span className="material-icons">search</span>
            <input className="filter-input" style={{ paddingLeft: 34, width: "100%" }}
              placeholder="Filter by player name..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Team</span>
          <select className="filter-select" value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
            <option value="all">All Teams</option>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {hasTBSLK && (
          <div className="filter-group">
            <span className="filter-label">Show Columns</span>
            <div className="chip-group">
              {[["tb","Total Bases"],["slg","SLG"],["k","K"]].map(([k, label]) => (
                <button key={k} className={`chip ${extraCols[k] ? "active" : ""}`}
                  onClick={() => setExtraCols(p => ({ ...p, [k]: !p[k] }))}>{label}</button>
              ))}
            </div>
          </div>
        )}

        <div className="filter-group">
          <span className="filter-label">Sort</span>
          <div className="chip-group">
            <button className={`chip ${sortDir==="desc"?"active":""}`} onClick={() => setSortDir("desc")}>
              <span className="material-icons">arrow_downward</span>High → Low
            </button>
            <button className={`chip ${sortDir==="asc"?"active":""}`} onClick={() => setSortDir("asc")}>
              <span className="material-icons">arrow_upward</span>Low → High
            </button>
          </div>
        </div>

        <div style={{ marginLeft:"auto", alignSelf:"flex-end", display:"flex", gap:10, alignItems:"center" }}>
          {pinnedIds.size > 0 && (
            <span style={{ fontSize:11, color:"var(--navy)", fontWeight:700 }}>
              <span className="material-icons" style={{ fontSize:12, verticalAlign:"middle" }}>push_pin</span>
              {" "}{pinnedIds.size} pinned
            </span>
          )}
          <span style={{ fontSize:12, color:"var(--text-muted)" }}>
            {loading ? "Loading..." : `${filtered.length} players`}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading player data for {date}...</div>
      ) : allData.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">today</span></div>
          <div className="empty-title">No games found</div>
          <div className="empty-sub">Select a date with MLB games and click Reload</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">search_off</span></div>
          <div className="empty-title">No results</div>
          <div className="empty-sub">Try a different lens, team filter, or search</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header">
            <span className="card-title">
              <span className="material-icons">{lens?.icon}</span>
              {lens?.label} · {date}
            </span>
            <span style={{ fontSize:11, color:"var(--text-muted)", display:"flex", alignItems:"center", gap:8 }}>
              {filtered.length} players
              <span>· click row for full profile</span>
              <span className="material-icons" style={{ fontSize:12 }}>push_pin</span>
              <span>pin up to 4 to compare</span>
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width:36}}>#</th>
                  <th style={{width:40}} data-tooltip="Pin to compare (max 4)">
                    <span className="material-icons" style={{ fontSize:13 }}>push_pin</span>
                  </th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Today's Matchup</th>
                  {activeLens === "streaks"    && <><th>Streak</th><th>L7 AVG</th><th>Season AVG</th><th>H / AB (L7)</th></>}
                  {activeLens === "season_gwh" && <><th>G w/ Hit</th><th>G Played</th><th>Hit Rate</th><th>Season AVG</th></>}
                  {activeLens === "l7"         && <><th>L7 AVG</th><th>H</th><th>AB</th>{extraCols.tb&&<th>TB</th>}{extraCols.slg&&<th>SLG</th>}{extraCols.k&&<th>K</th>}</>}
                  {activeLens === "l3"         && <><th>L3 AVG</th><th>H</th><th>AB</th>{extraCols.tb&&<th>TB</th>}{extraCols.slg&&<th>SLG</th>}{extraCols.k&&<th>K</th>}</>}
                  {activeLens === "yesterday"  && <><th>H Yesterday</th><th>AB</th><th>HR</th>{extraCols.tb&&<th>TB</th>}{extraCols.slg&&<th>SLG</th>}</>}
                  {activeLens === "platoon"    && <><th>vs Hand</th><th>Split AVG</th><th>OBP</th><th>Sample</th><th>Season AVG</th></>}
                  {activeLens === "homeaway"   && <><th>Today's Split ▼</th><th>Home AVG</th><th>Away AVG</th><th>Context</th></>}
                  {activeLens === "daynight"   && <><th>Day AVG</th><th>Night AVG</th><th>Today</th><th>Relevant AVG ▼</th></>}
                  {activeLens === "multi_hit"  && <><th data-tooltip="Games with 2+ hits">2+ Hit G</th><th>G Played</th><th data-tooltip="Percentage of games with 2+ hits">Multi-Hit %</th><th>Season AVG</th></>}
                  {activeLens === "season_avg" && <><th>Season AVG</th><th>H</th><th>AB</th><th data-tooltip="On-base plus slugging">OPS</th></>}
                  {activeLens === "xba"        && <><th data-tooltip="Expected batting avg from Statcast">xBA</th><th>Actual BA</th><th data-tooltip="xBA minus BA — positive = unlucky, likely to improve">Diff</th><th data-tooltip="Barrel rate">Barrel%</th></>}
                  {activeLens === "power"      && <><th data-tooltip="Slugging percentage">SLG</th><th>Season AVG</th><th data-tooltip="Isolated power (SLG - AVG)">ISO</th><th data-tooltip="On-base plus slugging">OPS</th></>}
                </tr>
              </thead>
              <tbody>
                {!isPremium && filtered.length > 0 && (
                  <tr>
                    <td colSpan="99" style={{ padding: "8px 16px", background: "linear-gradient(90deg, rgba(245,158,11,0.06), rgba(21,128,61,0.06))", textAlign: "center", borderBottom: "1px solid rgba(245,158,11,0.1)" }}>
                      <span className="material-icons" style={{ fontSize: 13, verticalAlign: "middle", color: "var(--yellow)", marginRight: 5 }}>lock</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--yellow)" }}>#1 ranked player is PRO-only</span>
                      <button className="btn btn-sm" onClick={onUpgrade}
                        style={{ marginLeft: 10, fontSize: 9, padding: "2px 10px", background: "var(--yellow)", color: "#0A2342", border: "none", fontWeight: 800 }}>
                        Unlock
                      </button>
                    </td>
                  </tr>
                )}
                {filtered.slice(0, 75).map((d, i) => {
                  const isLocked = !isPremium && i === 0;
                  return (
                    <tr key={d.batter.id} style={isLocked ? { filter: "blur(6px)", userSelect: "none" } : undefined}
                      onClick={() => isLocked ? (onUpgrade && onUpgrade()) : openPlayerPanel(d)}>
                      <LensRowInner
                        d={d} i={i}
                        lens={activeLens}
                        extraCols={extraCols}
                        isPinned={pinnedIds.has(d.batter.id)}
                        canPin={pinnedIds.size < 4 || pinnedIds.has(d.batter.id)}
                        onPin={e => { e.stopPropagation(); togglePin(d.batter.id); }}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPlayer && (
        <PlayerPanel pick={selectedPlayer} onClose={() => setSelectedPlayer(null)} showBvP={false} />
      )}

      {showComparison && pinnedPlayers.length > 0 && (
        <ComparePanel players={pinnedPlayers} onClose={() => setShowComparison(false)} />
      )}
    </div>
  );
}

// ── Lens Row ──────────────────────────────────────────────────────────────────
function LensRowInner({ d, i, lens, extraCols, isPinned, canPin, onPin }) {
  const oppSide = d.game.home.teamId === d.team.teamId ? "away" : "home";
  const opp     = d.game[oppSide];
  const matchup = `${d.team.abbr} ${d.isHome ? "vs" : "@"} ${opp?.abbr}`;

  return (
    <>
      <td style={{ color:"var(--text-muted)", fontSize:11, fontFamily:"var(--font-mono)" }}>{i+1}</td>

      {/* Pin button */}
      <td onClick={onPin} style={{ cursor: "pointer" }}>
        <button
          title={isPinned ? "Unpin player" : canPin ? "Pin to compare" : "Max 4 pinned"}
          style={{
            background: "none", border: "none", cursor: canPin || isPinned ? "pointer" : "not-allowed",
            padding: "3px 5px", borderRadius: 4,
            color: isPinned ? "var(--navy)" : canPin ? "var(--text-muted)" : "var(--border)",
            transition: "color 0.15s",
          }}
        >
          <span className="material-icons" style={{ fontSize: 14 }}>push_pin</span>
        </button>
      </td>

      <td>
        <div className="td-player">{d.batter.name}</div>
        <div className="td-sub">{d.batter.batSide}HB</div>
      </td>
      <td>
        <span style={{ fontSize:11, fontWeight:800, background:"var(--navy)", color:"white", padding:"2px 8px", borderRadius:5 }}>
          {d.team.abbr}
        </span>
      </td>
      <td style={{ fontSize:11 }}>
        <div style={{ fontWeight:500, color:"var(--text-secondary)" }}>{matchup}</div>
        <div style={{ color:"var(--text-muted)" }}>{d.game.venue?.split(" ").slice(0,3).join(" ")}</div>
      </td>

      {lens === "streaks" && <>
        <td>
          <span className="badge badge-green" style={{ fontSize:11, padding:"3px 10px" }}>
            <span className="material-icons" style={{ fontSize:13 }}>local_fire_department</span>{d.streak}G
          </span>
        </td>
        <td className={`td-mono ${avgColor(d.l7?.avg)}`} style={{ fontWeight:700, fontSize:14 }}>{d.l7?.avg || "—"}</td>
        <td className={`td-mono ${avgColor(d.season?.avg)}`}>{d.season?.avg || "—"}</td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.l7?.hits}/{d.l7?.ab}</td>
      </>}

      {lens === "season_gwh" && <>
        <td><span style={{ fontFamily:"var(--font-display)", fontSize:22, fontWeight:800, color:"var(--navy)" }}>{d.gwh}</span></td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.gl.length}</td>
        <td><HitRateBar rate={d.gl.length ? Math.round((d.gwh / d.gl.length) * 100) : 0} /></td>
        <td className={`td-mono ${avgColor(d.season?.avg)}`}>{d.season?.avg || "—"}</td>
      </>}

      {lens === "l7" && <>
        <td className={`td-mono ${avgColor(d.l7?.avg)}`} style={{ fontWeight:700, fontSize:15 }}>{d.l7?.avg || "—"}</td>
        <td className="td-mono">{d.l7?.hits}</td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.l7?.ab}</td>
        {extraCols.tb  && <td className="td-mono">{d.l7?.tb}</td>}
        {extraCols.slg && <td className={`td-mono ${avgColor(d.l7?.slg)}`}>{d.l7?.slg}</td>}
        {extraCols.k   && <td className="td-mono" style={{ color: +d.l7?.k >= 5 ? "var(--data-red)" : undefined }}>{d.l7?.k}</td>}
      </>}

      {lens === "l3" && <>
        <td className={`td-mono ${avgColor(d.l3?.avg)}`} style={{ fontWeight:700, fontSize:15 }}>{d.l3?.avg || "—"}</td>
        <td className="td-mono">{d.l3?.hits}</td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.l3?.ab}</td>
        {extraCols.tb  && <td className="td-mono">{d.l3?.tb}</td>}
        {extraCols.slg && <td className={`td-mono ${avgColor(d.l3?.slg)}`}>{d.l3?.slg}</td>}
        {extraCols.k   && <td className="td-mono" style={{ color: +d.l3?.k >= 2 ? "var(--data-red)" : undefined }}>{d.l3?.k}</td>}
      </>}

      {lens === "yesterday" && <>
        <td>
          <span className={`badge ${+d.l1?.hits >= 2 ? "badge-green" : "badge-accent"}`} style={{ fontSize:12, padding:"3px 10px" }}>
            {d.l1?.hits}H
          </span>
        </td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.l1?.ab}</td>
        <td className="td-mono" style={{ color: +d.l1?.hr > 0 ? "var(--data-yellow)" : undefined }}>{d.l1?.hr || 0}</td>
        {extraCols.tb  && <td className="td-mono">{d.l1?.tb}</td>}
        {extraCols.slg && <td className={`td-mono ${avgColor(d.l1?.slg)}`}>{d.l1?.slg}</td>}
      </>}

      {lens === "platoon" && <>
        <td><span className={`badge ${d.oppHand === "L" ? "hand-L" : "hand-R"}`}>vs {d.oppHand}HP</span></td>
        <td className={`td-mono ${avgColor(d.platoon[d.platoonKey]?.avg)}`} style={{ fontWeight:700, fontSize:15 }}>
          {d.platoon[d.platoonKey]?.avg || "—"}
        </td>
        <td className="td-mono">{d.platoon[d.platoonKey]?.obp || "—"}</td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.platoon[d.platoonKey]?.atBats || "—"} AB</td>
        <td className={`td-mono ${avgColor(d.season?.avg)}`}>{d.season?.avg || "—"}</td>
      </>}

      {lens === "homeaway" && <>
        {/* Primary: the relevant split for today's game */}
        <td className={`td-mono ${avgColor(d.isHome ? d.homeaway["Home"]?.avg : d.homeaway["Away"]?.avg)}`}
          style={{ fontWeight:700, fontSize:15 }}>
          {(d.isHome ? d.homeaway["Home"]?.avg : d.homeaway["Away"]?.avg) || "—"}
        </td>
        <td className={`td-mono ${avgColor(d.homeaway["Home"]?.avg)}`}>{d.homeaway["Home"]?.avg || "—"}</td>
        <td className={`td-mono ${avgColor(d.homeaway["Away"]?.avg)}`}>{d.homeaway["Away"]?.avg || "—"}</td>
        <td>
          <span className={`badge ${d.isHome ? "badge-navy" : "badge-gray"}`} style={{ fontSize:9 }}>
            {d.isHome ? "Playing Home" : "Playing Away"}
          </span>
        </td>
      </>}

      {lens === "daynight" && <>
        <td className={`td-mono ${avgColor(d.daynight["Day"]?.avg)}`}>{d.daynight["Day"]?.avg || "—"}</td>
        <td className={`td-mono ${avgColor(d.daynight["Night"]?.avg)}`}>{d.daynight["Night"]?.avg || "—"}</td>
        <td>
          <span className={`badge ${d.game.isNight ? "badge-navy" : "badge-accent"}`} style={{ fontSize:9 }}>
            <span className="material-icons" style={{ fontSize:11 }}>{d.game.isNight ? "nights_stay" : "wb_sunny"}</span>
            {d.game.isNight ? "Night" : "Day"}
          </span>
        </td>
        <td className={`td-mono ${avgColor(d.game.isNight ? d.daynight["Night"]?.avg : d.daynight["Day"]?.avg)}`}
          style={{ fontWeight:700, fontSize:14 }}>
          {(d.game.isNight ? d.daynight["Night"]?.avg : d.daynight["Day"]?.avg) || "—"}
        </td>
      </>}

      {lens === "multi_hit" && (() => {
        const mh = d.gl?.filter(g => parseInt(g.hits) >= 2).length || 0;
        const gp = d.gl?.length || 0;
        const pct = gp ? Math.round((mh / gp) * 100) : 0;
        return <>
          <td><span style={{ fontFamily:"var(--font-display)", fontSize:22, fontWeight:800, color:"var(--navy)" }}>{mh}</span></td>
          <td className="td-mono" style={{ color:"var(--text-muted)" }}>{gp}</td>
          <td><HitRateBar rate={pct} /></td>
          <td className={`td-mono ${avgColor(d.season?.avg)}`}>{d.season?.avg || "—"}</td>
        </>;
      })()}

      {lens === "season_avg" && <>
        <td className={`td-mono ${avgColor(d.season?.avg)}`} style={{ fontWeight:700, fontSize:15 }}>{d.season?.avg || "—"}</td>
        <td className="td-mono">{d.season?.hits || "—"}</td>
        <td className="td-mono" style={{ color:"var(--text-muted)" }}>{d.season?.atBats || "—"}</td>
        <td className="td-mono">{d.season?.ops || "—"}</td>
      </>}

      {lens === "xba" && (() => {
        const xba = parseFloat(d.statcast?.est_ba) || 0;
        const ba  = parseFloat(d.season?.avg) || 0;
        const diff = xba - ba;
        return <>
          <td className={`td-mono ${xba >= 0.280 ? "hot" : xba >= 0.250 ? "warm" : ""}`} style={{ fontWeight:700, fontSize:15 }}>
            {xba > 0 ? `.${Math.round(xba * 1000)}` : "—"}
          </td>
          <td className={`td-mono ${avgColor(d.season?.avg)}`}>{d.season?.avg || "—"}</td>
          <td className="td-mono" style={{ color: diff > 0.015 ? "var(--green-light)" : diff < -0.015 ? "var(--red-data)" : "var(--text-muted)", fontWeight: Math.abs(diff) > 0.015 ? 700 : 400 }}>
            {xba > 0 ? (diff > 0 ? "+" : "") + diff.toFixed(3) : "—"}
          </td>
          <td className="td-mono">{d.statcast?.brl_percent ? `${parseFloat(d.statcast.brl_percent).toFixed(1)}%` : "—"}</td>
        </>;
      })()}

      {lens === "power" && (() => {
        const slg = parseFloat(d.season?.slg) || 0;
        const avg = parseFloat(d.season?.avg) || 0;
        const iso = slg - avg;
        return <>
          <td className="td-mono" style={{ fontWeight:700, fontSize:15, color: slg >= 0.450 ? "var(--green-light)" : slg >= 0.380 ? "var(--text-primary)" : "var(--text-muted)" }}>
            {d.season?.slg || "—"}
          </td>
          <td className={`td-mono ${avgColor(d.season?.avg)}`}>{d.season?.avg || "—"}</td>
          <td className="td-mono" style={{ color: iso >= 0.180 ? "var(--green-light)" : "var(--text-muted)" }}>
            {slg > 0 && avg > 0 ? `.${Math.round(iso * 1000)}` : "—"}
          </td>
          <td className="td-mono">{d.season?.ops || "—"}</td>
        </>;
      })()}
    </>
  );
}

// ── Multi-lens Comparison Panel ───────────────────────────────────────────────
function ComparePanel({ players, onClose }) {
  const METRICS = [
    { label: "Active Streak",  fmt: d => d.streak > 0 ? `${d.streak}G` : "—",             val: d => d.streak,                                       isAvg: false },
    { label: "G w/ Hit",       fmt: d => String(d.gwh || 0),                                val: d => d.gwh,                                          isAvg: false },
    { label: "L7 AVG",         fmt: d => d.l7?.avg || "—",                                  val: d => parseFloat(d.l7?.avg) || 0,                     isAvg: true  },
    { label: "L3 AVG",         fmt: d => d.l3?.avg || "—",                                  val: d => parseFloat(d.l3?.avg) || 0,                     isAvg: true  },
    { label: "Season AVG",     fmt: d => d.season?.avg || "—",                               val: d => parseFloat(d.season?.avg) || 0,                 isAvg: true  },
    { label: "vs LHP",         fmt: d => d.platoon["vs. Left"]?.avg || "—",                 val: d => parseFloat(d.platoon["vs. Left"]?.avg) || 0,    isAvg: true  },
    { label: "vs RHP",         fmt: d => d.platoon["vs. Right"]?.avg || "—",                val: d => parseFloat(d.platoon["vs. Right"]?.avg) || 0,   isAvg: true  },
    { label: "Home AVG",       fmt: d => d.homeaway["Home"]?.avg || "—",                    val: d => parseFloat(d.homeaway["Home"]?.avg) || 0,       isAvg: true  },
    { label: "Away AVG",       fmt: d => d.homeaway["Away"]?.avg || "—",                    val: d => parseFloat(d.homeaway["Away"]?.avg) || 0,       isAvg: true  },
    { label: "Day AVG",        fmt: d => d.daynight["Day"]?.avg || "—",                     val: d => parseFloat(d.daynight["Day"]?.avg) || 0,        isAvg: true  },
    { label: "Night AVG",      fmt: d => d.daynight["Night"]?.avg || "—",                   val: d => parseFloat(d.daynight["Night"]?.avg) || 0,      isAvg: true  },
    { label: "xBA",            fmt: d => d.statcast ? `.${Math.round(parseFloat(d.statcast.est_ba)*1000)}` : "—",   val: d => parseFloat(d.statcast?.est_ba) || 0,   isAvg: true,  isSC: true },
    { label: "xSLG",           fmt: d => d.statcast ? `.${Math.round(parseFloat(d.statcast.est_slg)*1000)}` : "—",  val: d => parseFloat(d.statcast?.est_slg) || 0,  isAvg: true,  isSC: true },
    { label: "Barrel %",       fmt: d => d.statcast ? `${parseFloat(d.statcast.brl_percent).toFixed(1)}%` : "—",    val: d => parseFloat(d.statcast?.brl_percent) || 0, isAvg: false, isSC: true },
    { label: "Hard Hit %",     fmt: d => d.statcast ? `${parseFloat(d.statcast.hard_hit_percent).toFixed(0)}%` : "—", val: d => parseFloat(d.statcast?.hard_hit_percent) || 0, isAvg: false, isSC: true },
    { label: "Avg Exit Velo",  fmt: d => d.statcast ? `${parseFloat(d.statcast.avg_exit_velocity).toFixed(1)}` : "—", val: d => parseFloat(d.statcast?.avg_exit_velocity) || 0, isAvg: false, isSC: true },
  ];

  return (
    <div className="side-panel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="side-panel" style={{ width: `min(${160 + players.length * 170}px, 95vw)` }}>
        <div className="side-panel-header">
          <div>
            <div style={{ fontFamily:"var(--font-display)", fontSize:20, fontWeight:800, color:"white" }}>
              Player Comparison
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", marginTop:3 }}>
              {players.length} players · best value highlighted per row
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>

        <div className="side-panel-body" style={{ padding:0, overflowX:"auto" }}>
          <table style={{ fontSize:12, width:"100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", minWidth:120, position:"sticky", left:0, background:"var(--surface-2)", zIndex:1 }}>
                  Metric
                </th>
                {players.map(d => (
                  <th key={d.batter.id} style={{ textAlign:"center", minWidth:150, padding:"14px 10px" }}>
                    <img src={headshot(d.batter.id)} alt=""
                      style={{ width:48, height:48, borderRadius:"50%", objectFit:"cover", background:"var(--surface)", display:"block", margin:"0 auto 6px" }}
                      onError={e => { e.target.style.display = "none"; }} />
                    <div style={{ fontFamily:"var(--font-display)", fontWeight:800, fontSize:13, color:"var(--navy)" }}>
                      {d.batter.name}
                    </div>
                    <div style={{ display:"flex", gap:4, justifyContent:"center", marginTop:4, flexWrap:"wrap" }}>
                      <span style={{ fontSize:9, fontWeight:700, background:"var(--navy)", color:"white", padding:"1px 6px", borderRadius:4 }}>
                        {d.team.abbr}
                      </span>
                      <span className={`badge ${d.isHome ? "badge-navy" : "badge-gray"}`} style={{ fontSize:9 }}>
                        {d.isHome ? "Home" : "Away"}
                      </span>
                      <span className={`badge ${d.oppHand === "L" ? "hand-L" : "hand-R"}`} style={{ fontSize:9 }}>
                        vs {d.oppHand}HP
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric, mi) => {
                const vals    = players.map(d => metric.val(d));
                const maxVal  = Math.max(...vals);
                const hasBest = maxVal > 0;
                // Add section separator before Statcast metrics
                const isFirstSC = metric.isSC && (mi === 0 || !METRICS[mi-1].isSC);
                return (
                  <tr key={metric.label} style={isFirstSC ? { borderTop: "2px solid var(--border)" } : undefined}>
                    <td style={{
                      fontSize:10, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase",
                      color: metric.isSC ? "var(--accent)" : "var(--text-muted)", position:"sticky", left:0,
                      background:"var(--surface)", padding:"10px 14px",
                    }}>
                      {metric.isSC && <span className="material-icons" style={{ fontSize:10, verticalAlign:"middle", marginRight:3 }}>query_stats</span>}
                      {metric.label}
                    </td>
                    {players.map(d => {
                      const display = metric.fmt(d);
                      const val     = metric.val(d);
                      const isBest  = hasBest && val === maxVal && display !== "—";
                      const avgVal  = parseFloat(display);
                      const color   = metric.isAvg && !isNaN(avgVal)
                        ? (avgVal >= 0.300 ? "var(--data-green-light)" : avgVal >= 0.265 ? "var(--data-yellow)" : avgVal >= 0.230 ? "var(--text-primary)" : "var(--data-red)")
                        : (isBest ? "var(--data-green-light)" : "var(--text-secondary)");
                      return (
                        <td key={d.batter.id} style={{ textAlign:"center", background: isBest ? "rgba(21,128,61,0.05)" : undefined }}>
                          <span style={{ fontFamily:"var(--font-mono)", fontSize:14, fontWeight: isBest ? 800 : 400, color }}>
                            {display}
                          </span>
                          {isBest && (
                            <span className="material-icons" style={{ fontSize:10, color:"var(--data-green-light)", marginLeft:3, verticalAlign:"middle" }}>
                              star
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Today's context row */}
              <tr style={{ background:"var(--surface-3)", borderTop:"2px solid var(--border)" }}>
                <td style={{
                  fontSize:10, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase",
                  color:"var(--text-muted)", position:"sticky", left:0,
                  background:"var(--surface-3)", padding:"10px 14px",
                }}>
                  Today's Game
                </td>
                {players.map(d => {
                  const relevantAvg = d.isHome ? d.homeaway["Home"]?.avg : d.homeaway["Away"]?.avg;
                  const dnAvg = d.game.isNight ? d.daynight["Night"]?.avg : d.daynight["Day"]?.avg;
                  const platoonAvg = d.platoon[d.platoonKey]?.avg;
                  return (
                    <td key={d.batter.id} style={{ textAlign:"center", padding:"10px 14px" }}>
                      <div style={{ display:"flex", flexDirection:"column", gap:5, alignItems:"center" }}>
                        <span className={`badge ${d.game.isNight ? "badge-navy" : "badge-accent"}`} style={{ fontSize:9 }}>
                          <span className="material-icons" style={{ fontSize:10 }}>{d.game.isNight ? "nights_stay" : "wb_sunny"}</span>
                          {d.game.isNight ? "Night" : "Day"}
                          {dnAvg ? ` · ${dnAvg}` : ""}
                        </span>
                        {relevantAvg && (
                          <span className={`td-mono ${avgColor(relevantAvg)}`} style={{ fontSize:11, fontWeight:600 }}>
                            {d.isHome ? "Home" : "Away"}: {relevantAvg}
                          </span>
                        )}
                        {platoonAvg && (
                          <span className={`td-mono ${avgColor(platoonAvg)}`} style={{ fontSize:11 }}>
                            vs {d.oppHand}HP: {platoonAvg}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Hit Rate Bar ──────────────────────────────────────────────────────────────
function HitRateBar({ rate }) {
  const color = rate >= 75 ? "var(--data-green-light)" : rate >= 60 ? "var(--accent)" : rate >= 45 ? "var(--data-yellow)" : "var(--data-red)";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ width:52, height:5, background:"var(--border)", borderRadius:100, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${rate}%`, background:color, borderRadius:100 }} />
      </div>
      <span style={{ fontFamily:"var(--font-mono)", fontSize:12, fontWeight:600, color }}>{rate}%</span>
    </div>
  );
}
