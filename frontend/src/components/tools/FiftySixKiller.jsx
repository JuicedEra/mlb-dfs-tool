// src/components/tools/FiftySixKiller.jsx
// DiamondIQ PRO — 56 Killer Tool v2
// Composite score: lineup pos, rolling hit rate, PA probability, park factor, pitcher K%, home/road risk
// Formula hidden — confidence bars + tier labels + factor pills only
//
// CHANGELOG v2.2
// - Fix: no-games date now shows error message instead of silent blank screen
// - Fix: fetchConfirmedLineups failure now falls back to fetchLineupOrder (boxscore) + roster merge
//        for named, ordered candidates — prevents all candidates being unconfirmed roster dumps
// - Fix: player names — when roster lookup misses (spring training expanded rosters), resolve
//        each unknown ID individually via fetchPersonInfo(/people/{id}) for accurate names
// - Fix: unconfirmed lineup scoring boosted (lineupScore 10→18, paScore 7→10) so roster-fallback
//        players score in the 45-65 range and pass the confidence filter
// - Fix: confidence filter lowered from ≥60 to ≥40 so early-season / pre-lineup data surfaces results
// - Fix: interim + final threshold unified at CONF_THRESHOLD constant for easy future tuning
// - UI: summary bar copy changed from "X plays found" → "X hitters picked"

import { useState, useCallback, useRef } from "react";
import {
  fetchGames,
  fetchConfirmedLineups,
  fetchLineupOrder,
  fetchPersonInfo,
  fetchGameLog,
  fetchPitcherStats,
  fetchRoster,
  PARK_FACTORS,
  headshot,
} from "../../utils/mlbApi";
import PlayerPanel from "../shared/PlayerPanel";

// ─── Minimum confidence to surface a result ──────────────────────────────────
// 40 = show any player with reasonable form data, even pre-lineup
// Raise to 60 once regular season lineups post consistently
const CONF_THRESHOLD = 40;

// ─── Tier config ────────────────────────────────────────────────────────────
const TIERS = [
  { label: "ELITE",    min: 90, color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  border: "#f59e0b" },
  { label: "STRONG",   min: 82, color: "#22c55e", bg: "rgba(34,197,94,0.12)",   border: "#22c55e" },
  { label: "SOLID",    min: 74, color: "#38bdf8", bg: "rgba(56,189,248,0.10)",  border: "#38bdf8" },
  { label: "WATCH",    min: 60, color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "#475569" },
];

function getTier(confidence) {
  return TIERS.find(t => confidence >= t.min) || TIERS[TIERS.length - 1];
}

// ─── Factor pill definitions ─────────────────────────────────────────────────
const FACTOR_DEFS = {
  hotStreak:    { label: "🔥 Hot Streak",    activeColor: "#f59e0b" },
  topOrder:     { label: "⚡ Top of Order",   activeColor: "#22c55e" },
  parkFriendly: { label: "🏟️ Park Friendly",  activeColor: "#38bdf8" },
  lowK:         { label: "🎯 Low-K Pitcher",  activeColor: "#a78bfa" },
  homeAdvantage:{ label: "🏠 Home Advantage", activeColor: "#34d399" },
  highPA:       { label: "📊 High PA Prob",   activeColor: "#fb923c" },
  bounceBack:   { label: "↩️ Bounce-Back",    activeColor: "#f472b6" },
};

// ─── compute56KillerScore ────────────────────────────────────────────────────
// Weights: lineupPos 30%, rollingHitRate 25%, paProbability 20%,
//          parkFactor 10%, pitcherKInverse 10%, homeRoadRisk 5%
// Returns { confidence, tier, factors[], breakdown_hidden }
export function compute56KillerScore({
  lineupPos,          // 1-9, null if unknown
  l7hits, l7pa,       // last 7 games
  l14hits, l14pa,
  l30hits, l30pa,
  parkFactor,         // numeric, ~100 = neutral
  pitcherKPct,        // 0-1 fraction
  isHome,
  activeStreak,       // current consecutive hit game streak
  prevStreak,         // streak before last 0-for (bounce-back signal)
  seasonAvg,          // full season BA
  lineupConfirmed,
}) {
  // 1. Lineup position (30pts)
  let lineupScore = 0;
  if (lineupPos != null) {
    if (lineupPos <= 2) lineupScore = 30;
    else if (lineupPos <= 4) lineupScore = 26;
    else if (lineupPos <= 6) lineupScore = 18;
    else if (lineupPos <= 7) lineupScore = 10;
    else lineupScore = 5;
  } else {
    // FIX: was 10 — boosted to 18 so unconfirmed roster candidates score
    // in the 45-65 range and pass the CONF_THRESHOLD filter
    lineupScore = 18; // unconfirmed but likely starter
  }

  // 2. Rolling hit rate (25pts) — weighted blend L7>L14>L30
  const safeRate = (h, pa) => (pa >= 3 ? h / pa : seasonAvg ?? 0.25);
  const r7  = safeRate(l7hits,  l7pa);
  const r14 = safeRate(l14hits, l14pa);
  const r30 = safeRate(l30hits, l30pa);
  const blendRate = r7 * 0.55 + r14 * 0.28 + r30 * 0.17;
  const hitRateScore = Math.min(25, blendRate * 80); // .312+ → 25pts

  // 3. PA probability (20pts) — proxy: lineupPos + confirmed
  let paScore = 0;
  if (lineupPos != null) {
    const basePA = lineupPos <= 4 ? 20 : lineupPos <= 6 ? 15 : 10;
    paScore = lineupConfirmed ? basePA : basePA * 0.75;
  } else {
    // FIX: was 7 unconfirmed — boosted to 10 to match the lineupScore change above
    paScore = lineupConfirmed ? 12 : 10;
  }

  // 4. Park factor (10pts) — 110+ hitter-friendly, <90 pitcher's park
  const pfScore = Math.min(10, Math.max(0, ((parkFactor ?? 100) - 85) / 3));

  // 5. Pitcher K% inverse (10pts) — low K% pitcher = more contact opportunity
  const kInverse = pitcherKPct != null ? Math.max(0, 1 - pitcherKPct) : 0.65;
  const kScore = kInverse * 10;

  // 6. Home/road risk (5pts)
  const homeScore = isHome ? 5 : 2.5;

  const raw = lineupScore + hitRateScore + paScore + pfScore + kScore + homeScore;
  // Max theoretical ~100; clamp to 0-100
  const confidence = Math.min(100, Math.max(0, Math.round(raw)));

  // ─ Factor pills ─
  const factors = [];
  if (activeStreak >= 5) factors.push("hotStreak");
  if (lineupPos != null && lineupPos <= 3) factors.push("topOrder");
  if ((parkFactor ?? 100) >= 105) factors.push("parkFriendly");
  if (pitcherKPct != null && pitcherKPct < 0.2) factors.push("lowK");
  if (isHome) factors.push("homeAdvantage");
  if (lineupPos != null && lineupPos <= 4 && lineupConfirmed) factors.push("highPA");
  if (prevStreak >= 5) factors.push("bounceBack");

  return { confidence, tier: getTier(confidence), factors };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ConfidenceBar({ value, tier }) {
  return (
    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1, height: 6, borderRadius: 3,
        background: "rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${value}%`,
          background: `linear-gradient(90deg, ${tier.color}88, ${tier.color})`,
          borderRadius: 3,
          transition: "width 0.6s cubic-bezier(0.34,1.56,0.64,1)",
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: tier.color, minWidth: 34, textAlign: "right" }}>
        {value}%
      </span>
    </div>
  );
}

function TierBadge({ tier }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
      padding: "2px 7px", borderRadius: 4,
      border: `1px solid ${tier.border}`,
      color: tier.color, background: tier.bg,
    }}>
      {tier.label}
    </span>
  );
}

function FactorPill({ factorKey }) {
  const def = FACTOR_DEFS[factorKey];
  if (!def) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      padding: "2px 8px", borderRadius: 20,
      background: `${def.activeColor}18`,
      border: `1px solid ${def.activeColor}55`,
      color: def.activeColor,
      whiteSpace: "nowrap",
    }}>
      {def.label}
    </span>
  );
}

function PlayerCard({ pick, rank, onOpen }) {
  const tier = pick.tier ?? getTier(pick.confidence);
  const [photoErr, setPhotoErr] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const batterId = pick.id?.split("-")[0];

  return (
    <div
      style={{
        background: "var(--surface, #fff)",
        border: `1px solid ${expanded ? tier.border : "var(--border, #D8DEED)"}`,
        borderLeft: `3px solid ${tier.color}`,
        borderRadius: 10,
        padding: "14px 16px",
        cursor: "pointer",
        transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
        userSelect: "none",
        boxShadow: "var(--shadow-xs)",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2, #F5F7FB)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "var(--surface, #fff)"; e.currentTarget.style.boxShadow = "var(--shadow-xs)"; }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        {/* Rank */}
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: rank <= 3 ? `${tier.color}22` : "rgba(255,255,255,0.06)",
          border: `1px solid ${rank <= 3 ? tier.color : "rgba(255,255,255,0.1)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800, color: rank <= 3 ? tier.color : "#94a3b8",
          flexShrink: 0,
        }}>
          {rank}
        </div>

        {/* Headshot */}
        <div
          onClick={e => { e.stopPropagation(); onOpen(pick); }}
          title="View player card"
          style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            overflow: "hidden", border: `2px solid ${tier.color}55`,
            background: "var(--surface-2, #F5F7FB)",
            cursor: "pointer", transition: "border-color 0.2s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = tier.color; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = `${tier.color}55`; }}
        >
          {!photoErr && batterId ? (
            <img
              src={headshot(batterId)}
              alt={pick.name}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              onError={() => setPhotoErr(true)}
            />
          ) : (
            <div style={{
              width: "100%", height: "100%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, color: tier.color,
              background: `${tier.color}18`,
            }}>
              {pick.name?.split(" ").map(w => w[0]).slice(0, 2).join("") || "?"}
            </div>
          )}
        </div>

        {/* Player info */}
        <div
          style={{ flex: 1, minWidth: 0 }}
          onClick={() => setExpanded(e => !e)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              onClick={e => { e.stopPropagation(); onOpen(pick); }}
              style={{
                fontSize: 15, fontWeight: 700, color: "var(--text-primary, #0C1A35)",
                letterSpacing: "-0.01em", cursor: "pointer",
                textDecoration: "none",
              }}
              onMouseEnter={e => { e.target.style.textDecoration = "underline"; }}
              onMouseLeave={e => { e.target.style.textDecoration = "none"; }}
            >
              {pick.name}
            </span>
            <TierBadge tier={tier} />
            {pick.lineupPos && (
              <span style={{ fontSize: 11, color: "#64748b" }}>#{pick.lineupPos}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #8494B2)", marginTop: 2 }}>
            {pick.team} · {pick.opponent} · {pick.venue}
          </div>
        </div>

        {/* Confidence */}
        <div
          style={{ textAlign: "right", flexShrink: 0 }}
          onClick={() => setExpanded(e => !e)}
        >
          <div style={{ fontSize: 22, fontWeight: 800, color: tier.color, lineHeight: 1 }}>
            {pick.confidence}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted, #8494B2)", letterSpacing: "0.05em" }}>CONF</div>
        </div>
      </div>

      {/* Confidence bar */}
      <div onClick={() => setExpanded(e => !e)}>
        <ConfidenceBar value={pick.confidence} tier={tier} />
      </div>

      {/* Factor pills */}
      {pick.factors?.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}
          onClick={() => setExpanded(e => !e)}
        >
          {pick.factors.map(f => <FactorPill key={f} factorKey={f} />)}
        </div>
      )}

      {/* Expanded stats row */}
      {expanded && (
        <div style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border, #D8DEED)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: 8,
        }}>
          {[
            { label: "L7 AVG",   tip: "Batting average over last 7 games — highest weight in 56K score",      value: pick.l7pa  >= 3 ? (pick.l7hits  / pick.l7pa ).toFixed(3).replace("0.", ".") : "—" },
            { label: "L14 AVG",  tip: "Batting average over last 14 games",                                    value: pick.l14pa >= 3 ? (pick.l14hits / pick.l14pa).toFixed(3).replace("0.", ".") : "—" },
            { label: "L30 AVG",  tip: "Batting average over last 30 games — season baseline anchor",           value: pick.l30pa >= 3 ? (pick.l30hits / pick.l30pa).toFixed(3).replace("0.", ".") : "—" },
            { label: "STREAK",   tip: "Consecutive games with at least 1 hit — 5+ triggers Hot Streak bonus",  value: pick.activeStreak >= 1 ? `${pick.activeStreak}G` : "—" },
            { label: "LINEUP",   tip: "Confirmed batting order position — top of order earns max PA probability", value: pick.lineupPos ? `#${pick.lineupPos}${pick.lineupConfirmed ? " ✓" : " ~"}` : "~" },
            { label: "PARK",     tip: "Park factor — 100 is neutral, 110+ is hitter-friendly, <90 is pitcher's park", value: pick.parkFactor != null ? pick.parkFactor : "—" },
            { label: "OPP K%",   tip: "Opposing pitcher's strikeout rate — lower K% means more balls in play (better for hitters)", value: pick.pitcherKPct != null ? `${(pick.pitcherKPct*100).toFixed(0)}%` : "—" },
            { label: "PITCHER",  tip: "Today's opposing starting pitcher",                                      value: pick.pitcherName ?? "—", wide: true },
          ].map(s => (
            <div key={s.label} title={s.tip} data-tooltip={s.tip} style={{ gridColumn: s.wide ? "span 2" : "span 1", cursor: "help" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted, #8494B2)", letterSpacing: "0.07em", marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary, #445068)" }}>{s.value}</div>
            </div>
          ))}
          {/* Full card CTA */}
          <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
            <button
              onClick={e => { e.stopPropagation(); onOpen(pick); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: `${tier.color}18`, border: `1px solid ${tier.color}55`,
                borderRadius: 6, padding: "5px 12px",
                color: tier.color, fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>person</span>
              Full Player Card
            </button>
          </div>
        </div>
      )}

      {/* Expand chevron */}
      <div style={{ textAlign: "center", marginTop: 8 }} onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 11, color: "var(--text-muted, #8494B2)", userSelect: "none" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>
    </div>
  );
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.05)",
      borderLeft: "3px solid rgba(255,255,255,0.08)",
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 14, width: "55%", borderRadius: 4, background: "rgba(255,255,255,0.07)", marginBottom: 6 }} />
          <div style={{ height: 11, width: "35%", borderRadius: 4, background: "rgba(255,255,255,0.04)" }} />
        </div>
        <div style={{ width: 36, height: 28, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
        {[80, 100, 70].map(w => (
          <div key={w} style={{ height: 22, width: w, borderRadius: 20, background: "rgba(255,255,255,0.05)" }} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function FiftySixKiller({ mode, isPremium, onUpgrade }) {
  const [picks, setPicks]           = useState([]);
  const [status, setStatus]         = useState("idle"); // idle | loading | done | error
  const [progress, setProgress]     = useState({ scored: 0, total: 0 });
  const [errorMsg, setErrorMsg]     = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [panelPick, setPanelPick]   = useState(null); // PlayerPanel target
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const abortRef = useRef(false);

  // ─── Open PlayerPanel — shape 56K pick into the format PlayerPanel expects ──
  const openPanel = useCallback((pick) => {
    const batterId = parseInt(pick.id?.split("-")[0], 10);
    setPanelPick({
      batter: { id: batterId, name: pick.name, batSide: "?" },
      pitcher: pick.pitcherId
        ? { id: pick.pitcherId, name: pick.pitcherName ?? "Unknown", hand: "R" }
        : null,
      game: { gamePk: pick.gamePk, venue: pick.venue },
      scoreData: null, // 56K uses its own confidence score, not IQ scoreData
    });
  }, []);

  // ─── Scoring pipeline ──────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    abortRef.current = false;
    setStatus("loading");
    setPicks([]);
    setProgress({ scored: 0, total: 0 });
    setErrorMsg("");

    try {
      const { games } = await fetchGames(selectedDate);
      console.log("[56K] Games found:", games?.length ?? 0, games?.map(g => g.gamePk));

      // FIX: was setStatus("done") with no message — now surfaces a clear error
      if (!games?.length) {
        setErrorMsg(`No MLB games scheduled for ${selectedDate}. Try a different date.`);
        setStatus("error");
        return;
      }

      // ── Gather all batters from lineups ──────────────────────────────────
      // Strategy (per game, per side):
      //   1. Try fetchConfirmedLineups (/feed/live) — richest but slow/large
      //   2. If that fails or returns <5 players, try fetchLineupOrder (/boxscore)
      //      + merge with roster for names
      //   3. Final fallback: active roster (unordered, no confirmed credit)
      const candidates = [];

      for (const game of games) {
        if (abortRef.current) break;

        // Try primary lineup source — swallow errors gracefully
        const lineupData = await fetchConfirmedLineups(game.gamePk).catch(() => null);

        const sides = ["home", "away"];
        for (const side of sides) {
          const battingTeam = game[side];
          const opponent    = game[side === "home" ? "away" : "home"];
          const pitcherId   = opponent?.pitcher?.id ?? null;
          const pitcherNameFromGame = opponent?.pitcher?.name ?? null;

          let confirmed = lineupData?.[side]?.status === "confirmed";
          let lineup    = lineupData?.[side]?.players ?? [];

          // ── Fallback 1: boxscore batting order + roster name merge ────────
          // fetchLineupOrder is lighter (/boxscore) and more reliable pre-game
          // than /feed/live. Returns ordered IDs; cross-reference roster for names.
          // Spring training rosters are expanded (60+ players) so the active roster
          // may not contain every batter — resolve unknowns via fetchPersonInfo.
          if (lineup.length < 5 && battingTeam?.teamId) {
            try {
              const [orderData, roster] = await Promise.all([
                fetchLineupOrder(game.gamePk).catch(() => ({ home: [], away: [] })),
                fetchRoster(battingTeam.teamId).catch(() => []),
              ]);
              const orderIds = orderData[side] ?? [];
              if (orderIds.length >= 1) {
                const rosterMap = new Map(roster.map(p => [p.id, p]));

                // Resolve any IDs not in the active roster individually
                const missingIds = orderIds.filter(id => !rosterMap.has(id));
                if (missingIds.length > 0) {
                  const resolved = await Promise.allSettled(
                    missingIds.map(id => fetchPersonInfo(id).catch(() => null))
                  );
                  resolved.forEach((r, i) => {
                    if (r.status === "fulfilled" && r.value) {
                      rosterMap.set(missingIds[i], r.value);
                    }
                  });
                }

                lineup = orderIds.map((id, idx) => {
                  const p = rosterMap.get(id) ?? { id, name: `Unknown (${id})`, position: "?", batSide: "?" };
                  return {
                    id,
                    name:     p.name ?? p.fullName ?? `Unknown (${id})`,
                    position: p.position,
                    batSide:  p.batSide,
                    order:    idx + 1,
                  };
                });
                confirmed = orderIds.length >= 9;
              }
            } catch { /* fall through to roster fallback */ }
          }

          // ── Fallback 2: active roster (no order, no confirmed credit) ─────
          if (lineup.length < 5 && battingTeam?.teamId) {
            try {
              const roster = await fetchRoster(battingTeam.teamId);
              lineup = roster.slice(0, 9).map((p, idx) => ({
                id: p.id,
                name: p.name ?? p.fullName ?? `Player ${p.id}`,
                position: p.position,
                batSide: p.batSide,
                order: idx + 1,
              }));
              confirmed = false;
            } catch { /* skip team entirely */ }
          }

          for (let i = 0; i < lineup.length; i++) {
            candidates.push({
              batter:       lineup[i],
              lineupPos:    confirmed ? (i + 1) : null,
              lineupConfirmed: confirmed,
              battingTeam,
              opponent,
              pitcherId,
              pitcherName:  pitcherNameFromGame,
              game,
              isHome:       side === "home",
              venue:        game.venue ?? "",
            });
          }
        }
      }

      console.log("[56K] Total candidates:", candidates.length);
      setProgress({ scored: 0, total: candidates.length });

      const BATCH   = 12;
      const results = [];

      for (let i = 0; i < candidates.length; i += BATCH) {
        if (abortRef.current) break;
        const batch = candidates.slice(i, i + BATCH);

        const batchResults = await Promise.allSettled(
          batch.map(async (c) => {
            const {
              batter, lineupPos, lineupConfirmed,
              battingTeam, opponent, pitcherId, pitcherName: pitcherNameC,
              game, isHome, venue,
            } = c;

            // Fetch gamelog — returns sorted desc by date
            const sorted = await fetchGameLog(batter.id, new Date().getFullYear()).catch(() => []);

            // Rolling splits — use atBats (MLB API field name)
            const sliceHits = (n) => {
              let h = 0, pa = 0;
              for (const g of sorted.slice(0, n)) {
                h  += +(g.hits   ?? 0);
                pa += +(g.atBats ?? g.ab ?? 0);
              }
              return { hits: h, pa };
            };
            const s7  = sliceHits(7);
            const s14 = sliceHits(14);
            const s30 = sliceHits(30);

            // Active hit streak
            let activeStreak = 0;
            for (const g of sorted) {
              if ((g.hits ?? 0) > 0) activeStreak++;
              else break;
            }

            // Previous streak (bounce-back signal)
            let prevStreak = 0;
            if ((sorted[0]?.hits ?? 1) === 0) {
              for (const g of sorted.slice(1)) {
                if ((g.hits ?? 0) > 0) prevStreak++;
                else break;
              }
            }

            // Season avg from gamelog
            const seasonHits = sorted.reduce((a, g) => a + +(g.hits   ?? 0), 0);
            const seasonAB   = sorted.reduce((a, g) => a + +(g.atBats ?? g.ab ?? 0), 0);
            const seasonAvg  = seasonAB >= 10 ? seasonHits / seasonAB : 0.250;

            // Park factor
            const parkFactor = PARK_FACTORS?.[venue]?.factor ?? 100;

            // Pitcher K%
            let pitcherKPct = null;
            if (pitcherId) {
              const pStats = await fetchPitcherStats(pitcherId).catch(() => null);
              pitcherKPct  = pStats?.kPct ?? null;
            }

            const { confidence, tier, factors } = compute56KillerScore({
              lineupPos,
              l7hits: s7.hits,   l7pa: s7.pa,
              l14hits: s14.hits, l14pa: s14.pa,
              l30hits: s30.hits, l30pa: s30.pa,
              parkFactor,
              pitcherKPct,
              isHome,
              activeStreak,
              prevStreak,
              seasonAvg,
              lineupConfirmed,
            });

            return {
              id:              `${batter.id}-${game.gamePk}`,
              name:            batter.fullName ?? batter.name ?? "Unknown",
              team:            battingTeam?.team ?? battingTeam?.abbr ?? "",
              opponent:        opponent?.abbr ?? "",
              venue,
              gamePk:          game.gamePk,
              pitcherId:       pitcherId ?? null,
              lineupPos,
              lineupConfirmed,
              isHome,
              confidence,
              tier,
              factors,
              activeStreak,
              prevStreak,
              l7hits: s7.hits,   l7pa: s7.pa,
              l14hits: s14.hits, l14pa: s14.pa,
              l30hits: s30.hits, l30pa: s30.pa,
              parkFactor,
              pitcherKPct,
              pitcherName: pitcherNameC,
            };
          })
        );

        for (const r of batchResults) {
          if (r.status === "fulfilled") results.push(r.value);
          // Rejected promises are swallowed — player simply won't appear
        }

        setProgress({ scored: Math.min(i + BATCH, candidates.length), total: candidates.length });

        // Streaming update — show results as they come in
        // FIX: threshold lowered from 60 → CONF_THRESHOLD (40)
        const interim = [...results]
          .filter(p => p.confidence >= CONF_THRESHOLD)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10);
        setPicks(interim);
      }

      // Final sort
      // FIX: threshold lowered from 60 → CONF_THRESHOLD (40)
      const final = [...results]
        .filter(p => p.confidence >= CONF_THRESHOLD)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);

      console.log("[56K] Final results:", final.length, "above threshold", CONF_THRESHOLD);
      setPicks(final);
      setStatus("done");

    } catch (err) {
      console.error("[56Killer]", err);
      setErrorMsg(err.message ?? "Unknown error. Check console for details.");
      setStatus("error");
    }
  }, [selectedDate]);

  // ─── Filtered view ─────────────────────────────────────────────────────────
  const visiblePicks = filterTier === "all"
    ? picks
    : picks.filter(p => p.tier?.label === filterTier);

  const isLoading  = status === "loading";
  const isDone     = status === "done";
  const hasResults = picks.length > 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      color: "#f1f5f9",
      fontFamily: "'Inter', system-ui, sans-serif",
      padding: "0 0 60px",
    }}>

      {/* ── Header ── */}
      <div style={{
        background: "var(--surface-2, #F5F7FB)",
        borderBottom: "1px solid var(--border, #D8DEED)",
        padding: "20px 24px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{
            fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em",
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            56 Killer
          </span>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
            color: "#f59e0b", border: "1px solid #f59e0b55",
            padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.1)",
          }}>
            BEAT THE STREAK
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#475569", margin: 0, lineHeight: 1.5 }}>
          Composite analysis targeting elite contact opportunities. Top 10 plays, ranked by confidence.
        </p>
      </div>

      <div style={{ padding: "16px 16px 0" }}>

        {/* ── Controls ── */}
        <div style={{
          display: "flex", gap: 10, flexWrap: "wrap",
          alignItems: "center", marginBottom: 20,
        }}>
          {/* Date selector */}
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            disabled={isLoading}
            style={{
              height: 36, padding: "0 12px",
              background: "var(--surface, #fff)",
              border: `1px solid ${selectedDate ? "#f59e0b" : "var(--border, #D8DEED)"}`,
              borderRadius: 8,
              color: "var(--text-primary, #0C1A35)",
              fontSize: 13, fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.5 : 1,
              outline: "none",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          />

          <button
            onClick={isLoading ? () => { abortRef.current = true; } : runAnalysis}
            style={{
              background: isLoading
                ? "rgba(239,68,68,0.15)"
                : "linear-gradient(135deg, #f59e0b, #d97706)",
              border: isLoading ? "1px solid rgba(239,68,68,0.4)" : "none",
              borderRadius: 8, padding: "8px 18px",
              color: isLoading ? "#ef4444" : "#0a0f1e",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
              transition: "opacity 0.2s",
            }}
          >
            {isLoading
              ? <span className="material-icons" style={{ fontSize: 16 }}>stop</span>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" fill="rgba(0,0,0,0.15)" />
                  <text x="8" y="11" textAnchor="middle" fontSize="6" fontWeight="900"
                    fontFamily="'Inter', sans-serif" fill="currentColor" letterSpacing="-0.3">56</text>
                  <line x1="12" y1="3" x2="4" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            }
            {isLoading ? "Stop" : "Run Analysis"}
          </button>

          {/* Tier filter chips */}
          {hasResults && (
            <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
              {[
                { label: "all",    tip: "Show all tiers" },
                { label: "ELITE",  tip: "Elite: 90+ confidence — strongest contact setups" },
                { label: "STRONG", tip: "Strong: 82-89 — high-confidence plays" },
                { label: "SOLID",  tip: "Solid: 74-81 — solid matchup and form" },
                { label: "WATCH",  tip: "Watch: 60-73 — worth monitoring, less certainty" },
              ].map(({ label, tip }) => {
                const active = filterTier === label;
                const tier   = TIERS.find(t => t.label === label);
                return (
                  <button
                    key={label}
                    onClick={() => setFilterTier(label)}
                    title={tip}
                    data-tooltip={tip}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                      background: active ? (tier?.bg ?? "rgba(255,255,255,0.1)") : "transparent",
                      border: `1px solid ${active ? (tier?.border ?? "var(--border)") : "var(--border)"}`,
                      color: active ? (tier?.color ?? "var(--text-primary)") : "var(--text-muted)",
                    }}
                  >
                    {label === "all" ? "ALL" : label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Progress bar ── */}
        {isLoading && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              fontSize: 12, color: "#475569", marginBottom: 5,
            }}>
              <span>Analyzing batters…</span>
              <span>
                {progress.total > 0
                  ? `${progress.scored} / ${progress.total}`
                  : "Fetching lineups…"}
              </span>
            </div>
            <div style={{
              height: 3, borderRadius: 2,
              background: "var(--border, #D8DEED)", overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: progress.total > 0 ? `${(progress.scored / progress.total) * 100}%` : "0%",
                background: "linear-gradient(90deg, #f59e0b88, #f59e0b)",
                borderRadius: 2,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {status === "error" && (
          <div style={{
            background: "var(--data-red-bg, rgba(220,38,38,0.09))",
            border: "1px solid var(--data-red-border, rgba(220,38,38,0.22))",
            borderRadius: 8, padding: "12px 16px",
            color: "var(--data-red, #DC2626)", fontSize: 13, marginBottom: 16,
          }}>
            <span className="material-icons" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>error_outline</span>
            {errorMsg || "Failed to load data. Check your connection and try again."}
          </div>
        )}

        {/* ── Idle CTA ── */}
        {status === "idle" && (
          <div style={{
            textAlign: "center", padding: "48px 16px",
            color: "var(--text-muted, #8494B2)",
          }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ display: "block", margin: "0 auto 12px" }}>
              <circle cx="24" cy="24" r="22" fill="var(--border, #D8DEED)" />
              <text x="24" y="28" textAnchor="middle" fontSize="16" fontWeight="900"
                fontFamily="'Inter', sans-serif" fill="var(--text-muted, #8494B2)" letterSpacing="-0.5">56</text>
              <line x1="36" y1="12" x2="12" y2="36" stroke="var(--text-muted, #8494B2)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary, #445068)" }}>
              Ready to run
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted, #8494B2)" }}>
              Select a date and tap <strong style={{ color: "#d97706" }}>Run Analysis</strong> to surface today's top plays.
            </div>
          </div>
        )}

        {/* ── Skeleton while loading with no results yet ── */}
        {isLoading && !hasResults && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── No results after done ── */}
        {isDone && !hasResults && (
          <div style={{
            textAlign: "center", padding: "40px 16px",
            color: "var(--text-muted, #8494B2)",
          }}>
            <span className="material-icons" style={{ fontSize: 32, display: "block", marginBottom: 10, opacity: 0.4 }}>search_off</span>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>No plays surfaced</div>
            <div style={{ fontSize: 12 }}>
              Lineups may not be posted yet. Try again closer to game time, or check a past date.
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {hasResults && (
          <>
            {/* Summary bar */}
            <div style={{
              display: "flex", gap: 16, flexWrap: "wrap",
              marginBottom: 14, padding: "10px 14px",
              background: "var(--surface-2, #F5F7FB)",
              border: "1px solid var(--border, #D8DEED)",
              borderRadius: 8, fontSize: 12, color: "var(--text-muted, #8494B2)",
            }}>
              {TIERS.map(t => {
                const n = picks.filter(p => p.tier?.label === t.label).length;
                if (!n) return null;
                return (
                  <span key={t.label}>
                    <span style={{ color: t.color, fontWeight: 700 }}>{n}</span> {t.label}
                  </span>
                );
              })}
              <span style={{ marginLeft: "auto" }}>
                {isLoading ? `${progress.scored} scored…` : `${picks.length} hitter${picks.length !== 1 ? "s" : ""} picked`}
              </span>
            </div>

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visiblePicks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 14 }}>
                  No plays match the selected tier filter.
                </div>
              ) : (
                visiblePicks.map((pick, i) => (
                  <PlayerCard key={pick.id} pick={pick} rank={i + 1} onOpen={openPanel} />
                ))
              )}
            </div>

            {/* Disclaimer */}
            {isDone && (
              <div style={{
                marginTop: 20, padding: "10px 14px",
                background: "var(--data-yellow-bg, rgba(180,83,9,0.06))",
                border: "1px solid var(--data-yellow-border, rgba(180,83,9,0.18))",
                borderRadius: 8, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6,
              }}>
                <span className="material-icons" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 4, color: "#d97706" }}>info</span>
                Confidence scores reflect a proprietary composite model. They do not guarantee results.
                Always verify lineup confirmation on MLB.com before submitting picks.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Player Info Panel ── */}
      {panelPick && (
        <PlayerPanel
          pick={panelPick}
          onClose={() => setPanelPick(null)}
          showBvP={false}
          liveStats={null}
        />
      )}
    </div>
  );
}
