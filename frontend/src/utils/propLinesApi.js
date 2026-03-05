// ── DiamondIQ Prop Lines ──────────────────────────────────────────────────────
// Calls /api/odds (our Vercel serverless proxy) instead of The Odds API directly.
// This means 100 users loading the page = ~1 upstream API call, not 100.
//
// To activate: add ODDS_API_KEY to your Vercel environment variables.
// (No .env file needed on the frontend — the key lives server-side only.)
//
// The proxy caches: events 15 min · props 10 min · game odds 10 min

const PROXY = "/api/odds";

// HAS_PROP_LINES starts true and flips false if the server reports no key.
export let HAS_PROP_LINES = true;

// ── Internal fetch helper ─────────────────────────────────────────────────────
async function oddsProxy(params) {
  const url = new URL(PROXY, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  const json = await r.json();
  if (r.status === 503) {
    // Server says no API key configured
    HAS_PROP_LINES = false;
    return null;
  }
  if (!r.ok) throw new Error(json.error || `Proxy ${r.status}`);
  HAS_PROP_LINES = true;
  return json.data;
}

// ── Client-side cache ─────────────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(key); return null; }
  return e.data;
}
function cacheSet(key, data, ttlMs) { _cache.set(key, { data, exp: Date.now() + ttlMs }); }
const TTL = { events: 15 * 60_000, props: 10 * 60_000, game: 10 * 60_000 };

// ── Fetch today's MLB event IDs ───────────────────────────────────────────────
export async function fetchMLBEvents() {
  const ck = `events:${new Date().toLocaleDateString("en-CA")}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await oddsProxy({ type: "events" });
    if (!data) return [];
    cacheSet(ck, data, TTL.events);
    return data;
  } catch (e) { console.warn("PropLines events:", e.message); return []; }
}

// ── Fetch hit props for one event ─────────────────────────────────────────────
export async function fetchEventProps(eventId, market = "batter_hits") {
  const ck = `props:${eventId}:${market}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await oddsProxy({ type: "props", eventId, market });
    if (!data) return {};
    cacheSet(ck, data, TTL.props);
    return data;
  } catch (e) { console.warn("PropLines props:", e.message); return {}; }
}

// ── Game-level moneyline / total odds ─────────────────────────────────────────
export async function fetchGameOdds() {
  const ck = `game:${new Date().toLocaleDateString("en-CA")}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  try {
    const data = await oddsProxy({ type: "game" });
    if (!data) return {};
    cacheSet(ck, data, TTL.game);
    return data;
  } catch (e) { console.warn("PropLines game odds:", e.message); return {}; }
}

// ── Find the best matching event for a given game ─────────────────────────────
export function matchEvent(events, homeTeamName) {
  if (!events?.length || !homeTeamName) return null;
  const needle = homeTeamName.toLowerCase();
  return events.find(ev =>
    ev.home_team?.toLowerCase().includes(needle) ||
    needle.includes(ev.home_team?.toLowerCase()?.split(" ").slice(-1)[0])
  ) || null;
}

// ── Format American odds for display (+130, -160) ─────────────────────────────
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
