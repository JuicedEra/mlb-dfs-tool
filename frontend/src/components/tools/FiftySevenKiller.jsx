import { useState, useEffect } from "react";
// Integrating your existing utils
import { 
  fetchGames, 
  fetchRoster, 
  fetchAllLineups, 
  headshot 
} from "../../utils/mlbApi";
import { openAddPick } from "./PickTracker";

// ─── Algo weights (Restored from your working version) ─────────────────────
const WEIGHTS = {
  lineupPosition: 0.30,
  rollingHitRate: 0.25,
  paProb:         0.20,
  parkFactor:     0.10,
  pitcherKPct:    0.10,
  homeRisk:       0.05,
};

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

// ─── UI Components (Restored from your working version) ─────────────────────

function ConfidenceMeter({ score }) {
  const color = score >= 90 ? "#10b981" : score >= 85 ? "#34d399" : score >= 82 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontFamily: "'DM Mono', monospace" }}>
        <span>57K CONFIDENCE</span>
        <span style={{ color, fontWeight: 700 }}>{score}%</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: String(score) + "%", background: "linear-gradient(90deg, " + color + "99, " + color + ")", borderRadius: 99, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

function MiniStreak({ games }) {
  return (
    <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
      {games.map((g, i) => (
        <div key={i} style={{ width: 18, height: 18, borderRadius: 4, background: g ? "rgba(16,185,129,0.25)" : "rgba(248,113,113,0.2)", border: "1px solid " + (g ? "#10b98155" : "#f8717155"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: g ? "#10b981" : "#f87171", fontFamily: "'DM Mono', monospace" }}>
          {g ? "H" : "0"}
        </div>
      ))}
    </div>
  );
}

function PlayerCard57({ player, rank, mode, selected, onSelect }) {
  const isTop3 = rank <= 3;
  const rankColor = rank === 1 ? "#fbbf24" : rank === 2 ? "#94a3b8" : rank === 3 ? "#c97d4e" : "var(--text-muted)";
  const scoreColor = player.score >= 90 ? "#10b981" : player.score >= 85 ? "#34d399" : player.score >= 82 ? "#fbbf24" : "var(--text-muted)";

  return (
    <div onClick={() => onSelect(player.id)} style={{ background: selected ? "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.06) 100%)" : isTop3 ? "linear-gradient(135deg, rgba(251,191,36,0.05) 0%, rgba(255,255,255,0.03) 100%)" : "rgba(255,255,255,0.03)", border: selected ? "1px solid rgba(16,185,129,0.4)" : isTop3 ? "1px solid rgba(251,191,36,0.2)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", transition: "all 0.2s ease", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: rank <= 3 ? "linear-gradient(135deg, " + rankColor + "22, " + rankColor + "11)" : "rgba(255,255,255,0.05)", border: "1px solid " + rankColor + "44", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 13, color: rankColor }}>{rank}</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>{player.name}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{player.team} · {player.opp} · vs {player.pitcher}</div>
          </div>
        </div>
        <div style={{ textAlign: "center", background: scoreColor + "15", border: "1px solid " + scoreColor + "40", borderRadius: 10, padding: "6px 12px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{player.score}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>/ 100</div>
        </div>
      </div>
      <ConfidenceMeter score={player.score} />
      <div style={{ display: "flex", gap: 16, marginTop: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
         {[ { label: "7D HIT%", val: Math.round((player.hitRate7 || 0) * 100) + "%" }, { label: "PA PROB", val: Math.round((player.paProb || 0) * 100) + "%" }, { label: "LINEUP", val: "#" + (player.lineupPos || "TBD") } ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>{s.label}</div>
            <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{s.val}</div>
          </div>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>LAST 7G</div>
          <MiniStreak games={player.lastGames || [0,0,0,0,0,0,0]} />
        </div>
      </div>
    </div>
  );
}

export default function FiftySevenKiller() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [minScore, setMinScore] = useState(82);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        let gData = await fetchGames(selectedDate);
        if (!gData || gData.length === 0) gData = await fetchGames(); 

        const pool = [];
        const lineups = await fetchAllLineups(selectedDate).catch(() => []);

        await Promise.all(gData.map(async (game) => {
          const homeId = game.teams?.home?.team?.id;
          const awayId = game.teams?.away?.team?.id;
          if (!homeId || !awayId) return;

          const [hRost, aRost] = await Promise.all([fetchRoster(homeId), fetchRoster(awayId)]);

          const process = (r, isHome, oppPitcher, teamName, oppName) => {
            r.forEach(p => {
              const bId = p.person?.id || p.id;
              // Find lineup position from lineup data
              const lineupEntry = lineups.find(l => l.teamId === (isHome ? homeId : awayId));
              const pos = lineupEntry?.lineup?.findIndex(h => String(h.id) === String(bId)) + 1 || 5;

              const playerObj = {
                id: bId,
                name: p.person?.fullName || p.name,
                team: teamName,
                opp: (isHome ? "vs " : "@ ") + oppName,
                lineupPos: pos,
                pitcher: oppPitcher,
                isHome: isHome,
                // Mocking these for now as they require deep stats fetch
                hitRate7: 0.75, hitRate14: 0.70, hitRate30: 0.65,
                paProb: 0.90, parkFactor: 1.0, pitcherKPct: 0.20,
                lastGames: [1,1,0,1,1,0,1]
              };
              playerObj.score = compute57Score(playerObj);
              if (playerObj.score >= minScore) pool.push(playerObj);
            });
          };

          process(hRost, true, game.teams.away.probablePitcher?.fullName || "TBD", game.teams.home.team.name, game.teams.away.team.name);
          process(aRost, false, game.teams.home.probablePitcher?.fullName || "TBD", game.teams.away.team.name, game.teams.home.team.name);
        }));

        setPlayers(pool.sort((a, b) => b.score - a.score).slice(0, 10));
      } catch (e) { console.error(e); } finally { setLoading(false); }
    }
    loadData();
  }, [selectedDate, minScore]);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#f0f6fc", paddingBottom: 80 }}>
      <div style={{ padding: "28px 20px 0", maxWidth: 860, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800 }}>57 Killer</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Roster-level contact optimization</p>
          </div>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ background: "#161b22", color: "white", border: "1px solid #30363d", padding: "8px", borderRadius: "6px" }} />
        </header>

        {loading ? (
          <div style={{ textAlign: "center", padding: 100, color: "#8b949e" }}>ANALYZING ROSTERS...</div>
        ) : players.length === 0 ? (
          <div style={{ textAlign: "center", padding: 100, background: "#161b22", borderRadius: 20 }}>No players meet {minScore}% threshold.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {players.map((p, i) => (
              <PlayerCard57 key={p.id} player={p} rank={i + 1} mode="bts" onSelect={() => openAddPick(p)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
