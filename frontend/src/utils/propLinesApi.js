// ── DiamondIQ Prop Lines — The Odds API integration ───────────────────────────
// Sign up at https://the-odds-api.com (free tier: 500 req/month)
// Add VITE_ODDS_API_KEY=your_key_here to your .env file to activate live lines
//
// Supported markets: batter_hits, batter_home_runs, batter_total_bases, batter_rbis

const API_KEY   = import.meta.env.VITE_ODDS_API_KEY || "";
const ODDS_BASE = "https://api.the-odds-api.com/v4";

export const HAS_PROP_LINES = !!API_KEY;

// ── Fetch today's MLB event IDs ───────────────────────────────────────────────
let _eventsCache = null;
let _eventsCacheDate = null;

export async function fetchMLBEvents() {
  const today = new Date().toISOString().split("T")[0];
  if (_eventsCache && _eventsCacheDate === today) return _eventsCache;
  if (!API_KEY) return [];
  try {
    const r = await fetch(
      `${ODDS_BASE}/sports/baseball_mlb/events?apiKey=${API_KEY}&dateFormat=iso`
    );
    if (!r.ok) throw new Error(`Odds API ${r.status}`);
    const events = await r.json();
    _eventsCache     = events;
    _eventsCacheDate = today;
    return events;
  } catch (e) { console.warn("PropLines:", e.message); return []; }
}

// ── Fetch hit props for one event ─────────────────────────────────────────────
// market: "batter_hits" | "batter_home_runs" | "batter_total_bases"
const _propCache = {};

export async function fetchEventProps(eventId, market = "batter_hits") {
  const key = `${eventId}::${market}`;
  if (_propCache[key]) return _propCache[key];
  if (!API_KEY) return {};
  try {
    const r = await fetch(
      `${ODDS_BASE}/sports/baseball_mlb/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=${market}&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm`
    );
    if (!r.ok) throw new Error(`Odds API ${r.status}`);
    const data = await r.json();

    // Collapse bookmakers → pick the best (first) available line per player
    const lines = {};
    for (const bm of (data.bookmakers || [])) {
      for (const mkt of (bm.markets || [])) {
        for (const outcome of (mkt.outcomes || [])) {
          const name = outcome.name?.trim();
          if (!name) continue;
          if (!lines[name]) {
            lines[name] = {
              point:     outcome.point,
              over:      null,
              under:     null,
              bookmaker: bm.title,
            };
          }
          if (outcome.description === "Over")  lines[name].over  = outcome.price;
          if (outcome.description === "Under") lines[name].under = outcome.price;
        }
      }
    }
    _propCache[key] = lines;
    return lines;
  } catch (e) { console.warn("PropLines:", e.message); return {}; }
}

// ── Find the best matching event for a given game ─────────────────────────────
// Matches on home team name substring
export function matchEvent(events, homeTeamName) {
  if (!events.length || !homeTeamName) return null;
  const needle = homeTeamName.toLowerCase();
  return events.find(ev =>
    ev.home_team?.toLowerCase().includes(needle) ||
    needle.includes(ev.home_team?.toLowerCase()?.split(" ").slice(-1)[0])
  ) || null;
}

// ── Format odds for display (+130, -160) ─────────────────────────────────────
export function fmtOdds(price) {
  if (price == null) return "—";
  return price > 0 ? `+${price}` : String(price);
}

// ── Find a player's prop line by fuzzy name match ─────────────────────────────
export function findPlayerLine(propMap, playerName) {
  if (!propMap || !playerName) return null;
  const last = playerName.split(" ").slice(-1)[0].toLowerCase();
  const key  = Object.keys(propMap).find(k => k.toLowerCase().includes(last));
  return key ? propMap[key] : null;
}

// ── Game-level moneyline / total odds ─────────────────────────────────────────
const _gameOddsCache = {};
const ODDS_TTL = 10 * 60 * 1000; // 10 min refresh

export async function fetchGameOdds() {
  const today = new Date().toISOString().split("T")[0];
  const ck = `gameodds:${today}`;
  if (_gameOddsCache[ck] && Date.now() - _gameOddsCache[ck].ts < ODDS_TTL) return _gameOddsCache[ck].data;
  if (!API_KEY) return {};
  try {
    const r = await fetch(
      `${ODDS_BASE}/sports/baseball_mlb/odds?apiKey=${API_KEY}&regions=us&markets=h2h,totals&oddsFormat=american&bookmakers=draftkings,fanduel`
    );
    if (!r.ok) throw new Error(`Odds API ${r.status}`);
    const events = await r.json();

    const result = {};
    for (const ev of events) {
      const bm = ev.bookmakers?.[0]; // best available
      if (!bm) continue;
      const h2h = bm.markets?.find(m => m.key === "h2h");
      const totals = bm.markets?.find(m => m.key === "totals");
      result[ev.home_team] = {
        homeML: h2h?.outcomes?.find(o => o.name === ev.home_team)?.price,
        awayML: h2h?.outcomes?.find(o => o.name === ev.away_team)?.price,
        totalOver: totals?.outcomes?.find(o => o.name === "Over")?.price,
        totalUnder: totals?.outcomes?.find(o => o.name === "Under")?.price,
        totalLine: totals?.outcomes?.[0]?.point,
        bookmaker: bm.title,
      };
    }
    _gameOddsCache[ck] = { data: result, ts: Date.now() };
    return result;
  } catch (e) { console.warn("GameOdds:", e.message); return {}; }
}

// ── Remaining API requests (budget tracking) ──────────────────────────────────
export function getRemainingRequests() {
  // The Odds API returns x-requests-remaining header — we store from last call
  return _remainingRequests;
}
let _remainingRequests = null;

