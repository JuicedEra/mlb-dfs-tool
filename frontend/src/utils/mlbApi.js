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
  const d = date || new Date().toISOString().split("T")[0];
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
      games.push({
        gamePk:    g.gamePk,
        gameDate:  g.gameDate,
        status:    g.status?.detailedState,
        venue:     g.venue?.name,
        venueId:   g.venue?.id,
        weather:   g.weather || {},
        isNight:   new Date(g.gameDate).getUTCHours() >= 20, // 4 PM ET = 20 UTC
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
  const data = await mlb(`/teams/${teamId}/roster`, { rosterType: "active", hydrate: "person" });
  const result = (data.roster || [])
    .map(p => ({ id: p.person.id, name: p.person.fullName, position: p.position?.abbreviation, batSide: p.person.batSide?.code || "?" }))
    .filter(p => !["P","SP","RP","CP"].includes(p.position));
  cacheSet(ck, result, TTL.roster);
  return result;
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
    const result = data.stats?.[0]?.splits?.[0]?.stat || {};
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
  "Oakland Coliseum":          { factor: 92,  hr: 88,  type: "pitcher" },
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
export function computeHitScore({ l7, l15, bvp, platoon, parkFactor, seasonAvg, dayNight, isHome, pitcherSeasonAvgAgainst, hasBvP, lineupPos, pitcherDaysRest, weather, venue, statcast }) {
  const norm = (avg, lo=0, hi=0.400) => Math.min(Math.max((parseFloat(avg)||0 - lo)/(hi-lo), 0), 1);
  const pf = (parseFloat(parkFactor)||100);
  const parkScore = Math.min(Math.max((pf - 80)/50, 0), 1);

  // ── Statcast composite (xBA, barrel%, hard hit%) ────────────────────
  // xBA: expected batting avg (0–.400 range, league avg ~.250)
  // barrel%: % of batted balls that are "barrels" (league avg ~6-8%)
  // hard hit%: % of batted balls ≥95mph exit velo (league avg ~35-40%)
  const sc = statcast || {};
  const xba       = parseFloat(sc.est_ba) || 0;
  const barrelPct = parseFloat(sc.brl_percent) || 0;
  const hardHitPct= parseFloat(sc.hard_hit_percent) || 0;
  const hasStatcast = xba > 0;

  // Normalize Statcast metrics to 0-1 scale
  const xbaNorm    = Math.min(Math.max((xba - 0.200) / 0.150, 0), 1);       // .200=0, .350=1
  const barrelNorm = Math.min(Math.max((barrelPct - 3) / 12, 0), 1);         // 3%=0, 15%=1
  const hardHitNorm= Math.min(Math.max((hardHitPct - 25) / 25, 0), 1);      // 25%=0, 50%=1
  const statcastScore = hasStatcast
    ? (xbaNorm * 0.50 + barrelNorm * 0.25 + hardHitNorm * 0.25)
    : 0;

  // ── Scoring weights ─────────────────────────────────────────────────
  let _withBvP, _withoutBvP;

  if (hasStatcast) {
    _withBvP = Math.round(
      norm(l7?.avg)       * 22 +
      norm(l15?.avg)      *  8 +
      norm(bvp?.avg)      * 16 +
      norm(platoon?.avg)  * 14 +
      statcastScore       * 12 +
      parkScore           *  8 +
      norm(seasonAvg)     *  6 +
      norm(dayNight?.avg) *  3 +
      (lineupPos <= 2 ? 2 : lineupPos <= 5 ? 1 : 0) +
      (pitcherDaysRest >= 6 ? 2 : pitcherDaysRest >= 5 ? 1 : 0)
    );
    _withoutBvP = Math.round(
      norm(l7?.avg)                      * 22 +
      norm(l15?.avg)                     *  8 +
      norm(platoon?.avg)                 * 24 +
      statcastScore                      * 14 +
      (1 - norm(pitcherSeasonAvgAgainst))* 10 +
      parkScore                          *  8 +
      norm(seasonAvg)                    *  6 +
      norm(dayNight?.avg)                *  3 +
      (lineupPos <= 2 ? 2 : lineupPos <= 5 ? 1 : 0) +
      (pitcherDaysRest >= 6 ? 2 : pitcherDaysRest >= 5 ? 1 : 0)
    );
  } else {
    _withBvP = Math.round(
      norm(l7?.avg)       * 28 +
      norm(l15?.avg)      * 12 +
      norm(bvp?.avg)      * 20 +
      norm(platoon?.avg)  * 18 +
      parkScore           * 10 +
      norm(seasonAvg)     *  7 +
      norm(dayNight?.avg) *  3 +
      (lineupPos <= 2 ? 2 : lineupPos <= 5 ? 1 : 0)
    );
    _withoutBvP = Math.round(
      norm(l7?.avg)                      * 28 +
      norm(l15?.avg)                     * 12 +
      norm(platoon?.avg)                 * 30 +
      (1 - norm(pitcherSeasonAvgAgainst))* 8 +
      parkScore                          * 10 +
      norm(seasonAvg)                    *  7 +
      norm(dayNight?.avg)                *  3 +
      (lineupPos <= 2 ? 2 : lineupPos <= 5 ? 1 : 0)
    );
  }

  const score = hasBvP ? _withBvP : _withoutBvP;

  // Factor pills (reasons)
  const factors = [];
  if (l7 && parseFloat(l7.avg) >= 0.300) factors.push({ label: `L7: ${l7.avg}`, type: "green", icon: "local_fire_department" });
  else if (l7 && parseFloat(l7.avg) >= 0.260) factors.push({ label: `L7: ${l7.avg}`, type: "yellow", icon: "trending_up" });
  if (bvp && hasBvP && parseFloat(bvp.avg) >= 0.300) factors.push({ label: `BvP: ${bvp.avg}`, type: "green", icon: "sports_baseball" });
  if (platoon && parseFloat(platoon.avg) >= 0.290) factors.push({ label: `Platoon: ${platoon.avg}`, type: "blue", icon: "swap_horiz" });
  if (hasStatcast && xba >= 0.280) factors.push({ label: `xBA: .${Math.round(xba*1000)}`, type: "green", icon: "query_stats" });
  else if (hasStatcast && xba >= 0.250) factors.push({ label: `xBA: .${Math.round(xba*1000)}`, type: "yellow", icon: "query_stats" });
  if (hasStatcast && barrelPct >= 10) factors.push({ label: `Barrel: ${barrelPct.toFixed(1)}%`, type: "green", icon: "bolt" });
  if (hasStatcast && hardHitPct >= 45) factors.push({ label: `HardHit: ${hardHitPct.toFixed(0)}%`, type: "blue", icon: "speed" });
  if (pf >= 108) factors.push({ label: `Park: ${pf}`, type: "green", icon: "stadium" });
  if (!hasBvP) factors.push({ label: "No BvP data", type: "gray", icon: "help_outline" });
  if (!hasStatcast) factors.push({ label: "No Statcast", type: "gray", icon: "query_stats" });
  if (pitcherDaysRest >= 5) factors.push({ label: `${pitcherDaysRest}d rest`, type: "blue", icon: "schedule" });

  // Weather factor pills (informational — does not affect score)
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

  return { score: Math.min(score, 100), withBvP: Math.min(_withBvP,100), withoutBvP: Math.min(_withoutBvP,100), hasBvP, hasStatcast, factors, tier, tierLabel, statcast: hasStatcast ? { xba, barrelPct, hardHitPct } : null };
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
  return { elite: "badge-elite", strong: "badge-strong", solid: "badge-solid", risky: "badge-risky" }[tier] || "badge-gray";
}

export function tierBadgeLabel(tier) {
  return { elite: "🔥 Elite", strong: "✅ Strong", solid: "📊 Solid", risky: "⚠️ Risky" }[tier] || tier;
}
