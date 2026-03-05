// ── DiamondIQ Odds Proxy (Vercel Serverless Function) ────────────────────────
// This function sits between the browser and The Odds API.
// It caches responses server-side so 100 users = 1 API call, not 100.
//
// Env var required in Vercel dashboard: ODDS_API_KEY=your_key_here
// (Note: no VITE_ prefix — this runs server-side, not in the browser)
//
// Endpoints this function handles:
//   GET /api/odds?type=events               → today's MLB event list
//   GET /api/odds?type=props&eventId=xxx&market=batter_hits
//   GET /api/odds?type=game                 → moneylines + totals for all games

const API_KEY  = process.env.ODDS_API_KEY || "";
const BASE     = "https://api.the-odds-api.com/v4";
const SPORT    = "baseball_mlb";

// In-memory cache (lives for the duration of the serverless function instance)
// Vercel keeps warm instances alive ~5-10 min, giving us free short-term caching.
const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, exp: Date.now() + ttlMs });
}

const TTL = {
  events:  15 * 60 * 1000,  // 15 min — game list changes rarely
  props:   10 * 60 * 1000,  // 10 min — lines shift but not every second
  game:    10 * 60 * 1000,  // 10 min — moneylines / totals
};

export default async function handler(req, res) {
  // CORS — allow requests from our own frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET")     { res.status(405).json({ error: "Method not allowed" }); return; }

  if (!API_KEY) {
    res.status(503).json({ error: "ODDS_API_KEY not configured", data: null });
    return;
  }

  const { type, eventId, market = "batter_hits" } = req.query;

  try {
    if (type === "events") {
      const ck = "events";
      const cached = cacheGet(ck);
      if (cached) { res.status(200).json({ data: cached, cached: true }); return; }

      const r = await fetch(
        `${BASE}/sports/${SPORT}/events?apiKey=${API_KEY}&dateFormat=iso`
      );
      if (!r.ok) throw new Error(`Odds API ${r.status}`);
      const data = await r.json();
      cacheSet(ck, data, TTL.events);
      res.setHeader("X-Requests-Remaining", r.headers.get("x-requests-remaining") || "?");
      res.status(200).json({ data, cached: false });

    } else if (type === "props") {
      if (!eventId) { res.status(400).json({ error: "eventId required" }); return; }
      const ck = `props:${eventId}:${market}`;
      const cached = cacheGet(ck);
      if (cached) { res.status(200).json({ data: cached, cached: true }); return; }

      const r = await fetch(
        `${BASE}/sports/${SPORT}/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=${market}&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm`
      );
      if (!r.ok) throw new Error(`Odds API ${r.status}`);
      const raw = await r.json();

      // Collapse bookmakers → best line per player
      const lines = {};
      for (const bm of (raw.bookmakers || [])) {
        for (const mkt of (bm.markets || [])) {
          for (const outcome of (mkt.outcomes || [])) {
            const name = outcome.name?.trim();
            if (!name) continue;
            if (!lines[name]) {
              lines[name] = { point: outcome.point, over: null, under: null, bookmaker: bm.title };
            }
            if (outcome.description === "Over")  lines[name].over  = outcome.price;
            if (outcome.description === "Under") lines[name].under = outcome.price;
          }
        }
      }
      cacheSet(ck, lines, TTL.props);
      res.setHeader("X-Requests-Remaining", r.headers.get("x-requests-remaining") || "?");
      res.status(200).json({ data: lines, cached: false });

    } else if (type === "game") {
      const ck = "game";
      const cached = cacheGet(ck);
      if (cached) { res.status(200).json({ data: cached, cached: true }); return; }

      const r = await fetch(
        `${BASE}/sports/${SPORT}/odds?apiKey=${API_KEY}&regions=us&markets=h2h,totals&oddsFormat=american&bookmakers=draftkings,fanduel`
      );
      if (!r.ok) throw new Error(`Odds API ${r.status}`);
      const events = await r.json();

      const result = {};
      for (const ev of events) {
        const bm = ev.bookmakers?.[0];
        if (!bm) continue;
        const h2h    = bm.markets?.find(m => m.key === "h2h");
        const totals = bm.markets?.find(m => m.key === "totals");
        result[ev.home_team] = {
          homeML:     h2h?.outcomes?.find(o => o.name === ev.home_team)?.price,
          awayML:     h2h?.outcomes?.find(o => o.name === ev.away_team)?.price,
          totalOver:  totals?.outcomes?.find(o => o.name === "Over")?.price,
          totalUnder: totals?.outcomes?.find(o => o.name === "Under")?.price,
          totalLine:  totals?.outcomes?.[0]?.point,
          bookmaker:  bm.title,
        };
      }
      cacheSet(ck, result, TTL.game);
      res.setHeader("X-Requests-Remaining", r.headers.get("x-requests-remaining") || "?");
      res.status(200).json({ data: result, cached: false });

    } else {
      res.status(400).json({ error: "type must be events | props | game" });
    }
  } catch (e) {
    console.error("Odds proxy error:", e.message);
    res.status(502).json({ error: e.message, data: null });
  }
}
