// /src/components/BackTesterAlgoToggle.jsx
// Drop this into your existing BackTester page — replaces/augments the existing algo selector
// Connects BTS simulation to either IQ Picks algo, 57 Killer algo, or split-view both

import { useState } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const ALGO_MODES = [
  { key: "iq",    label: "IQ Picks",  color: "#10b981", icon: "⬥" },
  { key: "57k",   label: "57 Killer", color: "#fbbf24", icon: "◆" },
  { key: "both",  label: "Both",      color: "#60a5fa", icon: "⇄"  },
];

const PICK_COUNTS = [
  { val: 1, label: "Top 1" },
  { val: 2, label: "Top 2" },
];

// ─── BTS Reminder Banner ──────────────────────────────────────────────────────
function BTSReminder({ algoMode, pickCount }) {
  const showWarning = pickCount === 2 && algoMode === "both";
  return (
    <div style={{
      borderRadius: 10, padding: "10px 14px", marginBottom: 16,
      background: showWarning
        ? "rgba(251,191,36,0.07)"
        : "rgba(96,165,250,0.05)",
      border: `1px solid ${showWarning ? "rgba(251,191,36,0.25)" : "rgba(96,165,250,0.15)"}`,
      fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
    }}>
      {showWarning ? (
        <>
          ⚠️ <strong style={{ color: "#fbbf24" }}>Heads up:</strong>{" "}
          Running "Both" with Top 2 means 4 active picks per day — this is not representative of standard BTS scoring (max 2 picks).
          For accurate BTS streak simulation, use <strong style={{ color: "var(--text-primary)" }}>Top 1 or Top 2 per algorithm independently</strong>.
        </>
      ) : (
        <>
          ℹ️ <strong style={{ color: "#60a5fa" }}>BTS Accuracy Note:</strong>{" "}
          For results representative of real Beat the Streak scoring, run the back test on <strong style={{ color: "var(--text-primary)" }}>Top 1 or Top 2 picks only</strong> per algo.
          {algoMode === "both" && " Both mode tracks each algo's streak independently — they do not share picks."}
        </>
      )}
    </div>
  );
}

// ─── Split streak display for "Both" mode ────────────────────────────────────
function SplitStreakRow({ iqResult, killerResult }) {
  const cols = [
    { algo: "IQ Picks",  res: iqResult,     color: "#10b981" },
    { algo: "57 Killer", res: killerResult,  color: "#fbbf24" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
      {cols.map(({ algo, res, color }) => (
        <div key={algo} style={{
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${color}22`,
          borderRadius: 10, padding: "10px 14px",
        }}>
          <div style={{ fontSize: 10, color, fontFamily: "'DM Mono', monospace", marginBottom: 6 }}>
            {algo}
          </div>
          {res ? (
            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>STREAK</div>
                <div style={{ fontSize: 20, fontWeight: 800, color }}>{res.streak}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>WIN%</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>
                  {res.winPct}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>MAX STREAK</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-secondary)" }}>
                  {res.maxStreak}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Run to see results</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Toggle Component ────────────────────────────────────────────────────
export default function BackTesterAlgoToggle({
  onAlgoChange,       // (algoMode, pickCount) => void — call your existing BT logic
  iqResults,          // { streak, winPct, maxStreak } | null
  killerResults,      // { streak, winPct, maxStreak } | null
}) {
  const [algoMode, setAlgoMode] = useState("iq");
  const [pickCount, setPickCount] = useState(1);

  const handleAlgoChange = (mode) => {
    setAlgoMode(mode);
    onAlgoChange?.(mode, pickCount);
  };

  const handlePickChange = (count) => {
    setPickCount(count);
    onAlgoChange?.(algoMode, count);
  };

  const activeAlgo = ALGO_MODES.find(a => a.key === algoMode);

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Section label */}
      <div style={{
        fontSize: 10, color: "var(--text-muted)",
        fontFamily: "'DM Mono', monospace", letterSpacing: 1,
        marginBottom: 10,
      }}>
        ALGORITHM & PICK SETTINGS
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {/* Algo selector */}
        <div style={{
          display: "flex", gap: 2, padding: 3,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {ALGO_MODES.map(({ key, label, color, icon }) => (
            <button key={key} onClick={() => handleAlgoChange(key)} style={{
              padding: "8px 16px", borderRadius: 8,
              background: algoMode === key
                ? `linear-gradient(135deg, ${color}22, ${color}11)`
                : "transparent",
              border: algoMode === key
                ? `1px solid ${color}44`
                : "1px solid transparent",
              color: algoMode === key ? color : "var(--text-muted)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ fontSize: 10 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Pick count selector */}
        <div style={{
          display: "flex", gap: 2, padding: 3,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {PICK_COUNTS.map(({ val, label }) => (
            <button key={val} onClick={() => handlePickChange(val)} style={{
              padding: "8px 16px", borderRadius: 8,
              background: pickCount === val
                ? `linear-gradient(135deg, ${activeAlgo.color}22, ${activeAlgo.color}11)`
                : "transparent",
              border: pickCount === val
                ? `1px solid ${activeAlgo.color}44`
                : "1px solid transparent",
              color: pickCount === val ? activeAlgo.color : "var(--text-muted)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Active config badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10, fontSize: 12, color: "var(--text-muted)",
        }}>
          Running:
          <span style={{ color: activeAlgo.color, fontWeight: 700 }}>
            {activeAlgo.label}
          </span>
          ·
          <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
            Top {pickCount} pick{pickCount > 1 ? "s" : ""}
          </span>
          {algoMode === "both" && (
            <span style={{
              fontSize: 9, marginLeft: 4,
              background: "rgba(96,165,250,0.1)",
              border: "1px solid rgba(96,165,250,0.25)",
              color: "#60a5fa", padding: "1px 5px", borderRadius: 4,
              fontFamily: "'DM Mono', monospace",
            }}>
              INDEPENDENT STREAKS
            </span>
          )}
        </div>
      </div>

      {/* BTS accuracy reminder */}
      <BTSReminder algoMode={algoMode} pickCount={pickCount} />

      {/* Split view results (Both mode only) */}
      {algoMode === "both" && (
        <SplitStreakRow iqResult={iqResults} killerResult={killerResults} />
      )}
    </div>
  );
}
