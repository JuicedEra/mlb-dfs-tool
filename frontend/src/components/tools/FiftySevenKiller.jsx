// /src/pages/FiftySevenKiller.jsx
// DiamondIQ — 57 Killer Page
// Sits between IQ Picks and Back Tester in nav

import { useState, useEffect } from "react";

// ─── Algo weights (57 Killer composite) ────────────────────────────────────
const WEIGHTS = {
  lineupPosition: 0.30,
  rollingHitRate: 0.25,
  paProb:         0.20,
  parkFactor:     0.10,
  pitcherKPct:    0.10,
  homeRisk:       0.05,
};

// Lineup position PA multiplier (1=leadoff best, 9=worst)
const LINEUP_PA_SCORE = [1.0, 0.95, 0.88, 0.82, 0.76, 0.70, 0.65, 0.60, 0.50];

function compute57Score(player) {
  const posScore  = LINEUP_PA_SCORE[Math.min((player.lineupPos || 1) - 1, 8)];
  const rollScore = (
    (player.hitRate7  || 0) * 0.40 +
    (player.hitRate14 || 0) * 0.35 +
    (player.hitRate30 || 0) * 0.25
  );
  const paScore      = Math.min((player.paProb || 0.6), 1.0);
  const parkScore    = Math.min((player.parkFactor || 1.0) / 1.3, 1.0);
  const kScore       = 1 - Math.min((player.pitcherKPct || 0.22), 0.40);
  const homeRiskPen  = player.isHome ? 0.95 : 1.0;

  const raw =
    posScore  * WEIGHTS.lineupPosition +
    rollScore * WEIGHTS.rollingHitRate +
    paScore   * WEIGHTS.paProb         +
    parkScore * WEIGHTS.parkFactor     +
    kScore    * WEIGHTS.pitcherKPct    +
    homeRiskPen * WEIGHTS.homeRisk;

  return Math.min(Math.round(raw * 100), 99);
}

// ─── Mock data (replace with Supabase fetch) ────────────────────────────────
const MOCK_PLAYERS = [
  {
    id: 1, name: "Freddie Freeman",   team: "LAD", opp: "@ SF",  lineupPos: 2,
    hitRate7: 0.81, hitRate14: 0.76, hitRate30: 0.72,
    paProb: 0.91, parkFactor: 1.08, pitcherKPct: 0.19, isHome: false,
    pitcher: "Logan Webb", hand: "L vs R",
    props: [
      { line: "1+ Hits", odds: -165, recommended: true },
      { line: "1.5+ Hits", odds: +210, recommended: false },
    ],
    avgHits: 1.4, lastGames: [1,1,1,0,1,1,1],
  },
  {
    id: 2, name: "Steven Kwan",       team: "CLE", opp: "vs DET", lineupPos: 1,
    hitRate7: 0.86, hitRate14: 0.79, hitRate30: 0.74,
    paProb: 0.94, parkFactor: 1.02, pitcherKPct: 0.21, isHome: true,
    pitcher: "Tarik Skubal", hand: "L vs L",
    props: [
      { line: "1+ Hits", odds: -180, recommended: true },
      { line: "1.5+ Hits", odds: +180, recommended: false },
    ],
    avgHits: 1.3, lastGames: [1,1,0,1,1,1,1],
  },
  {
    id: 3, name: "Luis Arraez",       team: "SD",  opp: "@ COL", lineupPos: 2,
    hitRate7: 0.88, hitRate14: 0.82, hitRate30: 0.78,
    paProb: 0.93, parkFactor: 1.28, pitcherKPct: 0.16, isHome: false,
    pitcher: "Cal Quantrill", hand: "L vs R",
    props: [
      { line: "1+ Hits", odds: -195, recommended: true },
      { line: "1.5+ Hits", odds: +155, recommended: true },
      { line: "2+ Hits", odds: +380, recommended: false },
    ],
    avgHits: 1.6, lastGames: [1,1,1,1,0,1,1],
  },
  {
    id: 4, name: "Yordan Alvarez",    team: "HOU", opp: "vs OAK", lineupPos: 3,
    hitRate7: 0.72, hitRate14: 0.68, hitRate30: 0.65,
    paProb: 0.88, parkFactor: 1.01, pitcherKPct: 0.24, isHome: true,
    pitcher: "JP Sears", hand: "L vs R",
    props: [
      { line: "1+ Hits", odds: -145, recommended: true },
      { line: "1+ HR", odds: +280, recommended: false },
    ],
    avgHits: 1.2, lastGames: [1,0,1,1,1,0,1],
  },
  {
    id: 5, name: "Jose Abreu",        team: "BOS", opp: "@ NYY",  lineupPos: 1,
    hitRate7: 0.74, hitRate14: 0.70, hitRate30: 0.67,
    paProb: 0.95, parkFactor: 0.98, pitcherKPct: 0.20, isHome: false,
    pitcher: "Carlos Rodón", hand: "R vs L",
    props: [
      { line: "1+ Hits", odds: -140, recommended: true },
    ],
    avgHits: 1.1, lastGames: [1,1,0,1,0,1,1],
  },
  {
    id: 6, name: "Gunnar Henderson",  team: "BAL", opp: "vs TB",  lineupPos: 2,
    hitRate7: 0.71, hitRate14: 0.69, hitRate30: 0.64,
    paProb: 0.92, parkFactor: 1.04, pitcherKPct: 0.23, isHome: true,
    pitcher: "Zach Eflin", hand: "L vs R",
    props: [
      { line: "1+ Hits", odds: -150, recommended: true },
      { line: "1+ HR", odds: +320, recommended: false },
    ],
    avgHits: 1.2, lastGames: [0,1,1,1,1,0,1],
  },
  {
    id: 7, name: "Elly De La Cruz",   team: "CIN", opp: "@ MIL",  lineupPos: 1,
    hitRate7: 0.69, hitRate14: 0.65, hitRate30: 0.62,
    paProb: 0.93, parkFactor: 0.99, pitcherKPct: 0.25, isHome: false,
    pitcher: "Freddy Peralta", hand: "R vs R",
    props: [
      { line: "1+ Hits", odds: -130, recommended: true },
      { line: "1+ SB", odds: +160, recommended: false },
    ],
    avgHits: 1.1, lastGames: [1,0,1,1,0,1,1],
  },
  {
    id: 8, name: "Mookie Betts",      team: "LAD", opp: "@ SF",  lineupPos: 1,
    hitRate7: 0.77, hitRate14: 0.71, hitRate30: 0.68,
    paProb: 0.94, parkFactor: 1.08, pitcherKPct: 0.19, isHome: false,
    pitcher: "Logan Webb", hand: "R vs L",
    props: [
      { line: "1+ Hits", odds: -160, recommended: true },
    ],
    avgHits: 1.3, lastGames: [1,1,1,0,1,0,1],
  },
  {
    id: 9, name: "Trea Turner",       team: "PHI", opp: "vs ATL", lineupPos: 1,
    hitRate7: 0.68, hitRate14: 0.66, hitRate30: 0.63,
    paProb: 0.93, parkFactor: 1.05, pitcherKPct: 0.22, isHome: true,
    pitcher: "Chris Sale", hand: "R vs L",
    props: [
      { line: "1+ Hits", odds: -135, recommended: true },
    ],
    avgHits: 1.1, lastGames: [1,1,0,0,1,1,1],
  },
  {
    id: 10, name: "Ernie Clement",    team: "TOR", opp: "@ BOS", lineupPos: 2,
    hitRate7: 0.82, hitRate14: 0.76, hitRate30: 0.70,
    paProb: 0.92, parkFactor: 1.01, pitcherKPct: 0.14, isHome: false,
    pitcher: "Brayan Bello", hand: "R vs R",
    props: [
      { line: "1+ Hits", odds: -155, recommended: true },
    ],
    avgHits: 1.2, lastGames: [1,1,1,0,1,1,1],
  },
].map(p => ({ ...p, score: compute57Score(p) }))
 .sort((a, b) => b.score - a.score);

// ─── Sub-components ──────────────────────────────────────────────────────────

function ConfidenceMeter({ score }) {
  const color =
    score >= 90 ? "#10b981" :
    score >= 85 ? "#34d399" :
    score >= 82 ? "#fbbf24" : "#f87171";

  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 11, color: "var(--text-muted)", marginBottom: 4,
        fontFamily: "'DM Mono', monospace",
      }}>
        <span>57K CONFIDENCE</span>
        <span style={{ color, fontWeight: 700 }}>{score}%</span>
      </div>
      <div style={{
        height: 6, background: "rgba(255,255,255,0.08)",
        borderRadius: 99, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${score}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          borderRadius: 99,
          transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
          boxShadow: `0 0 8px ${color}66`,
        }} />
      </div>
    </div>
  );
}

function MiniStreak({ games }) {
  return (
    <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
      {games.map((g, i) => (
        <div key={i} style={{
          width: 18, height: 18, borderRadius: 4,
          background: g ? "rgba(16,185,129,0.25)" : "rgba(248,113,113,0.2)",
          border: `1px solid ${g ? "#10b98155" : "#f8717155"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, color: g ? "#10b981" : "#f87171",
          fontFamily: "'DM Mono', monospace",
        }}>
          {g ? "H" : "0"}
        </div>
      ))}
    </div>
  );
}

function OddsChip({ prop, isRec }) {
  const sign = prop.odds > 0 ? "+" : "";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 8px", borderRadius: 6,
      background: isRec ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.05)",
      border: `1px solid ${isRec ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.08)"}`,
      fontSize: 11,
    }}>
      {isRec && <span style={{ color: "#fbbf24", fontSize: 9 }}>★</span>}
      <span style={{ color: "var(--text-muted)" }}>{prop.line}</span>
      <span style={{
        color: prop.odds < 0 ? "#34d399" : "#60a5fa",
        fontFamily: "'DM Mono', monospace", fontWeight: 600,
      }}>
        {sign}{prop.odds}
      </span>
    </div>
  );
}

function PlayerCard57({ player, rank, mode, selected, onSelect }) {
  const isTop3 = rank <= 3;
  const rankColor = rank === 1 ? "#fbbf24" : rank === 2 ? "#94a3b8" : rank === 3 ? "#c97d4e" : "var(--text-muted)";
  const scoreColor =
    player.score >= 90 ? "#10b981" :
    player.score >= 85 ? "#34d399" :
    player.score >= 82 ? "#fbbf24" : "var(--text-muted)";

  const lineupLabel = player.lineupPos <= 2
    ? `#${player.lineupPos} (Elite)`
    : player.lineupPos <= 4
    ? `#${player.lineupPos} (Good)`
    : `#${player.lineupPos}`;

  return (
    <div
      onClick={() => onSelect(player.id)}
      style={{
        background: selected
          ? "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.06) 100%)"
          : isTop3
          ? "linear-gradient(135deg, rgba(251,191,36,0.05) 0%, rgba(255,255,255,0.03) 100%)"
          : "rgba(255,255,255,0.03)",
        border: selected
          ? "1px solid rgba(16,185,129,0.4)"
          : isTop3
          ? "1px solid rgba(251,191,36,0.2)"
          : "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: "16px 18px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Rank glow for top 3 */}
      {isTop3 && (
        <div style={{
          position: "absolute", top: 0, left: 0,
          width: "100%", height: 2,
          background: `linear-gradient(90deg, transparent, ${rankColor}66, transparent)`,
        }} />
      )}

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Rank badge */}
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: rank <= 3
              ? `linear-gradient(135deg, ${rankColor}22, ${rankColor}11)`
              : "rgba(255,255,255,0.05)",
            border: `1px solid ${rankColor}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'DM Mono', monospace", fontWeight: 700,
            fontSize: 13, color: rankColor, flexShrink: 0,
          }}>
            {rank}
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>
                {player.name}
              </span>
              {selected && (
                <span style={{
                  fontSize: 9, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(16,185,129,0.2)", color: "#10b981",
                  fontFamily: "'DM Mono', monospace", letterSpacing: 1,
                }}>SELECTED</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {player.team} · {player.opp} · vs {player.pitcher} · <span style={{ color: "var(--text-secondary)" }}>{player.hand}</span>
            </div>
          </div>
        </div>

        {/* Score badge */}
        <div style={{
          textAlign: "center",
          background: `${scoreColor}15`,
          border: `1px solid ${scoreColor}40`,
          borderRadius: 10, padding: "6px 12px",
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 22, fontWeight: 800, color: scoreColor,
            fontFamily: "'DM Mono', monospace", lineHeight: 1,
          }}>{player.score}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>/ 100</div>
        </div>
      </div>

      {/* Confidence meter */}
      <ConfidenceMeter score={player.score} />

      {/* Stats row */}
      <div style={{
        display: "flex", gap: 16, marginTop: 12,
        padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.05)",
        borderBottom: mode === "props" ? "1px solid rgba(255,255,255,0.05)" : "none",
      }}>
        {[
          { label: "7D HIT%", val: `${Math.round(player.hitRate7 * 100)}%` },
          { label: "14D HIT%", val: `${Math.round(player.hitRate14 * 100)}%` },
          { label: "30D HIT%", val: `${Math.round(player.hitRate30 * 100)}%` },
          { label: "LINEUP", val: lineupLabel },
          { label: "PARK", val: player.parkFactor >= 1.1 ? "Hitter +" : player.parkFactor >= 1.0 ? "Neutral" : "Pitcher" },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center", minWidth: 52 }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace", letterSpacing: 0.5 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600, marginTop: 3 }}>
              {s.val}
            </div>
          </div>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>LAST 7G</div>
          <MiniStreak games={player.lastGames} />
        </div>
      </div>

      {/* Props section (props mode only) */}
      {mode === "props" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, fontFamily: "'DM Mono', monospace" }}>
            LIVE ODDS · RECOMMENDED PROPS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {player.props.map((p, i) => (
              <OddsChip key={i} prop={p} isRec={p.recommended} />
            ))}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
            ★ = 57 Killer recommended · Avg hits/game: <span style={{ color: "var(--text-secondary)" }}>{player.avgHits}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FiftySevenKiller() {
  const [mode, setMode] = useState("bts"); // "bts" | "props"
  const [selected, setSelected] = useState([]);
  const [minScore, setMinScore] = useState(82);
  const [today] = useState(new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  }));

  const filtered = MOCK_PLAYERS.filter(p => p.score >= minScore);

  const handleSelect = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) :
      prev.length < 2 ? [...prev, id] : [prev[1], id]
    );
  };

  const topScore = filtered[0]?.score || 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-primary, #0d1117)",
      color: "var(--text-primary, #f0f6fc)",
      fontFamily: "'Inter', system-ui, sans-serif",
      paddingBottom: 80,
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "28px 20px 0",
        maxWidth: 860, margin: "0 auto",
      }}>
        {/* Title block */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{
                background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                borderRadius: 8, padding: "4px 10px",
                fontSize: 11, fontWeight: 800, color: "#000",
                fontFamily: "'DM Mono', monospace", letterSpacing: 1.5,
              }}>57 KILLER</div>
              <div style={{
                fontSize: 10, color: "#10b981",
                fontFamily: "'DM Mono', monospace",
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.2)",
                padding: "2px 8px", borderRadius: 4,
              }}>BETA</div>
            </div>
            <h1 style={{
              margin: 0, fontSize: "clamp(22px, 4vw, 30px)",
              fontWeight: 800, color: "var(--text-primary)",
              letterSpacing: -0.5,
            }}>
              Advanced Hit Probability Engine
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)", maxWidth: 500 }}>
              Multi-factor composite model — lineup position, rolling hit rates, PA probability, park factors & pitcher profile. Min threshold: {minScore}%.
            </p>
          </div>

          {/* Top confidence callout */}
          <div style={{
            background: "linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.05))",
            border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 12, padding: "12px 16px", textAlign: "center", minWidth: 110,
          }}>
            <div style={{ fontSize: 10, color: "#fbbf24", fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>
              TOP SCORE
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#fbbf24", fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
              {topScore}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>/ 100 today</div>
          </div>
        </div>

        {/* Date + algo badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginTop: 16, paddingBottom: 16,
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{today}</span>
          <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
          {Object.entries({ "Lineup Pos": "30%", "Rolling HR": "25%", "PA Prob": "20%", "Park": "10%", "K%": "10%", "Home": "5%" }).map(([k, v]) => (
            <span key={k} style={{
              fontSize: 10, color: "var(--text-muted)",
              fontFamily: "'DM Mono', monospace",
              background: "rgba(255,255,255,0.05)",
              padding: "2px 6px", borderRadius: 4,
            }}>{k}: {v}</span>
          ))}
        </div>

        {/* Mode toggle + threshold */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, marginTop: 16, marginBottom: 20, flexWrap: "wrap",
        }}>
          {/* Mode toggle */}
          <div style={{
            display: "flex", gap: 2, padding: 3,
            background: "rgba(255,255,255,0.05)",
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)",
          }}>
            {[
              { key: "bts", label: "⚾ BTS Mode" },
              { key: "props", label: "📊 Props / DFS" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setMode(key)} style={{
                padding: "8px 18px", borderRadius: 8,
                background: mode === key
                  ? key === "bts"
                    ? "linear-gradient(135deg, rgba(16,185,129,0.25), rgba(16,185,129,0.15))"
                    : "linear-gradient(135deg, rgba(96,165,250,0.25), rgba(96,165,250,0.15))"
                  : "transparent",
                border: mode === key
                  ? `1px solid ${key === "bts" ? "rgba(16,185,129,0.4)" : "rgba(96,165,250,0.4)"}`
                  : "1px solid transparent",
                color: mode === key
                  ? key === "bts" ? "#10b981" : "#60a5fa"
                  : "var(--text-muted)",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                transition: "all 0.2s",
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* Min threshold slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
              MIN CONF:
            </span>
            {[80, 82, 85, 88, 90].map(v => (
              <button key={v} onClick={() => setMinScore(v)} style={{
                padding: "4px 8px", borderRadius: 6, fontSize: 11,
                background: minScore === v ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${minScore === v ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.08)"}`,
                color: minScore === v ? "#fbbf24" : "var(--text-muted)",
                cursor: "pointer", fontFamily: "'DM Mono', monospace",
              }}>{v}%</button>
            ))}
          </div>
        </div>

        {/* Selection tray */}
        {selected.length > 0 && (
          <div style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(6,182,212,0.06))",
            border: "1px solid rgba(16,185,129,0.25)",
            borderRadius: 12, padding: "12px 16px",
            marginBottom: 16, display: "flex", alignItems: "center",
            justifyContent: "space-between", flexWrap: "wrap", gap: 8,
          }}>
            <div style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>
              {selected.length === 1 ? "1 pick selected" : "2 picks selected (double-down)"}
              {" · "}
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                {MOCK_PLAYERS.filter(p => selected.includes(p.id)).map(p => p.name).join(" & ")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12,
                background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)",
                color: "#10b981", cursor: "pointer", fontWeight: 600,
              }}>
                Add to BTS Tracker
              </button>
              <button onClick={() => setSelected([])} style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 12,
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-muted)", cursor: "pointer",
              }}>Clear</button>
            </div>
          </div>
        )}

        {/* Props mode info banner */}
        {mode === "props" && (
          <div style={{
            background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.2)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 16,
            fontSize: 12, color: "var(--text-muted)",
          }}>
            📊 <strong style={{ color: "#60a5fa" }}>Props / DFS Mode</strong> — Live odds shown where available.
            ★ Starred props are 57 Killer's highest-confidence line for each player.
            Odds sourced via connected sportsbook feed. Always verify before placing.
          </div>
        )}

        {/* BTS mode info banner */}
        {mode === "bts" && (
          <div style={{
            background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 16,
            fontSize: 12, color: "var(--text-muted)",
          }}>
            ⚾ <strong style={{ color: "#fbbf24" }}>BTS Mode</strong> — Select up to 2 players for streak tracking.
            57 Killer prioritizes lineup position (1-2 hole) and high contact profiles. Only players scoring {minScore}%+ are shown.
          </div>
        )}

        {/* Player count */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          Showing <strong style={{ color: "var(--text-primary)" }}>{filtered.length}</strong> players above {minScore}% confidence today
          {mode === "bts" && (
            <span style={{ marginLeft: 8, color: "rgba(255,255,255,0.3)" }}>· Click to select up to 2 picks</span>
          )}
        </div>

        {/* Player cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((player, i) => (
            <PlayerCard57
              key={player.id}
              player={player}
              rank={i + 1}
              mode={mode}
              selected={selected.includes(player.id)}
              onSelect={handleSelect}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{
              textAlign: "center", padding: "60px 20px",
              color: "var(--text-muted)", fontSize: 14,
            }}>
              No players meet the {minScore}% confidence threshold today.<br />
              <button onClick={() => setMinScore(80)} style={{
                marginTop: 12, padding: "8px 16px", borderRadius: 8,
                background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
                color: "#fbbf24", cursor: "pointer", fontSize: 12,
              }}>Lower to 80%</button>
            </div>
          )}
        </div>

        {/* Footer disclaimer */}
        <div style={{
          marginTop: 32, padding: "16px", borderRadius: 10,
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
          fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          <strong style={{ color: "var(--text-secondary)" }}>57 Killer Algorithm</strong> — Composite scoring: Lineup Position (30%) · Rolling Hit Rate 7/14/30d (25%) · PA Probability (20%) · Park Factor (10%) · Pitcher K% Inverse (10%) · Home/Road Risk (5%). 
          Minimum confidence threshold {minScore}%. For entertainment and informational purposes. 
          Past performance does not guarantee future results. Props odds are estimates — verify with your sportsbook.
        </div>
      </div>
    </div>
  );
}
