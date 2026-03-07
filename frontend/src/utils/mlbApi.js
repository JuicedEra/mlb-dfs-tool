// ── StreakLab MLB Data Layer ──────────────────────────────────────────────
// Sources: MLB Stats API (statsapi.mlb.com) + Baseball Savant
// Vercel proxy: /mlb-proxy/* → statsapi.mlb.com/api/v1/*

const MLB_BASE = "/mlb-proxy";   // Vite dev proxy + Vercel rewrite
const SAVANT   = "/savant";       // Vite dev proxy + Vercel rewrite
const SEASON   = new Date().getFullYear();

// ── TTL Cache ─────────────────────────────────────────────────────────────
// In-memory cache with per-key TTLs. Cuts redundant API calls across
// algorithm runs, tab switches, and player panel opens.
const _cache = new Map();

const TTL = {
  schedule:    5  * 60_000,  // 5 min  — games don't change often
  roster:      6  * 3600_000,// 6 hr   — roster moves are rare intra-day
  gamelog:     60 * 60_000,  // 1 hr   — updates after each game
  season:      3  * 3600_000,// 3 hr   — season stats shift slowly
  splits:      3  * 3600_000,// 3 hr   — platoon/HA/DN splits
  bvp:         24 * 3600_000,// 24 hr  — career BvP is very stable
  pitcher:     60 * 60_000,  // 1 hr
  boxscore:    2  * 60_000,  // 2 min  — lineups can post any time pre-game
  livefeed:    2  * 60_000,  // 2 min
  statcast:    6  * 3600_000,// 6 hr   — Savant updates overnight
  search:      60 * 60_000,  // 1 hr
};

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.exp) { _cache.delete(key); return undefined; }
  return entry.data;
}

function cacheSet(key, data, ttl) {
  _cache.set(key, { data, exp: Date.now() + ttl });
  // Evict if cache grows too large (unlikely but safe)
  if (_cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of _cache) { if (now > v.exp) _cache.delete(k); }
  }
}

/** Clear all cached data — useful for forced refresh */
export function clearCache() { _cache.clear(); }

/** Cache stats for debug/UI */
export function cacheStats() {
  let valid = 0, expired = 0;
  const now = Date.now();
  for (const [, v] of _cache) { if (now <= v.exp) valid++; else expired++; }
  return { total: _cache.size, valid, expired };
}

// ── Statcast module-level cache ───────────────────────────────────────────────
let _savantData = null;
let _savantSeason = null;

async function mlb(path, params = {}) {
  const url = new URL(`${window.location.origin}${MLB_BASE}${path}`, window.location.href);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`MLB API ${r.status}: ${path}`);
  return r.json();
}

// ── Schedule ──────────────────────────────────────────────────────────────
export async function fetchGames(date) {
  const d = date || new Date().toLocaleDateString("en-CA");
  const ck = `sched:${d}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const data = await mlb("/schedule", {
    date: d, sportId: 1,
    hydrate: "probablePitcher(note),team,venue,linescore,weather,flags",
  });
  const games = [];
  for (const entry of data.dates || []) {
    for (const g of entry.games || []) {
      // Filter: only spring training (S) and regular season (R/F/D/L/C)
      const gt = g.gameType || "";
      if (!["R","S","F","D","L","C"].includes(gt)) continue;
      // Skip non-MLB teams (WBC national teams have high IDs)
      if (g.teams.home.team.id > 800 || g.teams.away.team.id > 800) continue;
      const detailedState = g.status?.detailedState || "";
      const abstractState = g.status?.abstractGameState || "Preview";
      // Classify game status for UI display
      const isPostponed   = /postponed/i.test(detailedState);
      const isCancelled   = /cancelled|canceled/i.test(detailedState);
      const isRainDelay   = /delay/i.test(detailedState);
      const isSuspended   = /suspend/i.test(detailedState);
      const gameNumber    = g.gameNumber || 1; // 1 or 2 for doubleheaders
      const doubleHeader  = g.doubleHeader || "N"; // "Y", "S", or "N"
      games.push({
        gamePk:       g.gamePk,
        gameDate:     g.gameDate,
        gameType:     gt,
        status:       detailedState,
        abstractState,
        isPostponed, isCancelled, isRainDelay, isSuspended,
        gameNumber,   doubleHeader,
        venue:        g.venue?.name,
        venueId:      g.venue?.id,
        weather:      g.weather || {},
        isNight:      new Date(g.gameDate).getUTCHours() >= 20,
        home: {
          team: g.teams.home.team.name, teamId: g.teams.home.team.id,
          abbr: g.teams.home.team.abbreviation, score: g.teams.home.score,
          pitcher: fmtP(g.teams.home.probablePitcher),
        },
        away: {
          team: g.teams.away.team.name, teamId: g.teams.away.team.id,
          abbr: g.teams.away.team.abbreviation, score: g.teams.away.score,
          pitcher: fmtP(g.teams.away.probablePitcher),
        },
      });
    }
  }
  const result = { games, date: d };
  cacheSet(ck, result, TTL.schedule);
  return result;
}
function fmtP(p) {
  if (!p) return null;
  return { id: p.id, name: p.fullName, hand: p.pitchHand?.code || p.pitchHand?.description?.[0] || null };
}

// Fetch basic person info (for pitcher hand, bat side, height etc)
export async function fetchPersonInfo(personId) {
  const ck = `person:${personId}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/people/${personId}`);
    const p = data.people?.[0];
    if (!p) return null;
    const result = {
      id: p.id, name: p.fullName,
      pitchHand: p.pitchHand?.code || "?",
      batSide: p.batSide?.code || "?",
      position: p.primaryPosition?.abbreviation || "?",
      height: p.height || null,
    };
    cacheSet(ck, result, TTL.roster);
    return result;
  } catch { return null; }
}

// ── Roster ────────────────────────────────────────────────────────────────
export async function fetchRoster(teamId) {
  const ck = `roster:${teamId}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const PITCHER_POS = new Set(["P","SP","RP","CP","TWP"]);
  const parseRoster = (data) => (data.roster || [])
    .map(p => ({ id: p.person.id, name: p.person.fullName, position: p.position?.abbreviation, batSide: p.person.batSide?.code || "?" }))
    .filter(p => !PITCHER_POS.has(p.position));

  // Try active roster first; fall back to fullRoster (spring training 40-man)
  try {
    const data = await mlb(`/teams/${teamId}/roster`, { rosterType: "active", hydrate: "person" });
    const result = parseRoster(data);
    if (result.length >= 5) {
      cacheSet(ck, result, TTL.roster);
      return result;
    }
  } catch { /* fall through */ }

  try {
    const data = await mlb(`/teams/${teamId}/roster`, { rosterType: "fullRoster", hydrate: "person" });
    const result = parseRoster(data);
    cacheSet(ck, result, TTL.roster);
    return result;
  } catch { return []; }
}

// ── Season stats ──────────────────────────────────────────────────────────
export async function fetchSeasonStats(playerId, season = SEASON, gameType) {
  const gt = gameType || "";
  const ck = `season:${playerId}:${season}:${gt}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const params = { stats: "season", group: "hitting", season, sportId: 1 };
    if (gameType) params.gameType = gameType;
    const data = await mlb(`/people/${playerId}/stats`, params);
    const result = data.stats?.[0]?.splits?.[0]?.stat || {};
    cacheSet(ck, result, TTL.season);
    return result;
  } catch { return {}; }
}

// ── Game log → recent splits ──────────────────────────────────────────────
export async function fetchGameLog(playerId, season = SEASON, gameType) {
  const gt = gameType || "";
  const ck = `gl:${playerId}:${season}:${gt}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const params = { stats: "gameLog", group: "hitting", season, sportId: 1 };
    if (gameType) params.gameType = gameType;
    const data = await mlb(`/people/${playerId}/stats`, params);
    const games = [];
    for (const block of data.stats || []) {
      for (const s of block.splits || []) {
        games.push({ date: s.date, opponent: s.opponent?.name, isHome: s.isHome, ...s.stat });
      }
    }
    const result = games.sort((a,b) => b.date.localeCompare(a.date));
    cacheSet(ck, result, TTL.gamelog);
    return result;
  } catch { return []; }
}

export function computeSplit(games, n) {
  const s = games.slice(0, n);
  if (!s.length) return null;
  let ab=0,hits=0,d=0,tr=0,hr=0,rbi=0,bb=0,k=0,pa=0,tb=0;
  for (const g of s) {
    ab  += +g.atBats      || 0;
    hits+= +g.hits        || 0;
    d   += +g.doubles     || 0;
    tr  += +g.triples     || 0;
    hr  += +g.homeRuns    || 0;
    rbi += +g.rbi         || 0;
    bb  += +g.baseOnBalls || 0;
    k   += +g.strikeOuts  || 0;
    pa  += +g.plateAppearances || (+g.atBats||0);
  }
  tb = hits + d + 2*tr + 3*hr;
  const avg = ab ? hits/ab : 0;
  const obp = pa ? (hits+bb)/pa : 0;
  const slg = ab ? tb/ab : 0;
  const gamesWithHit = s.filter(g => +g.hits > 0).length;
  return {
    games: s.length, ab, hits, doubles:d, triples:tr, hr, rbi, bb, k, pa, tb,
    avg: avg.toFixed(3), obp: obp.toFixed(3), slg: slg.toFixed(3),
    ops: (obp+slg).toFixed(3), kPct: pa ? ((k/pa)*100).toFixed(1) : "0.0",
    bbPct: pa ? ((bb/pa)*100).toFixed(1) : "0.0", gamesWithHit,
    hitRate: s.length ? ((gamesWithHit/s.length)*100).toFixed(0) : "0",
  };
}

// ── Active hit streak ─────────────────────────────────────────────────────
export function computeActiveStreak(games) {
  let streak = 0;
  for (const g of games) {
    if (+g.hits > 0) streak++;
    else break;
  }
  return streak;
}

// ── Previous streak length (for bounce-back detection) ───────────────────
// Returns the length of the most recently BROKEN streak.
// games[0] = most recent game (sorted desc by date).
// Pattern: current streak is 0 (L1 was 0-for), then we count the run
// of hit games immediately before that 0-for.
// bounceBack = true only when L1 was 0-for AND prior run was 5+ games.
export function computePreviousStreak(games) {
  if (!games.length) return { prevStreak: 0, bounceBack: false };
  // games[0] must be a 0-for for bounce-back to apply
  if (+games[0]?.hits > 0) return { prevStreak: 0, bounceBack: false };
  // Count the streak that ended with yesterday's 0-for
  let prev = 0;
  for (let i = 1; i < games.length; i++) {
    if (+games[i].hits > 0) prev++;
    else break;
  }
  return { prevStreak: prev, bounceBack: prev >= 5 };
}

// ── Season games with hit (for "Most Games w/ Hit" leaderboard) ───────────
export function computeGamesWithHit(games) {
  return games.filter(g => +g.hits > 0).length;
}

// ── BvP ───────────────────────────────────────────────────────────────────
export async function fetchBvP(batterId, pitcherId) {
  const ck = `bvp:${batterId}:${pitcherId}`;
  const hit = cacheGet(ck);
  if (hit !== undefined) return hit;
  try {
    const data = await mlb(`/people/${batterId}/stats`, { stats: "vsPlayer", group: "hitting", opposingPlayerId: pitcherId, sportId: 1 });
    const result = data.stats?.[0]?.splits?.[0]?.stat || null;
    cacheSet(ck, result, TTL.bvp);
    return result;
  } catch { return null; }
}

// ── Platoon splits ────────────────────────────────────────────────────────
export async function fetchPlatoonSplits(playerId, season = SEASON) {
  const ck = `plat:${playerId}:${season}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/people/${playerId}/stats`, { stats: "statSplits", group: "hitting", season, sportId: 1, sitCodes: "vl,vr" });
    const out = {};
    for (const block of data.stats || []) for (const s of block.splits || []) out[s.split?.description] = s.stat;
    cacheSet(ck, out, TTL.splits);
    return out;
  } catch { return {}; }
}

// ── Home/Away splits ──────────────────────────────────────────────────────
export async function fetchHomeAwaySplits(playerId, season = SEASON) {
  const ck = `ha:${playerId}:${season}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/people/${playerId}/stats`, { stats: "statSplits", group: "hitting", season, sportId: 1, sitCodes: "h,a" });
    const out = {};
    for (const block of data.stats || []) for (const s of block.splits || []) out[s.split?.description] = s.stat;
    cacheSet(ck, out, TTL.splits);
    return out;
  } catch { return {}; }
}

// ── Day/Night splits ──────────────────────────────────────────────────────
export async function fetchDayNightSplits(playerId, season = SEASON) {
  const ck = `dn:${playerId}:${season}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/people/${playerId}/stats`, { stats: "statSplits", group: "hitting", season, sportId: 1, sitCodes: "d,n" });
    const out = {};
    for (const block of data.stats || []) for (const s of block.splits || []) out[s.split?.description] = s.stat;
    cacheSet(ck, out, TTL.splits);
    return out;
  } catch { return {}; }
}

// ── Pitcher stats ─────────────────────────────────────────────────────────
export async function fetchPitcherStats(pitcherId, season = SEASON, gameType) {
  const gt = gameType || "";
  const ck = `pstat:${pitcherId}:${season}:${gt}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const params = { stats: "season", group: "pitching", season, sportId: 1 };
    if (gameType) params.gameType = gameType;
    const data = await mlb(`/people/${pitcherId}/stats`, params);
    const splits = data.stats?.[0]?.splits?.[0]?.stat || {};

    // ── kPct derivation layer ──────────────────────────────────────
    // MLB API has no direct kPct field. Derive it in priority order:
    //   1. strikeOuts / battersFaced  — most accurate (actual rate)
    //   2. strikeoutsPer9Inn / 27     — proxy (~27 BF per 9 IP)
    //   3. null                       — callers handle via ?? fallback
    let kPct = null;
    const so = parseFloat(splits.strikeOuts);
    const bf = parseFloat(splits.battersFaced);
    const k9 = parseFloat(splits.strikeoutsPer9Inn);
    if (bf > 0 && so >= 0) {
      kPct = so / bf;   // e.g. 0.278 = 27.8% K rate (most accurate)
    } else if (k9 > 0) {
      kPct = k9 / 27;   // rough proxy
    }
    // ──────────────────────────────────────────────────────────────

    const result = { ...splits, kPct };  // kPct always present (number | null)
    cacheSet(ck, result, TTL.pitcher);
    return result;
  } catch { return {}; }
}

export async function fetchPitcherGameLog(pitcherId, season = SEASON, gameType) {
  const gt = gameType || "";
  const ck = `pgl:${pitcherId}:${season}:${gt}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const params = { stats: "gameLog", group: "pitching", season, sportId: 1 };
    if (gameType) params.gameType = gameType;
    const data = await mlb(`/people/${pitcherId}/stats`, params);
    const games = [];
    for (const block of data.stats || []) for (const s of block.splits || []) games.push({ date: s.date, opponent: s.opponent?.name, ...s.stat });
    const result = games.sort((a,b) => b.date.localeCompare(a.date));
    cacheSet(ck, result, TTL.pitcher);
    return result;
  } catch { return []; }
}

// ── Lineup order (batting order once posted) ──────────────────────────────
export async function fetchLineupOrder(gamePk) {
  try {
    const data = await mlb(`/game/${gamePk}/boxscore`);
    return {
      home: (data.teams?.home?.battingOrder || []).map(Number),
      away: (data.teams?.away?.battingOrder || []).map(Number),
    };
  } catch { return { home: [], away: [] }; }
}

// ── Live batter stat lines for an in-progress or final game ──────────────────
// Returns { stats: Map<playerId, { hits, totalBases, atBats, rbi }>, status }
// status: "Preview" | "Live" | "Final"
export async function fetchLiveBoxscoreStats(gamePk) {
  const ck = `livebs:${gamePk}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/game/${gamePk}/boxscore`);
    // Status can be nested in different places depending on endpoint version
    const abstract = data.gameData?.status?.abstractGameState
      || data.status?.abstractGameState
      || "Preview";
    const detailed = data.gameData?.status?.detailedState
      || data.status?.detailedState
      || "";

    let resolvedStatus = abstract;
    if (/final|completed|game over/i.test(detailed)) resolvedStatus = "Final";
    else if (/^live|in progress/i.test(detailed))    resolvedStatus = "Live";

    const playerStats = new Map();
    let hasAnyAtBats = false;
    for (const side of ["home", "away"]) {
      const players = data.teams?.[side]?.players || {};
      for (const p of Object.values(players)) {
        const id = p.person?.id;
        const s  = p.stats?.batting;
        if (!id || !s) continue;
        const h  = parseInt(s.hits)     || 0;
        const ab = parseInt(s.atBats)   || 0;
        const d  = parseInt(s.doubles)  || 0;
        const t  = parseInt(s.triples)  || 0;
        const hr = parseInt(s.homeRuns) || 0;
        const tb = h + d + 2*t + 3*hr;
        const rbi= parseInt(s.rbi)      || 0;
        if (ab > 0) hasAnyAtBats = true;
        playerStats.set(id, { name: p.person?.fullName || "", hits: h, atBats: ab, totalBases: tb, rbi });
      }
    }

    // If we have batting data but status still shows "Preview", the game clearly
    // started — mark it at least as Live so the UI shows stats
    if (hasAnyAtBats && resolvedStatus === "Preview") resolvedStatus = "Live";

    const result = { stats: playerStats, status: resolvedStatus };
    cacheSet(ck, result, resolvedStatus === "Live" ? 60_000 : TTL.boxscore);
    return result;
  } catch { return { stats: new Map(), status: "Preview" }; }
}

// ── Confirmed Lineups ─────────────────────────────────────────────────────
// Fetches lineup data from the live feed which has richer status info.
// Returns per-side: { status, players[] } where status is "confirmed"|"expected"|"unknown"
export async function fetchConfirmedLineups(gamePk) {
  const ck = `lineups:${gamePk}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/game/${gamePk}/feed/live`);
    const boxscore = data.liveData?.boxscore;
    const gameStatus = data.gameData?.status?.abstractGameState; // "Preview"|"Live"|"Final"
    const result = { home: { status: "unknown", players: [] }, away: { status: "unknown", players: [] } };

    for (const side of ["home", "away"]) {
      const teamBox = boxscore?.teams?.[side];
      const battingOrder = (teamBox?.battingOrder || []).map(Number);
      const players = teamBox?.players || {};

      if (battingOrder.length >= 9) {
        // We have a full batting order — lineups are confirmed
        result[side].status = "confirmed";
        result[side].players = battingOrder.map((id, idx) => {
          const p = players[`ID${id}`] || {};
          const person = p.person || {};
          const pos = p.allPositions?.[0]?.abbreviation || p.position?.abbreviation || "?";
          return {
            id,
            name: person.fullName || `Player ${id}`,
            position: pos,
            batSide: person.batSide?.code || "?",
            order: idx + 1,
          };
        });
      } else if (gameStatus === "Live" || gameStatus === "Final") {
        // Game started but no batting order array — try to reconstruct from player data
        result[side].status = "confirmed";
        const ordered = Object.values(players)
          .filter(p => p.battingOrder && p.battingOrder !== "0")
          .sort((a, b) => Number(a.battingOrder) - Number(b.battingOrder));
        result[side].players = ordered.map((p, idx) => ({
          id: p.person?.id,
          name: p.person?.fullName || "?",
          position: p.allPositions?.[0]?.abbreviation || p.position?.abbreviation || "?",
          batSide: p.person?.batSide?.code || "?",
          order: idx + 1,
        }));
      }
    }
    cacheSet(ck, result, TTL.livefeed);
    return result;
  } catch {
    return {
      home: { status: "unknown", players: [] },
      away: { status: "unknown", players: [] },
    };
  }
}

// ── Lineup status for a full slate of games ───────────────────────────────
// Returns Map<gamePk, { home: {status, players}, away: {status, players} }>
export async function fetchAllLineups(games) {
  const results = new Map();
  const settled = await Promise.allSettled(
    games.map(async g => {
      const lineups = await fetchConfirmedLineups(g.gamePk);
      return { gamePk: g.gamePk, lineups };
    })
  );
  for (const r of settled) {
    if (r.status === "fulfilled") {
      results.set(r.value.gamePk, r.value.lineups);
    }
  }
  return results;
}

// ── Player search ─────────────────────────────────────────────────────────
export async function searchPlayers(query) {
  if (!query || query.length < 2) return [];
  const ck = `search:${query.toLowerCase()}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb("/people/search", { names: query, sportId: 1, active: true });
    const result = (data.people || []).slice(0,10).map(p => ({
      id: p.id, name: p.fullName,
      position: p.primaryPosition?.abbreviation,
      batSide: p.batSide?.code,
      pitchHand: p.pitchHand?.code,
    }));
    cacheSet(ck, result, TTL.search);
    return result;
  } catch { return []; }
}

// ── Statcast leaderboard (Savant CSV) ────────────────────────────────────
export async function fetchStatcastLeaderboard(season = SEASON) {
  if (_savantData && _savantSeason === season) return _savantData;
  try {
    // Try current season with low min PA first
    const url = `${SAVANT}/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Savant unavailable");
    const text = await r.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      // Fallback to prior year if current season is empty (spring training)
      if (season > 2020) {
        const prev = await fetch(`${SAVANT}/leaderboard/expected_statistics?type=batter&year=${season - 1}&position=&team=&min=50&csv=true`);
        if (prev.ok) {
          const pt = await prev.text();
          const pl = pt.trim().split("\n");
          if (pl.length >= 2) {
            const headers = pl[0].split(",").map(h => h.trim().replace(/"/g,""));
            _savantData = pl.slice(1).map(line => {
              const vals = line.split(",").map(v => v.trim().replace(/"/g,""));
              return Object.fromEntries(headers.map((h,i) => [h, vals[i]]));
            });
            _savantSeason = season;
            return _savantData;
          }
        }
      }
      return [];
    }
    const headers = lines[0].split(",").map(h => h.trim().replace(/"/g,""));
    _savantData = lines.slice(1).map(line => {
      const vals = line.split(",").map(v => v.trim().replace(/"/g,""));
      return Object.fromEntries(headers.map((h,i) => [h, vals[i]]));
    });
    _savantSeason = season;
    return _savantData;
  } catch { return []; }
}

// ── Per-player Statcast lookup (uses cached leaderboard) ─────────────────────
export async function fetchStatcastForPlayer(playerId, season = SEASON) {
  let result = null;
  const all = await fetchStatcastLeaderboard(season);
  result = all.find(p => p.player_id === String(playerId)) || null;
  // Fallback to prior year if no current Statcast data
  if (!result && season > 2020) {
    const prev = await fetchStatcastLeaderboard(season - 1);
    result = prev.find(p => p.player_id === String(playerId)) || null;
  }
  return result;
}

// ── Hot player flag ───────────────────────────────────────────────────────────
export function isPlayerHot(streak, l7Avg, score) {
  // Must have a strong score AND either a real streak or elite recent avg
  const s = parseInt(score) || 0;
  if (s < 60) return false; // never show fire below Strong tier
  return streak >= 5 || (parseFloat(l7Avg || 0) >= 0.350 && s >= 65);
}

// ── MLB headshot URL ──────────────────────────────────────────────────────────
export function headshot(playerId) {
  if (!playerId) return "";
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

// ── Park factor lookup (static 5yr normalized) ───────────────────────────
export const PARK_FACTORS = {
  "Coors Field":               { factor: 121, hr: 118, type: "hitter" },
  "Great American Ball Park":  { factor: 112, hr: 115, type: "hitter" },
  "Fenway Park":               { factor: 110, hr: 99,  type: "hitter" },
  "Wrigley Field":             { factor: 108, hr: 111, type: "hitter" },
  "Globe Life Field":          { factor: 107, hr: 108, type: "hitter" },
  "American Family Field":     { factor: 106, hr: 110, type: "hitter" },
  "Yankee Stadium":            { factor: 105, hr: 118, type: "hitter" },
  "Camden Yards":              { factor: 105, hr: 112, type: "hitter" },
  "Rogers Centre":             { factor: 104, hr: 107, type: "hitter" },
  "Angel Stadium":             { factor: 104, hr: 106, type: "hitter" },
  "Citizens Bank Park":        { factor: 104, hr: 110, type: "hitter" },
  "Guaranteed Rate Field":     { factor: 103, hr: 109, type: "hitter" },
  "Truist Park":               { factor: 103, hr: 105, type: "hitter" },
  "Progressive Field":         { factor: 102, hr: 101, type: "neutral" },
  "Nationals Park":            { factor: 99,  hr: 103, type: "neutral" },
  "Minute Maid Park":          { factor: 99,  hr: 100, type: "neutral" },
  "Chase Field":               { factor: 99,  hr: 101, type: "neutral" },
  "loanDepot Park":            { factor: 100, hr: 97,  type: "neutral" },
  "Target Field":              { factor: 97,  hr: 102, type: "pitcher" },
  "Busch Stadium":             { factor: 96,  hr: 93,  type: "pitcher" },
  "PNC Park":                  { factor: 97,  hr: 97,  type: "pitcher" },
  "Kauffman Stadium":          { factor: 96,  hr: 95,  type: "pitcher" },
  "Citi Field":                { factor: 95,  hr: 92,  type: "pitcher" },
  "Tropicana Field":           { factor: 95,  hr: 92,  type: "pitcher" },
  "T-Mobile Park":             { factor: 97,  hr: 95,  type: "pitcher" },
  "Dodger Stadium":            { factor: 96,  hr: 94,  type: "pitcher" },
  "Oracle Park":               { factor: 94,  hr: 87,  type: "pitcher" },
  "Petco Park":                { factor: 93,  hr: 91,  type: "pitcher" },
  "Sutter Health Park":        { factor: 98,  hr: 97,  type: "neutral" },  // Sacramento A's (2025–)
  "Comerica Park":             { factor: 92,  hr: 88,  type: "pitcher" },
};

// ── ABS Challenge Data ────────────────────────────────────────────────────
// Parses play-by-play from the live feed to extract challenged pitches.
// Each pitch has pX/pZ coordinates and strikeZoneTop/Bottom for visualization.
// In 2026, MLB will surface explicit ABS challenge events; for now we use
// hasReview + reviewDetails on pitch plays, plus description text matching.

const PLATE_WIDTH_FT = 17 / 12; // 17 inches in feet
const BALL_RADIUS_FT = 1.457 / 12; // baseball radius ~1.457 inches

export async function fetchABSChallenges(gamePk) {
  const ck = `abs:${gamePk}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await mlb(`/game/${gamePk}/feed/live`);
    const plays = data.liveData?.plays?.allPlays || [];
    const gameData = data.gameData || {};
    const challenges = [];

    // Extract home plate umpire
    const officials = data.liveData?.boxscore?.officials || [];
    const hpUmp = officials.find(o => o.officialType === "Home Plate");
    const umpire = hpUmp ? { id: hpUmp.official?.id, name: hpUmp.official?.fullName || "?" } : { id: null, name: "?" };

    for (const play of plays) {
      const batter = play.matchup?.batter || {};
      const pitcher = play.matchup?.pitcher || {};
      const batSide = play.matchup?.batSide?.code || "?";
      const pitchHand = play.matchup?.pitchHand?.code || "?";

      for (const evt of (play.playEvents || [])) {
        if (!evt.isPitch) continue;
        const details = evt.details || {};
        const pitchData = evt.pitchData || {};
        const coords = pitchData.coordinates || {};

        // Detect challenges: hasReview flag, or description containing "challenge"
        const isChallenge = details.hasReview === true
          || /challenge/i.test(details.description || "")
          || /challenge/i.test(details.call?.description || "")
          || (evt.reviewDetails && Object.keys(evt.reviewDetails).length > 0);

        if (!isChallenge) continue;

        const pX = coords.pX; // feet from center of plate (catcher view)
        const pZ = coords.pZ; // feet above ground
        const szTop = pitchData.strikeZoneTop;
        const szBot = pitchData.strikeZoneBottom;
        const originalCall = details.call?.description || details.description || "Unknown";
        const isOriginalStrike = details.isStrike || /strike/i.test(originalCall);

        // Determine challenge result from reviewDetails or description
        const reviewDesc = (evt.reviewDetails?.challengeResult || evt.reviewDetails?.description || "").toLowerCase();
        let challengeResult = "unknown";
        if (/overturn/i.test(reviewDesc) || /overturned/i.test(details.description || "")) challengeResult = "overturned";
        else if (/upheld|confirm|stands/i.test(reviewDesc) || /upheld|confirmed/i.test(details.description || "")) challengeResult = "upheld";

        // Calculate distance from strike zone edge
        let distFromZone = null;
        if (pX != null && pZ != null && szTop != null && szBot != null) {
          const halfPlate = PLATE_WIDTH_FT / 2;
          const dLeft  = Math.max(0, -halfPlate - pX);   // past left edge
          const dRight = Math.max(0, pX - halfPlate);     // past right edge
          const dTop   = Math.max(0, pZ - szTop);         // above zone
          const dBot   = Math.max(0, szBot - pZ);         // below zone
          const outsideH = Math.max(dLeft, dRight);
          const outsideV = Math.max(dTop, dBot);
          // If outside zone, distance is the Euclidean distance to nearest zone edge
          if (outsideH > 0 || outsideV > 0) {
            distFromZone = Math.sqrt(outsideH ** 2 + outsideV ** 2);
          } else {
            // Inside zone: negative distance = how far inside (min dist to any edge)
            distFromZone = -Math.min(halfPlate - Math.abs(pX), pZ - szBot, szTop - pZ);
          }
        }

        // Determine who challenged (heuristic: if original was strike → batter challenged; if ball → defense)
        const challengerSide = isOriginalStrike ? "offense" : "defense";

        challenges.push({
          inning: play.about?.inning,
          halfInning: play.about?.halfInning,
          pitchNumber: evt.pitchNumber,
          count: evt.count,
          batter: { id: batter.id, name: batter.fullName || "?" },
          pitcher: { id: pitcher.id, name: pitcher.fullName || "?" },
          umpire,
          batSide, pitchHand,
          pitchType: details.type?.description || details.type?.code || "?",
          speed: pitchData.startSpeed,
          pX, pZ, szTop, szBot,
          originalCall,
          isOriginalStrike,
          challengeResult,
          challengerSide,
          distFromZone: distFromZone != null ? Math.round(distFromZone * 100) / 100 : null,
          playId: evt.playId,
        });
      }
    }

    const result = {
      gamePk,
      home: gameData.teams?.home?.name || "?",
      homeAbbr: gameData.teams?.home?.abbreviation || "?",
      away: gameData.teams?.away?.name || "?",
      awayAbbr: gameData.teams?.away?.abbreviation || "?",
      venue: gameData.venue?.name || "?",
      status: gameData.status?.detailedState || "?",
      umpire,
      challenges,
    };
    cacheSet(ck, result, TTL.livefeed);
    return result;
  } catch { return { gamePk, challenges: [] }; }
}

// Fetch ABS data for all games on a date
export async function fetchABSForDate(date) {
  const { games } = await fetchGames(date);
  const results = await Promise.allSettled(
    games.map(g => fetchABSChallenges(g.gamePk))
  );
  return results
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => r.value);
}

// ── HIT SCORE ALGORITHM ──────────────────────────────────────────────────
// Weights based on user priority ranking
// Returns: { score, withBvP, withoutBvP, factors }
export function computeHitScore({ l1, l3, l7, l14, l15, l30, bvp, platoon, parkFactor, seasonAvg, seasonStats, dayNight, isHome, pitcherSeasonAvgAgainst, pitcherStats, hasBvP, lineupPos, pitcherDaysRest, weather, venue, statcast, seasonGwH, seasonGames, activeStreak, prevStreak }) {
  // ── Normalization helpers ────────────────────────────────────────────
  const norm = (avg, lo=0, hi=0.400) => Math.min(Math.max((parseFloat(avg)||0 - lo)/(hi-lo), 0), 1);
  const clamp = (v, lo=0, hi=1) => Math.min(Math.max(v, lo), hi);

  // ── Parse all inputs ────────────────────────────────────────────────
  const pf = parseFloat(parkFactor) || 100;
  const parkScore = clamp((pf - 85) / 35); // 85=0, 120=1

  const sc = statcast || {};
  const xba       = parseFloat(sc.est_ba) || 0;
  const barrelPct = parseFloat(sc.brl_percent) || 0;
  const hardHitPct= parseFloat(sc.hard_hit_percent) || 0;
  const hasStatcast = xba > 0;

  // Season stats for K%, BABIP
  const ss = seasonStats || {};
  const seasonK   = parseInt(ss.strikeOuts) || 0;
  const seasonPA  = parseInt(ss.plateAppearances) || parseInt(ss.atBats) || 0;
  const seasonAB  = parseInt(ss.atBats) || 0;
  const seasonH   = parseInt(ss.hits) || 0;
  const seasonHR  = parseInt(ss.homeRuns) || 0;
  const seasonSF  = parseInt(ss.sacFlies) || 0;
  const kPct = seasonPA > 0 ? seasonK / seasonPA : 0.22; // league avg ~22%
  const babipDenom = seasonAB - seasonK - seasonHR + seasonSF;
  const babip = babipDenom > 0 ? (seasonH - seasonHR) / babipDenom : 0.300;

  // Pitcher stats for hittability cross-reference
  const ps = pitcherStats || {};
  const pitAvg  = parseFloat(ps.avg) || 0.250;
  const pitEra  = parseFloat(ps.era) || 4.00;
  const pitWhip = parseFloat(ps.whip) || 1.30;
  const pitK9   = parseFloat(ps.strikeoutsPer9Inn) || 7.0;
  const pitIP   = parseFloat(ps.inningsPitched) || 0;
  // Regress pitcher stats to league avg based on sample size
  const pitSW = clamp(pitIP / 30);
  const rPitAvg  = pitAvg * pitSW + 0.250 * (1 - pitSW);
  const rPitWhip = pitWhip * pitSW + 1.30 * (1 - pitSW);

  // BvP sample quality
  const bvpAB = parseInt(bvp?.atBats) || 0;
  const bvpReliable = hasBvP && bvpAB >= 10;
  const bvpSomewhat = hasBvP && bvpAB >= 5;

  // L1/L3/L7/L14/L30 availability
  const l3avg   = parseFloat(l3?.avg)  || 0;
  const l1hits  = parseInt(l1?.hits)   || 0;
  const l7avg   = parseFloat(l7?.avg)  || 0;
  const l7gwh   = parseInt(l7?.gamesWithHit) || 0;
  const l7games = parseInt(l7?.games)  || 0;
  const l14avg  = parseFloat(l14?.avg) || 0;
  const l30avg  = parseFloat(l30?.avg) || 0;

  // Season games with hit — consistency across full season
  // seasonGwH = count of games with ≥1 hit, seasonGames = total games played
  const sGwH    = parseInt(seasonGwH)   || 0;
  const sGames  = parseInt(seasonGames) || 0;
  const seasonHitRate = sGames > 0 ? sGwH / sGames : 0.61; // league avg ~61%

  // Whiff% (batter) — from Statcast whiff_percent field
  // League avg ~24%. Elite contact: <15%. High swing-and-miss: >30%
  const whiffPct = parseFloat(sc.whiff_percent) || 24; // default to league avg if missing

  // PA Probability — estimated likelihood of reaching 4+ plate appearances
  // Derived from lineup position × pitcher WHIP (controls lineup cycling speed)
  // Higher WHIP → faster cycling → more PA for all batters
  // Base PA/game by lineup slot, then WHIP-adjusted
  const basePABySlot = lineupPos <= 2 ? 4.3 : lineupPos <= 4 ? 4.0 : lineupPos <= 6 ? 3.7 : lineupPos <= 8 ? 3.4 : 3.1;
  const whipAdj      = clamp((rPitWhip - 1.00) / 0.80) * 0.3; // 0 at WHIP 1.0, +0.3 at WHIP 1.8
  const estPA        = basePABySlot + whipAdj;
  // Convert to probability of getting 4+ PA (sigmoid-style, centered at ~3.8 PA)
  const paProbability = clamp((estPA - 2.8) / 2.2); // 2.8 PA → 0, 5.0 PA → 1

  // ═══════════════════════════════════════════════════════════════════
  // V4 ALGORITHM — Contact-first, PA-probability-weighted, streak-aware
  // Total: 100 points across 5 tiers (streak/bounce-back bonus ≤5 pts additive)
  // New vs V3: Streak day modifier (0–3), Bounce-back (3–5), Signed L1 (−1/0/+2)
  // ═══════════════════════════════════════════════════════════════════

  // ── TIER 1: CONTACT & OPPORTUNITY (38 pts) ──────────────────────
  // Core predictor: can the batter make contact, get PA volume, and turn it into hits?

  // K% inverse (12 pts) — low K% = more balls in play = more hit chances
  // League avg K% ~22%. Elite contact: <12%. Poor: >30%
  const kScore = clamp(1 - (kPct / 0.35)) * 12;

  // Whiff% inverse (5 pts) — swing-and-miss rate, tighter signal than K%
  // League avg ~24%. Elite: <15% (full 5 pts). High: >35% (0 pts).
  // Whiff% penalizes batters who miss the ball even when they swing — K% penalizes outcomes.
  // Together they capture both ends of contact quality.
  const whiffScore = clamp(1 - ((whiffPct - 10) / 30)) * 5; // 10%=5pts, 40%=0pts

  // Lineup position (10 pts) — more PA = more chances
  // 1st-2nd: ~4.5 PA/g, 3rd-5th: ~4.0, 6th-7th: ~3.5, 8th-9th: ~3.2
  const lpScore = lineupPos <= 2 ? 10 : lineupPos <= 5 ? 7 : lineupPos <= 7 ? 4 : lineupPos <= 9 ? 2 : 1;

  // Away team top-5 bonus (2 pts) — guaranteed to bat in 9th inning
  const awayBonus = (!isHome && lineupPos <= 5) ? 2 : 0;

  // BABIP (6 pts) — ability to turn contact into hits (league avg .300)
  const babipScore = clamp((babip - 0.240) / 0.120) * 6; // .240=0, .360=1

  // PA Probability (8 pts) — estimated likelihood of reaching 4+ plate appearances
  // Derived from lineup slot + opponent WHIP. Higher WHIP = faster cycling = more PA.
  const paScore = paProbability * 8;

  const contactTier = kScore + whiffScore + lpScore + awayBonus + babipScore + paScore;

  // ── TIER 2: RECENT FORM (27 pts) ───────────────────────────────
  // Hot hand is real in baseball — multi-window momentum + streak state

  // L7 AVG (10 pts) — primary recent signal
  const l7Score = norm(l7?.avg) * 10;

  // L3 AVG (4 pts) — immediate form
  const l3Score = norm(l3?.avg) * 4;

  // L14 AVG (1 pt) — bridge between hot and sustained
  const l14Score = norm(l14?.avg) * 1;

  // L30 AVG (1 pt) — sustained trend baseline
  const l30Score = norm(l30?.avg) * 1;

  // ── L1: Signed signal — hit=+2, cold 0-for=−1, bounce-back 0-for=0 (handled below)
  // Bounce-back takes priority: if prevStreak>=5 and L1 was 0-for, skip the penalty.
  const isBounceBack = (prevStreak || 0) >= 5 && l1hits === 0;
  const l1Score = isBounceBack ? 0           // bounce-back overrides — no penalty
    : l1hits > 0              ? 2            // hit yesterday: positive signal
    : -1;                                    // 0-for yesterday: mild penalty

  // Games with hit / last 7 (3 pts) — consistency in recent window
  const gwhScore = l7games > 0 ? (l7gwh / l7games) * 3 : 0;

  // Season games with hit rate (3 pts) — full-season consistency baseline
  // League avg ~61%. Elite: >72%. Poor: <50%.
  const seasonGwhScore = clamp((seasonHitRate - 0.45) / 0.35) * 3; // 45%=0, 80%=3pts

  // ── STREAK DAY MODIFIER (max 3 pts) ─────────────────────────────
  // Based on Retrosheet/Statcast research: hit rates peak at streak days 5-8,
  // remain elevated through 15, then variance dominates above 20.
  // Gating on L7 avg prevents crediting fluky/weak-contact streaks.
  const str = activeStreak || 0;
  let streakBonus = 0;
  if (str >= 20 && l7avg >= 0.280) {
    streakBonus = 0.5; // 20+d: small bonus, only if still genuinely hitting well
  } else if (str >= 9 && str <= 19) {
    streakBonus = l7avg >= 0.250 ? 1.5 : 0.5; // 9-15d: meaningful but tapering; gated
  } else if (str >= 5 && str <= 8) {
    streakBonus = 3; // 5-8d: peak zone — cleanest signal, no gate needed
  }

  // ── BOUNCE-BACK MODIFIER (max 5 pts, scaled by prior streak length) ──────
  // After breaking a streak of 5+ games, next-game hit rates are meaningfully
  // elevated vs baseline. Effect scales with how long the streak was.
  // prevStreak = length of the streak broken by yesterday's 0-for.
  // Research basis: Retrosheet multi-decade analysis of post-streak 0-for games.
  let bounceBackBonus = 0;
  if (isBounceBack) {
    if ((prevStreak || 0) >= 15)      bounceBackBonus = 5;   // 75-78% hit rate documented
    else if ((prevStreak || 0) >= 10) bounceBackBonus = 4;   // 71-73% hit rate
    else if ((prevStreak || 0) >= 5)  bounceBackBonus = 3;   // 67-69% hit rate
  }

  // Cap combined streak modifier + bounce-back at 5 pts to prevent double inflation.
  // They can't both fire simultaneously (streak>0 means not in bounce-back state)
  // but the cap protects against edge cases (e.g. streak=0, large prevStreak).
  const streakTotalBonus = Math.min(streakBonus + bounceBackBonus, 5);

  const formTier = l7Score + l3Score + l14Score + l30Score + l1Score + gwhScore + seasonGwhScore + streakTotalBonus;

  // ── TIER 3: MATCHUP QUALITY (24 pts) ───────────────────────────
  // Who are they facing? How good is the matchup?

  // Platoon advantage (7 pts)
  const platScore = norm(platoon?.avg) * 7;

  // BvP (5 pts max, scaled by sample reliability)
  const bvpScore = bvpReliable
    ? norm(bvp?.avg) * 5
    : bvpSomewhat ? norm(bvp?.avg) * 3 : 0;

  // Pitcher hittability (9 pts) — AVG against, WHIP, K/9
  const pitAvgScore   = clamp((rPitAvg  - 0.200) / 0.120) * 3.5;  // .200=0, .320=1
  const pitWhipScore  = clamp((rPitWhip - 1.00)  / 0.60)  * 2.5;  // 1.00=0, 1.60=1
  const pitK9Score    = clamp(1 - (pitK9 / 14))            * 3;    // 14K/9=0, low=3
  const pitcherScore  = pitAvgScore + pitWhipScore + pitK9Score;

  // Pitcher days rest bonus (2 pts) — rusty pitchers give up more hits
  const restScore = pitcherDaysRest >= 7 ? 2 : pitcherDaysRest >= 5 ? 1 : 0;

  const matchupTier = platScore + bvpScore + pitcherScore + restScore;

  // ── TIER 4: STATCAST / TRUE TALENT (9 pts) ─────────────────────
  // Quality of contact metrics — predictive of future performance

  const xbaScore      = hasStatcast ? clamp((xba        - 0.200) / 0.150) * 3.5 : 0;
  const hardHitScore  = hasStatcast ? clamp((hardHitPct - 25)    / 25)    * 3   : 0;
  const barrelScore   = hasStatcast ? clamp((barrelPct  - 3)     / 12)    * 2.5 : 0;

  // If no Statcast, fall back to season AVG as true talent (3 pts)
  const talentFallback = !hasStatcast ? norm(seasonAvg) * 3 : 0;

  const statcastTier = xbaScore + hardHitScore + barrelScore + talentFallback;

  // ── TIER 5: ENVIRONMENT (4 pts) ────────────────────────────────
  const envPark = parkScore * 2.5;
  const envDN   = norm(dayNight?.avg) * 1.5;
  const envTier = envPark + envDN;

  // ═══════════════════════════════════════════════════════════════════
  // TOTAL SCORE
  // ═══════════════════════════════════════════════════════════════════
  const rawScore = contactTier + formTier + matchupTier + statcastTier + envTier;
  const _withBvP = Math.round(Math.min(rawScore, 100));

  // Without BvP: redistribute those 5 pts to platoon, pitcher, and season GwH
  const _withoutBvP = Math.round(Math.min(
    contactTier + formTier +
    (platScore * 1.3 + pitcherScore * 1.2 + restScore + seasonGwhScore * 1.1) +
    statcastTier + envTier,
    100
  ));

  const score = hasBvP ? _withBvP : _withoutBvP;

  // ── Factor pills (explanations) ─────────────────────────────────
  const factors = [];

  // Contact factors
  if (kPct > 0 && kPct < 0.14) factors.push({ label: `K%: ${(kPct*100).toFixed(0)}% (elite)`, type: "green", icon: "sports_baseball" });
  else if (kPct > 0.28) factors.push({ label: `K%: ${(kPct*100).toFixed(0)}% (high)`, type: "red", icon: "warning" });
  if (whiffPct < 15) factors.push({ label: `Whiff: ${whiffPct.toFixed(0)}% (elite)`, type: "green", icon: "sports_baseball" });
  else if (whiffPct > 30) factors.push({ label: `Whiff: ${whiffPct.toFixed(0)}% (high)`, type: "red", icon: "warning" });
  if (babip >= 0.330) factors.push({ label: `BABIP: .${Math.round(babip*1000)}`, type: "green", icon: "query_stats" });
  if (lineupPos <= 2) factors.push({ label: `Lineup: #${lineupPos}`, type: "green", icon: "looks_one" });
  else if (lineupPos <= 5) factors.push({ label: `Lineup: #${lineupPos}`, type: "blue", icon: "format_list_numbered" });
  if (paProbability >= 0.75) factors.push({ label: `PA Prob: ${Math.round(paProbability*100)}%`, type: "green", icon: "repeat" });
  else if (paProbability < 0.45) factors.push({ label: `PA Prob: ${Math.round(paProbability*100)}%`, type: "red", icon: "repeat" });

  // Form factors
  if (l7avg >= 0.350) factors.push({ label: `L7: ${l7?.avg}`, type: "green", icon: "local_fire_department" });
  else if (l7avg >= 0.280) factors.push({ label: `L7: ${l7?.avg}`, type: "yellow", icon: "trending_up" });
  if (l3avg >= 0.400) factors.push({ label: `L3: ${l3?.avg}`, type: "green", icon: "bolt" });
  if (l14avg >= 0.300) factors.push({ label: `L14: ${l14?.avg}`, type: "blue", icon: "trending_up" });
  if (l30avg >= 0.290) factors.push({ label: `L30: ${l30?.avg}`, type: "blue", icon: "show_chart" });
  // L1 signed signal
  if (l1hits >= 2) factors.push({ label: `${l1hits}H yesterday`, type: "green", icon: "history" });
  else if (l1hits === 1) factors.push({ label: "Hit yesterday", type: "blue", icon: "history" });
  else if (!isBounceBack) factors.push({ label: "0-for yesterday", type: "red", icon: "history" });
  // Streak modifier pills
  if (str >= 20 && streakBonus > 0) factors.push({ label: `${str}G streak 🔥`, type: "green", icon: "local_fire_department" });
  else if (str >= 9) factors.push({ label: `${str}G streak`, type: "green", icon: "trending_up" });
  else if (str >= 5) factors.push({ label: `${str}G streak ⚡`, type: "green", icon: "bolt" });
  // Bounce-back pill — most important surface
  if (isBounceBack) {
    const bbLabel = prevStreak >= 15 ? `Bounce-Back (broke ${prevStreak}G) 🎯`
      : prevStreak >= 10 ? `Bounce-Back (broke ${prevStreak}G)`
      : `Bounce-Back (broke ${prevStreak}G)`;
    factors.push({ label: bbLabel, type: "green", icon: "replay" });
  }
  if (seasonHitRate >= 0.70) factors.push({ label: `Hit ${Math.round(seasonHitRate*100)}% of starts`, type: "green", icon: "bar_chart" });

  // Matchup factors
  if (hasBvP && parseFloat(bvp?.avg) >= 0.300) factors.push({ label: `BvP: ${bvp.avg}`, type: "green", icon: "sports_baseball" });
  if (platoon && parseFloat(platoon.avg) >= 0.290) factors.push({ label: `Platoon: ${platoon.avg}`, type: "blue", icon: "swap_horiz" });
  if (rPitAvg >= 0.280) factors.push({ label: `vs hittable SP`, type: "green", icon: "trending_up" });
  if (pitcherDaysRest >= 6) factors.push({ label: `${pitcherDaysRest}d rest`, type: "blue", icon: "schedule" });

  // Statcast factors
  if (hasStatcast && xba >= 0.280) factors.push({ label: `xBA: .${Math.round(xba*1000)}`, type: "green", icon: "query_stats" });
  else if (hasStatcast && xba >= 0.250) factors.push({ label: `xBA: .${Math.round(xba*1000)}`, type: "yellow", icon: "query_stats" });
  if (hasStatcast && barrelPct >= 10) factors.push({ label: `Barrel: ${barrelPct.toFixed(1)}%`, type: "green", icon: "bolt" });
  if (hasStatcast && hardHitPct >= 45) factors.push({ label: `HardHit: ${hardHitPct.toFixed(0)}%`, type: "blue", icon: "speed" });

  // Environment factors
  if (pf >= 108) factors.push({ label: `Park: ${pf}`, type: "green", icon: "stadium" });
  if (!hasBvP) factors.push({ label: "No BvP data", type: "gray", icon: "help_outline" });
  if (!hasStatcast) factors.push({ label: "Est. (no Statcast)", type: "gray", icon: "query_stats" });

  // Weather pills (informational)
  if (weather && venue) {
    const DOMES = ["Tropicana Field","loanDepot Park","Minute Maid Park","Globe Life Field","Rogers Centre","Chase Field","T-Mobile Park","American Family Field"];
    if (!DOMES.includes(venue)) {
      const windStr = weather.wind || "";
      const windMph = parseInt(windStr);
      if (windMph >= 15 && /out/i.test(windStr)) factors.push({ label: `Wind Out ${windMph}mph`, type: "green", icon: "air" });
      else if (windMph >= 15 && /in/i.test(windStr)) factors.push({ label: `Wind In ${windMph}mph`, type: "red", icon: "air" });
      const tempNum = parseInt(weather.temp);
      if (tempNum >= 90) factors.push({ label: `${tempNum}°F`, type: "yellow", icon: "thermostat" });
      else if (tempNum && tempNum <= 50) factors.push({ label: `${tempNum}°F Cold`, type: "gray", icon: "ac_unit" });
    }
  }

  const tier = score >= 75 ? "elite" : score >= 60 ? "strong" : score >= 45 ? "solid" : "risky";
  const tierLabel = score >= 75 ? "Elite" : score >= 60 ? "Strong" : score >= 45 ? "Solid" : "Risky";

  return {
    score: Math.min(score, 100), withBvP: Math.min(_withBvP,100), withoutBvP: Math.min(_withoutBvP,100),
    hasBvP, hasStatcast, factors, tier, tierLabel,
    statcast: hasStatcast ? { xba, barrelPct, hardHitPct } : null,
    // Debug: tier breakdown for tooltip
    breakdown: {
      contact: Math.round(contactTier), form: Math.round(formTier),
      matchup: Math.round(matchupTier), statcast: Math.round(statcastTier), env: Math.round(envTier),
      // V4 sub-signals
      whiffPct: whiffPct.toFixed(0), paProbPct: Math.round(paProbability*100),
      l14avg: l14?.avg || "—", l30avg: l30?.avg || "—",
      seasonHitRatePct: Math.round(seasonHitRate*100),
      activeStreak: str, streakBonus: streakBonus.toFixed(1),
      prevStreak: prevStreak || 0, bounceBackBonus: bounceBackBonus.toFixed(1),
    },
  };
}

// ── Color helpers ─────────────────────────────────────────────────────────
export function avgColor(val) {
  const v = parseFloat(val);
  if (v >= 0.300) return "hot";
  if (v >= 0.265) return "warm";
  if (v >= 0.230) return "neutral";
  return "cold";
}

export function scoreColor(score) {
  if (score >= 75) return "var(--yellow)";
  if (score >= 60) return "var(--green-light)";
  if (score >= 45) return "var(--blue-data)";
  return "var(--text-muted)";
}

export function tierClass(tier) {
  switch (tier?.toLowerCase()) {
    case "elite":  return "badge-elite";
    case "strong": return "badge-strong";
    case "solid":  return "badge-solid";
    case "watch":  return "badge-watch";  // 57K native tier
    case "risky":  return "badge-risky";  // IQ algo tier
    default:       return "badge-gray";
  }
}

export function tierBadgeLabel(tier) {
  switch (tier?.toLowerCase()) {
    case "elite":  return "🔥 Elite";
    case "strong": return "✅ Strong";
    case "solid":  return "📊 Solid";
    case "watch":  return "👁️ Watch";   // 57K tier — distinct from Risky
    case "risky":  return "⚠️ Risky";   // IQ tier
    default:       return tier || "—";
  }
}
