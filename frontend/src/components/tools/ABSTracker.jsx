import { useState, useEffect } from "react";
import { fetchABSForDate, headshot } from "../../utils/mlbApi";

const PLATE_W = 17 / 12;
const HALF_PLATE = PLATE_W / 2;

export default function ABSTracker() {
  const [date, setDate]         = useState(new Date().toISOString().split("T")[0]);
  const [games, setGames]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [view, setView]         = useState("games");
  const [selectedChallenge, setSelectedChallenge] = useState(null);

  useEffect(() => { load(); }, [date]);

  async function load() {
    setLoading(true);
    try { setGames(await fetchABSForDate(date)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const allChallenges = games.flatMap(g =>
    g.challenges.map(c => ({ ...c, homeAbbr: g.homeAbbr, awayAbbr: g.awayAbbr, venue: g.venue, gamePk: g.gamePk, gameUmpire: g.umpire || c.umpire }))
  );

  function buildBoard(key) {
    const map = {};
    for (const c of allChallenges) {
      const p = key === "umpire" ? (c.gameUmpire || c.umpire) : c[key];
      if (!p || (!p.id && !p.name)) continue;
      const uid = p.id || p.name;
      if (!map[uid]) map[uid] = { id: p.id, name: p.name, total: 0, won: 0, lost: 0, unknown: 0, challenges: [] };
      if (key === "umpire") {
        map[uid].total++;
        if (c.challengeResult === "upheld") map[uid].won++;
        else if (c.challengeResult === "overturned") map[uid].lost++;
        else map[uid].unknown++;
        map[uid].challenges.push(c);
      } else {
        const isBatter = key === "batter" && c.challengerSide === "offense";
        const isPitcher = key === "pitcher" && c.challengerSide === "defense";
        if (isBatter || isPitcher) {
          map[uid].total++;
          if (c.challengeResult === "overturned") map[uid].won++;
          else if (c.challengeResult === "upheld") map[uid].lost++;
          else map[uid].unknown++;
          map[uid].challenges.push(c);
        }
      }
    }
    return Object.values(map).filter(p => p.total > 0).sort((a, b) => b.total - a.total);
  }

  const batterBoard = buildBoard("batter");
  const pitcherBoard = buildBoard("pitcher");
  const umpireBoard = buildBoard("umpire");

  const total = allChallenges.length;
  const overturned = allChallenges.filter(c => c.challengeResult === "overturned").length;
  const upheld = allChallenges.filter(c => c.challengeResult === "upheld").length;
  const offenseC = allChallenges.filter(c => c.challengerSide === "offense").length;
  const defenseC = allChallenges.filter(c => c.challengerSide === "defense").length;
  const dists = allChallenges.filter(c => c.distFromZone != null);
  const avgDist = dists.length ? (dists.reduce((s, c) => s + Math.abs(c.distFromZone), 0) / dists.length) : 0;

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">ABS Challenge Tracker</h1>
          <p className="page-subtitle">Track challenges by batters, pitchers, and umpires with pitch location visuals</p>
        </div>
        <div className="page-actions">
          <input type="date" className="filter-input" value={date} onChange={e => setDate(e.target.value)} style={{ height: 36, fontSize: 13 }} />
          <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>
            <span className="material-icons">refresh</span>{loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {!loading && total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 18 }}>
          <StatCard label="Challenges" value={total} icon="gavel" />
          <StatCard label="Overturned" value={overturned} icon="check_circle" color="var(--green-light)" />
          <StatCard label="Upheld" value={upheld} icon="cancel" color="var(--red-data)" />
          <StatCard label="Overturn %" value={total ? Math.round((overturned / (overturned + upheld || 1)) * 100) + "%" : "\u2014"} icon="percent" color="var(--yellow)" />
          <StatCard label="By Batters" value={offenseC} icon="sports_baseball" />
          <StatCard label="By Defense" value={defenseC} icon="shield" />
          <StatCard label="Avg Distance" value={(avgDist * 12).toFixed(1) + "\u2033"} icon="straighten" />
        </div>
      )}

      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="chip-group">
          {[["games","By Game"],["batters","Batters"],["pitchers","Pitchers"],["umpires","Umpires"]].map(([id, label]) => (
            <button key={id} className={"chip " + (view === id ? "active" : "")} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>{games.length} games \u00B7 {total} challenges</span>
      </div>

      {loading && (
        <div className="card" style={{ padding: 20, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 10px" }} />
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading play-by-play data...</div>
        </div>
      )}

      {!loading && total === 0 && (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">gavel</span></div>
          <div className="empty-title">No ABS challenges found</div>
          <div className="empty-sub">{date >= "2026-03-20" ? "No challenges recorded for this date." : "ABS Challenges debut in the 2026 regular season."}</div>
        </div>
      )}

      {!loading && view === "games" && total > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {games.filter(g => g.challenges.length > 0).map(g => (
            <div className="card" key={g.gamePk} style={{ padding: 0 }}>
              <div className="card-header">
                <span className="card-title">
                  <span className="material-icons">stadium</span>
                  {g.awayAbbr} @ {g.homeAbbr}
                  <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 11 }}>HP: {g.umpire && g.umpire.name ? g.umpire.name : "?"} \u00B7 {g.status}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.challenges.length} challenge{g.challenges.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 1, background: "var(--border)" }}>
                {g.challenges.map((c, ci) => (
                  <ChallengeCard key={ci} challenge={c} onClick={() => setSelectedChallenge({ ...c, gameUmpire: g.umpire })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && view === "batters" && <LeaderboardTable title="Batter Challenges" subtitle="Challenges initiated by batters" icon="sports_baseball" board={batterBoard} roleLabel="Batter" />}
      {!loading && view === "pitchers" && <LeaderboardTable title="Pitcher / Catcher Challenges" subtitle="Challenges initiated by the defensive side" icon="shield" board={pitcherBoard} roleLabel="Pitcher" />}
      {!loading && view === "umpires" && <LeaderboardTable title="Umpire Scorecard" subtitle="Lower overturn % = better accuracy" icon="visibility" board={umpireBoard} roleLabel="Umpire" isUmpire />}

      {selectedChallenge && <ChallengeDetail challenge={selectedChallenge} onClose={() => setSelectedChallenge(null)} />}
    </div>
  );
}

function LeaderboardTable({ title, subtitle, icon, board, roleLabel, isUmpire }) {
  if (!board.length) return (
    <div className="empty-state">
      <div className="empty-icon"><span className="material-icons">{icon}</span></div>
      <div className="empty-title">No {roleLabel.toLowerCase()} challenges yet</div>
    </div>
  );
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="card-header">
        <span className="card-title"><span className="material-icons">{icon}</span>{title}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{subtitle}</span>
      </div>
      <div className="table-wrap"><table><thead><tr>
        <th style={{ width: 32 }}>#</th><th style={{ width: 36 }}></th><th>{roleLabel}</th>
        <th>Total</th><th>{isUmpire ? "Upheld" : "Won"}</th><th>{isUmpire ? "Overturned" : "Lost"}</th>
        <th>{isUmpire ? "Accuracy" : "Success %"}</th><th>Avg Dist</th>
      </tr></thead><tbody>
        {board.slice(0, 50).map((p, i) => {
          var pct = p.won + p.lost > 0 ? Math.round((p.won / (p.won + p.lost)) * 100) : null;
          var ad = p.challenges.filter(function(c) { return c.distFromZone != null; });
          var pAvgDist = ad.length ? (ad.reduce(function(s, c) { return s + Math.abs(c.distFromZone); }, 0) / ad.length) : null;
          var distIn = pAvgDist != null ? (pAvgDist * 12).toFixed(1) : null;
          return (
            <tr key={p.id || p.name || i}>
              <td style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>{i + 1}</td>
              <td style={{ padding: "6px 8px" }}>
                {p.id ? (
                  <img src={headshot(p.id)} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", background: "var(--surface-2)" }}
                    onError={function(e) { e.target.style.display = "none"; }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="material-icons" style={{ fontSize: 14, color: "var(--text-muted)" }}>person</span>
                  </div>
                )}
              </td>
              <td><span style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</span></td>
              <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{p.total}</td>
              <td style={{ fontFamily: "var(--font-mono)", color: "var(--green-light)" }}>{p.won}</td>
              <td style={{ fontFamily: "var(--font-mono)", color: "var(--red-data)" }}>{p.lost}</td>
              <td>{pct !== null ? <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14, color: isUmpire ? (pct >= 70 ? "var(--green-light)" : pct >= 50 ? "var(--yellow)" : "var(--red-data)") : (pct >= 60 ? "var(--green-light)" : pct >= 40 ? "var(--yellow)" : "var(--red-data)") }}>{pct}%</span> : "\u2014"}</td>
              <td>{distIn != null ? <DistanceBadge inches={Number(distIn)} /> : <span style={{ color: "var(--text-muted)" }}>{"\u2014"}</span>}</td>
            </tr>
          );
        })}
      </tbody></table></div>
    </div>
  );
}

function DistanceBadge({ inches }) {
  var absIn = Math.abs(inches);
  var color = "var(--green-light)";
  var bg = "rgba(34,197,94,0.1)";
  if (absIn < 1) { color = "var(--red-data)"; bg = "rgba(239,68,68,0.1)"; }
  else if (absIn < 2) { color = "var(--yellow)"; bg = "rgba(251,191,36,0.1)"; }
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: color, background: bg, padding: "2px 8px", borderRadius: 5 }}>
      {inches.toFixed(1)}<span style={{ fontSize: 9, opacity: 0.7 }}>{"\u2033"}</span>
    </span>
  );
}

function ChallengeCard({ challenge: c, onClick }) {
  var resultColor = c.challengeResult === "overturned" ? "var(--green-light)" : c.challengeResult === "upheld" ? "var(--red-data)" : "var(--text-muted)";
  var resultLabel = c.challengeResult === "overturned" ? "OVERTURNED" : c.challengeResult === "upheld" ? "UPHELD" : "PENDING";
  var distInches = c.distFromZone != null ? Math.abs(c.distFromZone * 12) : null;
  return (
    <div style={{ background: "var(--surface)", padding: 16, cursor: "pointer", transition: "background 0.15s" }}
      onClick={onClick} onMouseEnter={function(e) { e.currentTarget.style.background = "var(--surface-2)"; }} onMouseLeave={function(e) { e.currentTarget.style.background = "var(--surface)"; }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <StrikeZoneSVG pX={c.pX} pZ={c.pZ} szTop={c.szTop} szBot={c.szBot} result={c.challengeResult} size={100} showDist />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", color: resultColor }}>{resultLabel}</span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{"\u00B7"} Inn {c.inning} {c.halfInning}</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.batter.name} vs {c.pitcher.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            {c.pitchType} {"\u00B7"} {c.speed ? c.speed + " mph" : ""} {"\u00B7"} Count: {c.count ? c.count.balls : "?"}-{c.count ? c.count.strikes : "?"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className={"badge " + (c.challengerSide === "offense" ? "badge-navy" : "badge-gray")} style={{ fontSize: 9 }}>
              {c.challengerSide === "offense" ? "Batter" : "Defense"}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Call: <strong>{c.isOriginalStrike ? "Strike" : "Ball"}</strong></span>
            {distInches != null && <DistanceBadge inches={distInches} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function StrikeZoneSVG({ pX, pZ, szTop, szBot, result, size, showDist }) {
  size = size || 160;
  if (pX == null || pZ == null || szTop == null || szBot == null) {
    return (
      <div style={{ width: size, height: size, background: "var(--surface-2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No data</span>
      </div>
    );
  }
  var zoneMidY = (szTop + szBot) / 2;
  var viewW = 3.4, viewH = 4.6;
  var vbX = -viewW / 2, vbY = zoneMidY - viewH / 2;
  var pitchColor = result === "overturned" ? "#22C55E" : result === "upheld" ? "#EF4444" : "#FBBF24";
  var ballR = 1.457 / 12;
  var zoneW = PLATE_W, zoneH = szTop - szBot;
  var thirdW = zoneW / 3, thirdH = zoneH / 3;

  var nearEdge = null;
  if (showDist && (Math.abs(pX) > HALF_PLATE || pZ > szTop || pZ < szBot)) {
    nearEdge = {
      x: Math.max(-HALF_PLATE, Math.min(HALF_PLATE, pX)),
      z: Math.max(szBot, Math.min(szTop, pZ))
    };
  }
  var distInches = nearEdge ? (Math.sqrt(Math.pow(pX - nearEdge.x, 2) + Math.pow(pZ - nearEdge.z, 2)) * 12).toFixed(1) : null;

  return (
    <svg width={size} height={size} viewBox={vbX + " " + vbY + " " + viewW + " " + viewH}
      style={{ background: "var(--surface-2)", borderRadius: 6, flexShrink: 0, transform: "scaleY(-1)" }}>
      <rect x={-HALF_PLATE} y={szBot} width={zoneW} height={zoneH}
        fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.30)" strokeWidth={0.015} />
      {[1, 2].map(function(i) { return (
        <line key={"v" + i} x1={-HALF_PLATE + thirdW * i} y1={szBot} x2={-HALF_PLATE + thirdW * i} y2={szTop} stroke="rgba(255,255,255,0.05)" strokeWidth={0.008} />
      ); })}
      {[1, 2].map(function(i) { return (
        <line key={"h" + i} x1={-HALF_PLATE} y1={szBot + thirdH * i} x2={HALF_PLATE} y2={szBot + thirdH * i} stroke="rgba(255,255,255,0.05)" strokeWidth={0.008} />
      ); })}
      <polygon points={(-HALF_PLATE) + "," + (szBot - 0.12) + " " + HALF_PLATE + "," + (szBot - 0.12) + " " + HALF_PLATE + "," + (szBot - 0.22) + " 0," + (szBot - 0.40) + " " + (-HALF_PLATE) + "," + (szBot - 0.22)}
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" strokeWidth={0.012} />
      {nearEdge && (
        <g>
          <line x1={pX} y1={pZ} x2={nearEdge.x} y2={nearEdge.z} stroke="rgba(255,255,255,0.5)" strokeWidth={0.012} strokeDasharray="0.03 0.02" />
          <g transform={"translate(" + ((pX + nearEdge.x) / 2) + "," + ((pZ + nearEdge.z) / 2) + ") scale(1,-1)"}>
            <text x={0} y={0} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={0.16} fontWeight="bold" fontFamily="system-ui">
              {distInches + "\u2033"}
            </text>
          </g>
        </g>
      )}
      <circle cx={pX} cy={pZ} r={ballR * 3} fill={pitchColor} fillOpacity={0.12} />
      <circle cx={pX} cy={pZ} r={ballR} fill={pitchColor} fillOpacity={0.9} stroke="white" strokeWidth={0.015} />
    </svg>
  );
}

function ChallengeDetail({ challenge: c, onClose }) {
  var resultColor = c.challengeResult === "overturned" ? "var(--green-light)" : c.challengeResult === "upheld" ? "var(--red-data)" : "var(--yellow)";
  var resultLabel = c.challengeResult === "overturned" ? "OVERTURNED" : c.challengeResult === "upheld" ? "UPHELD" : "PENDING";
  var distInches = c.distFromZone != null ? Math.abs(c.distFromZone * 12) : null;
  var umpName = (c.gameUmpire && c.gameUmpire.name) || (c.umpire && c.umpire.name) || "\u2014";
  return (
    <div className="add-pick-modal-overlay" onClick={function(e) { if (e.target === e.currentTarget) onClose(); }}>
      <div className="add-pick-modal" style={{ maxWidth: 500 }}>
        <div className="add-pick-modal-header" style={{ background: "var(--navy)" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "white" }}>ABS Challenge Detail</span>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div className="add-pick-modal-body" style={{ alignItems: "center" }}>
          <StrikeZoneSVG pX={c.pX} pZ={c.pZ} szTop={c.szTop} szBot={c.szBot} result={c.challengeResult} size={240} showDist />
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "1.5px", color: resultColor }}>{resultLabel}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              Original: <strong>{c.isOriginalStrike ? "Strike" : "Ball"}</strong>
              {c.challengeResult === "overturned" ? " \u2192 " : ""}
              {c.challengeResult === "overturned" ? <strong>{c.isOriginalStrike ? "Ball" : "Strike"}</strong> : null}
            </div>
            {distInches != null && (
              <div style={{ marginTop: 6 }}>
                <DistanceBadge inches={distInches} />
                <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                  {c.distFromZone > 0 ? "from zone edge" : "inside zone"}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", width: "100%", justifyContent: "center" }}>
            <PlayerChip id={c.batter.id} name={c.batter.name} sub={"Batter \u00B7 " + c.batSide + "HB"} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>vs</span>
            <PlayerChip id={c.pitcher.id} name={c.pitcher.name} sub={"Pitcher \u00B7 " + c.pitchHand + "HP"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
            <DetailItem label="Inning" value={(c.halfInning === "top" ? "Top" : "Bot") + " " + c.inning} />
            <DetailItem label="Count" value={(c.count ? c.count.balls : "?") + "-" + (c.count ? c.count.strikes : "?")} />
            <DetailItem label="Pitch Type" value={c.pitchType} />
            <DetailItem label="Velocity" value={c.speed ? c.speed + " mph" : "\u2014"} />
            <DetailItem label="Challenger" value={c.challengerSide === "offense" ? "Offense (Batter)" : "Defense (Catcher/Pitcher)"} />
            <DetailItem label="HP Umpire" value={umpName} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerChip({ id, name, sub }) {
  return (
    <div style={{ textAlign: "center" }}>
      <img src={headshot(id)} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", background: "var(--surface-2)" }}
        onError={function(e) { e.target.style.display = "none"; }} />
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 3 }}>{name}</div>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{sub}</div>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{value}</div>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className="card" style={{ padding: "12px 14px", textAlign: "center" }}>
      <span className="material-icons" style={{ fontSize: 16, color: color || "var(--text-muted)", display: "block", marginBottom: 2 }}>{icon}</span>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: color || "var(--text-primary)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 3 }}>{label}</div>
    </div>
  );
}
