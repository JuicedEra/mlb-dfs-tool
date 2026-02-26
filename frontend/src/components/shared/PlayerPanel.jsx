import { useState, useEffect } from "react";
import {
  fetchGameLog, fetchBvP, fetchPlatoonSplits, fetchHomeAwaySplits, fetchDayNightSplits,
  fetchSeasonStats, fetchStatcastForPlayer,
  computeSplit, computeActiveStreak, PARK_FACTORS, avgColor, scoreColor,
  isPlayerHot, headshot,
} from "../../utils/mlbApi";
import { openAddPick } from "../tools/PickTracker";

const SEASON = new Date().getFullYear();

export default function PlayerPanel({ pick, onClose, showBvP = true }) {
  const { batter, pitcher, game, scoreData } = pick;
  const [gamelog, setGamelog]   = useState([]);
  const [bvp, setBvp]           = useState(null);
  const [platoon, setPlatoon]   = useState({});
  const [homeaway, setHomeaway] = useState({});
  const [daynight, setDaynight] = useState({});
  const [season, setSeason]     = useState({});
  const [statcast, setStatcast] = useState(null);
  const [photoErr, setPhotoErr] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (!batter?.id) return;
    (async () => {
      setLoading(true);
      const [gl, bvpR, platR, haR, dnR, ssR, scR] = await Promise.allSettled([
        fetchGameLog(batter.id, SEASON),
        pitcher ? fetchBvP(batter.id, pitcher.id) : Promise.resolve(null),
        fetchPlatoonSplits(batter.id, SEASON),
        fetchHomeAwaySplits(batter.id, SEASON),
        fetchDayNightSplits(batter.id, SEASON),
        fetchSeasonStats(batter.id, SEASON),
        fetchStatcastForPlayer(batter.id, SEASON),
      ]);
      setGamelog(gl.value || []);
      setBvp(bvpR.value);
      setPlatoon(platR.value || {});
      setHomeaway(haR.value || {});
      setDaynight(dnR.value || {});
      setSeason(ssR.value || {});
      setStatcast(scR.value || null);
      setLoading(false);
    })();
  }, [batter?.id, pitcher?.id]);

  const l3  = computeSplit(gamelog, 3);
  const l7  = computeSplit(gamelog, 7);
  const l15 = computeSplit(gamelog, 15);
  const l30 = computeSplit(gamelog, 30);
  const streak = computeActiveStreak(gamelog);
  const hot    = isPlayerHot(streak, l7?.avg);
  const pf = PARK_FACTORS[game?.venue]?.factor || 100;
  const pitcherHand = pitcher?.hand || "R";
  const platoonKey = pitcherHand === "L" ? "vs. Left" : "vs. Right";

  const TABS = ["overview","splits","gamelog","bvp","statcast"];

  return (
    <div className="side-panel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="side-panel">
        {/* Header */}
        <div className="side-panel-header">
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              {/* Player photo */}
              <div className={`player-photo-wrap ${hot ? "hot" : ""}`} style={{ width: 56, height: 56, flexShrink: 0 }}>
                {!photoErr ? (
                  <img
                    src={headshot(batter.id)}
                    alt={batter.name}
                    className="player-photo"
                    style={{ width: 56, height: 56 }}
                    onError={() => setPhotoErr(true)}
                  />
                ) : (
                  <div className="player-avatar" style={{ width: 56, height: 56, fontSize: 18 }}>
                    {batter.name?.split(" ").map(w => w[0]).slice(0,2).join("") || "?"}
                  </div>
                )}
                {hot && (
                  <div className="flame-badge">
                    <span className="material-icons">local_fire_department</span>
                  </div>
                )}
              </div>
              <div>
                {scoreData && (
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 800, color: scoreColor(showBvP ? scoreData.withBvP : scoreData.withoutBvP), lineHeight: 1 }}>
                    {showBvP ? scoreData.withBvP : scoreData.withoutBvP}
                    <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.40)", marginLeft: 6 }}>score</span>
                  </span>
                )}
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "white", lineHeight: 1.2 }}>{batter.name}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.50)", marginTop: 2 }}>
                  {batter.batSide}HB · {game?.venue}
                  {pitcher && ` · vs ${pitcher.name} (${pitcher.hand}HP)`}
                </div>
              </div>
            </div>
            {scoreData && (
              <div className="factor-pills" style={{ marginTop: 6 }}>
                {scoreData.factors.map((f, i) => (
                  <span key={i} className={`factor-pill fp-${f.type}`}>
                    <span className="material-icons">{f.icon}</span>{f.label}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => openAddPick({
                playerName: batter.name,
                playerId: batter.id,
                team: pick.battingTeam?.abbr || "",
                opponent: pitcher?.name || "",
                date: game?.gameDate?.split("T")[0] || new Date().toISOString().split("T")[0],
                hitScore: scoreData ? (showBvP ? scoreData.withBvP : scoreData.withoutBvP) : null,
                prop: "1+ Hits",
                gamePk: game?.gamePk || null,
              })}
              style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "6px 14px", cursor: "pointer", color: "white", fontSize: 11, fontWeight: 700 }}>
              <span className="material-icons" style={{ fontSize: 14 }}>add_circle</span>
              Track This Pick
            </button>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--surface-2)", flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              style={{
                padding: "10px 16px", fontSize: 12, fontWeight: 600,
                color: activeTab === t ? "var(--navy)" : "var(--text-muted)",
                borderBottom: activeTab === t ? "2px solid var(--navy)" : "2px solid transparent",
                textTransform: "capitalize", transition: "all var(--transition)", whiteSpace: "nowrap",
              }}>
              {t === "bvp" ? "BvP History" : t === "statcast" ? "Statcast" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="side-panel-body">
          {loading ? (
            <div className="loading"><div className="spinner" />Loading player data...</div>
          ) : (
            <>
              {activeTab === "overview" && (
                <>
                  {streak > 0 && (
                    <div className="info-banner success" style={{ marginBottom: 16 }}>
                      <span className="material-icons">local_fire_department</span>
                      <strong>Active {streak}-game hit streak</strong>
                    </div>
                  )}
                  <div className="section-label">Recent Form</div>
                  <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 18 }}>
                    {[["L3 AVG", l3?.avg],["L7 AVG", l7?.avg],["L15 AVG", l15?.avg],["Season AVG", season?.avg]].map(([label, val]) => (
                      <div key={label} className="stat-box">
                        <div className="stat-box-label">{label}</div>
                        <div className="stat-box-val" style={{ color: val ? (parseFloat(val) >= 0.300 ? "var(--green-light)" : parseFloat(val) >= 0.265 ? "var(--yellow)" : parseFloat(val) >= 0.230 ? "var(--navy)" : "var(--red-data)") : "var(--text-muted)" }}>
                          {val || "—"}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="section-label">Today's Matchup Context</div>
                  <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
                    <div className="stat-box">
                      <div className="stat-box-label">vs {pitcherHand}HP (Platoon)</div>
                      <div className={`stat-box-val ${avgColor(platoon[platoonKey]?.avg) === "hot" ? "" : ""}`} style={{ color: "var(--navy)", fontSize: 20 }}>{platoon[platoonKey]?.avg || "—"}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-box-label">Park Factor</div>
                      <div className="stat-box-val" style={{ color: pf >= 108 ? "var(--green-light)" : pf <= 93 ? "var(--red-data)" : "var(--navy)" }}>{pf}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-box-label">{game?.isNight ? "Night" : "Day"} Game AVG</div>
                      <div className="stat-box-val" style={{ fontSize: 20, color: "var(--navy)" }}>
                        {(game?.isNight ? daynight["Night"]?.avg : daynight["Day"]?.avg) || "—"}
                      </div>
                    </div>
                  </div>

                  {scoreData && !scoreData.hasBvP && (
                    <div className="info-banner warn">
                      <span className="material-icons">info</span>
                      <div>
                        <strong>No BvP history</strong> vs {pitcher?.name}. Score shown with pitcher's season stats as proxy.
                        <div style={{ marginTop: 4 }}>
                          With BvP estimate: <strong>{scoreData.withBvP}</strong> · Without BvP proxy: <strong>{scoreData.withoutBvP}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === "splits" && (
                <>
                  {[["Platoon Splits", { "vs. Left": platoon["vs. Left"], "vs. Right": platoon["vs. Right"] }],
                    ["Home / Away", { "Home": homeaway["Home"], "Away": homeaway["Away"] }],
                    ["Day / Night", { "Day": daynight["Day"], "Night": daynight["Night"] }]
                  ].map(([title, data]) => (
                    <div key={title} style={{ marginBottom: 20 }}>
                      <div className="section-label">{title}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {Object.entries(data).map(([label, s]) => (
                          <div key={label} className="stat-box">
                            <div className="stat-box-label">{label}</div>
                            <div className="stat-box-val" style={{ fontSize: 22, color: "var(--navy)" }}>{s?.avg || "—"}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              OBP: {s?.obp || "—"} · SLG: {s?.slg || "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {activeTab === "gamelog" && (
                <>
                  <div className="section-label">Last 30 Games</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Date</th><th>Opp</th><th>H/A</th>
                          <th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gamelog.slice(0,30).map((g, i) => (
                          <tr key={i}>
                            <td className="td-mono" style={{ color: "var(--text-muted)" }}>{g.date}</td>
                            <td style={{ fontWeight: 500 }}>{g.opponent?.split(" ").slice(-1)[0]}</td>
                            <td><span className={`badge ${g.isHome ? "badge-navy" : "badge-gray"}`} style={{fontSize:9}}>{g.isHome ? "H":"A"}</span></td>
                            <td className="td-mono">{g.atBats}</td>
                            <td className="td-mono" style={{ fontWeight: 700, color: +g.hits > 0 ? "var(--green-light)" : undefined }}>{g.hits}</td>
                            <td className="td-mono" style={{ color: +g.homeRuns > 0 ? "var(--yellow)" : undefined }}>{g.homeRuns}</td>
                            <td className="td-mono">{g.rbi}</td>
                            <td className="td-mono">{g.baseOnBalls}</td>
                            <td className="td-mono" style={{ color: +g.strikeOuts >= 2 ? "var(--red-data)" : undefined }}>{g.strikeOuts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {activeTab === "bvp" && (
                <>
                  {bvp ? (
                    <>
                      <div className="info-banner success">
                        <span className="material-icons">check_circle</span>
                        Career BvP data available vs {pitcher?.name}
                      </div>
                      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                        {[["AVG",bvp.avg],["OBP",bvp.obp],["SLG",bvp.slg],["AB",bvp.atBats],["H",bvp.hits],["HR",bvp.homeRuns]].map(([l,v]) => (
                          <div key={l} className="stat-box">
                            <div className="stat-box-label">{l}</div>
                            <div className="stat-box-val" style={{ fontSize: 22, color: "var(--navy)" }}>{v || "—"}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon"><span className="material-icons">history_toggle_off</span></div>
                      <div className="empty-title">No BvP history</div>
                      <div className="empty-sub">
                        {batter.name} has fewer than 5 at-bats vs {pitcher?.name || "this pitcher"} in MLB history.
                        The algorithm uses the pitcher's season stats as a proxy.
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === "statcast" && (
                <>
                  {statcast ? (
                    <>
                      <div className="section-label">Expected Stats — {SEASON}</div>
                      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
                        {[
                          ["xBA",  statcast.xba  ? parseFloat(statcast.xba).toFixed(3)  : null],
                          ["xSLG", statcast.xslg ? parseFloat(statcast.xslg).toFixed(3) : null],
                          ["xwOBA",statcast.xwoba? parseFloat(statcast.xwoba).toFixed(3): null],
                        ].map(([label, val]) => (
                          <div key={label} className="stat-box">
                            <div className="stat-box-label">{label}</div>
                            <div className="stat-box-val" style={{ fontSize: 22, color: val && parseFloat(val) >= 0.300 ? "var(--green-light)" : val && parseFloat(val) >= 0.230 ? "var(--navy)" : "var(--red-data)" }}>
                              {val || "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="section-label">Batted Ball Profile — {SEASON}</div>
                      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
                        {[
                          ["Exit Velo",   statcast.exit_velocity_avg  ? `${parseFloat(statcast.exit_velocity_avg).toFixed(1)} mph` : null],
                          ["Launch Angle",statcast.launch_angle_avg   ? `${parseFloat(statcast.launch_angle_avg).toFixed(1)}°`    : null],
                          ["Barrel %",    statcast.barrel_batted_rate ? `${parseFloat(statcast.barrel_batted_rate).toFixed(1)}%`  : null],
                          ["Hard Hit %",  statcast.hard_hit_percent   ? `${parseFloat(statcast.hard_hit_percent).toFixed(1)}%`   : null],
                          ["Whiff %",     statcast.whiff_percent      ? `${parseFloat(statcast.whiff_percent).toFixed(1)}%`      : null],
                          ["K%",          statcast.k_percent          ? `${parseFloat(statcast.k_percent).toFixed(1)}%`          : null],
                        ].map(([label, val]) => (
                          <div key={label} className="stat-box">
                            <div className="stat-box-label">{label}</div>
                            <div className="stat-box-val" style={{ fontSize: 18, color: "var(--navy)" }}>{val || "—"}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        Source: Baseball Savant · {statcast.pa || statcast.abs || "—"} PA
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon"><span className="material-icons">speed</span></div>
                      <div className="empty-title">No Statcast data</div>
                      <div className="empty-sub">
                        {batter.name} is not in the Baseball Savant leaderboard (min. 50 PA required).
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
