import { useState, useEffect, useRef, useCallback } from "react";
import { fetchGames, fetchRoster, searchPlayers, headshot, fetchGameLog, fetchSeasonStats, computeSplit, computeActiveStreak } from "../../utils/mlbApi";
import { dbLoadPicks, dbSavePick, dbUpdatePickResult, dbDeletePick, getEquippedEmoji } from "../../utils/supabase";
import { useAuth } from "../../contexts/AuthContext";

const STORAGE_KEY  = "diamondiq_picks_v1";
const MAX_PICKS_PER_DAY = 2;
const PROP_TYPES   = ["1+ Hits (BTS)", "2+ Hits", "1+ Home Runs", "1+ Total Bases", "2+ Total Bases", "Custom"];

function loadPicks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function savePicks(picks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
}

// Fetch detailed box score for a game — returns player stats map
async function fetchBoxScore(gamePk) {
  try {
    const r = await fetch(`/mlb-proxy/game/${gamePk}/boxscore`);
    if (!r.ok) return null;
    const data = await r.json();
    const result = {};
    for (const side of ["home", "away"]) {
      const players = data.teams?.[side]?.players || {};
      for (const [, p] of Object.entries(players)) {
        const id = p.person?.id;
        if (!id) continue;
        const s = p.stats?.batting || {};
        result[id] = {
          hits:        Number(s.hits        || 0),
          atBats:      Number(s.atBats      || 0),
          totalBases:  Number(s.totalBases  || 0),
          homeRuns:    Number(s.homeRuns    || 0),
          name:        p.person?.fullName || "",
        };
      }
    }
    // Also grab game status for postponement detection
    result._gameStatus = data.gameData?.status?.abstractGameState || "";
    result._detailedStatus = data.gameData?.status?.detailedState || "";
    return result;
  } catch { return null; }
}

// Check if a pick is a win based on prop type and actual stats
function evaluatePick(prop, stats) {
  if (!stats) return null;
  // BTS push: player had 0 atBats (DNP / no plate appearance)
  if (stats.atBats === 0) return "push"; // streak preserved
  if (prop === "1+ Hits (BTS)" || prop === "1+ Hits") return stats.hits >= 1 ? "hit" : "miss";
  if (prop === "2+ Hits")                              return stats.hits >= 2 ? "hit" : "miss";
  if (prop === "1+ Total Bases")                       return stats.totalBases >= 1 ? "hit" : "miss";
  if (prop === "2+ Total Bases")                       return stats.totalBases >= 2 ? "hit" : "miss";
  if (prop === "1+ Home Runs")                         return stats.homeRuns >= 1 ? "hit" : "miss";
  return stats.hits >= 1 ? "hit" : "miss"; // default BTS
}

// Is a game in a postponed/suspended state?
function isPostponed(gameStatus, detailedStatus) {
  const postponedKeywords = ["postponed", "suspended", "cancelled", "rain delay"];
  const combined = `${gameStatus} ${detailedStatus}`.toLowerCase();
  return postponedKeywords.some(k => combined.includes(k));
}

// Has the game started? (game time is in the past)
function gameHasStarted(gameDate) {
  if (!gameDate) return false;
  return new Date(gameDate) <= new Date();
}

// Called from TodaysPicks to directly log a pick
export function openAddPick(prefill = {}) {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const today = new Date().toLocaleDateString("en-CA");
    const pickDate = prefill.date || today;

    // Enforce 2-pick-per-day limit
    const todayCount = existing.filter(p => p.date === pickDate).length;
    if (todayCount >= MAX_PICKS_PER_DAY) {
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
        detail: { msg: `Daily limit: max ${MAX_PICKS_PER_DAY} picks per day`, type: "error" }
      }));
      return;
    }

    // Prevent duplicate
    const dup = existing.find(p => p.playerId === prefill.playerId && p.date === pickDate);
    if (dup) {
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
        detail: { msg: `${prefill.playerName} already tracked for today`, type: "warn" }
      }));
      return;
    }

    const newPick = {
      id: Date.now(),
      playerName: prefill.playerName || "",
      playerId:   prefill.playerId   || null,
      team:       prefill.team       || "",
      opponent:   prefill.opponent   || "",
      date:       pickDate,
      prop:       prefill.prop       || "1+ Hits (BTS)",
      hitScore:   prefill.hitScore   || null,
      gamePk:     prefill.gamePk     || null,
      gameDate:   prefill.gameDate   || null,
      result:     null,
    };
    existing.unshift(newPick);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
      detail: { msg: `${prefill.playerName} added to Pick Record`, type: "ok" }
    }));
    window.dispatchEvent(new CustomEvent("diamondiq:addpick", { detail: prefill }));
  } catch (e) {
    console.error("Failed to save pick:", e);
  }
}

// ── Share card (canvas) ────────────────────────────────────────────────────
function PickShareModal({ pick, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { drawCard(); }, []);

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  function drawCard() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 520, H = 220;
    canvas.width = W*2; canvas.height = H*2;
    canvas.style.width = W+"px"; canvas.style.height = H+"px";
    const ctx = canvas.getContext("2d");
    ctx.scale(2,2);

    // Background
    const grad = ctx.createLinearGradient(0,0,W,H);
    grad.addColorStop(0,"#060F1E"); grad.addColorStop(1,"#0A2342");
    ctx.fillStyle = grad; roundRect(ctx,0,0,W,H,16); ctx.fill();

    // Result color bar
    const barColor = pick.result === "hit" ? "#4ADE80" : pick.result === "miss" ? "#EF4444" : "#F59E0B";
    ctx.fillStyle = barColor; ctx.fillRect(0,0,4,H);

    // Logo
    ctx.fillStyle = "#15803D"; roundRect(ctx,16,14,30,30,6); ctx.fill();
    ctx.fillStyle = "white"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center";
    ctx.fillText("IQ", 31, 34);
    ctx.fillStyle = "white"; ctx.font = "bold 14px Georgia"; ctx.textAlign = "left";
    ctx.fillText("Diamond", 54, 26);
    ctx.fillStyle = "#4ADE80"; ctx.fillText("IQ", 54+ctx.measureText("Diamond").width, 26);
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "9px system-ui";
    ctx.fillText("MY PICK · diamondiq.pro", 54, 38);

    // Result badge
    const badgeText = pick.result === "hit" ? "✓ HIT" : pick.result === "miss" ? "✗ MISS" : "🔒 LOCKED";
    ctx.fillStyle = barColor + "33";
    roundRect(ctx, W-100, 14, 84, 24, 6); ctx.fill();
    ctx.strokeStyle = barColor; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = barColor; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center";
    ctx.fillText(badgeText, W-58, 30);

    // Player info
    ctx.fillStyle = "white"; ctx.font = "bold 26px Georgia"; ctx.textAlign = "left";
    ctx.fillText(pick.playerName, 20, 90);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "12px system-ui";
    const subParts = [pick.team, pick.opponent ? `vs ${pick.opponent}` : null, pick.date].filter(Boolean);
    ctx.fillText(subParts.join("  ·  "), 20, 110);

    // Score
    if (pick.hitScore) {
      ctx.fillStyle = pick.hitScore >= 75 ? "#F59E0B" : pick.hitScore >= 60 ? "#4ADE80" : "#60A5FA";
      ctx.font = "bold 48px Georgia"; ctx.textAlign = "right";
      ctx.fillText(pick.hitScore, W-20, 110);
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "10px system-ui";
      ctx.fillText("HIT SCORE", W-20, 125);
    }

    // Prop badge
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(ctx, 20, 130, ctx.measureText(pick.prop||"1+ Hits (BTS)").width+20, 22, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "10px system-ui"; ctx.textAlign = "left";
    ctx.fillText(pick.prop || "1+ Hits (BTS)", 30, 145);

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(0,H-28,W,28);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "9px system-ui"; ctx.textAlign = "center";
    ctx.fillText("DiamondIQ PRO · MLB Hit Analytics · diamondiq.pro", W/2, H-10);
  }

  async function handleCopy() {
    const canvas = canvasRef.current; if (!canvas) return;
    try {
      canvas.toBlob(async blob => {
        await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      const link = document.createElement("a");
      link.download = `diamondiq-${pick.playerName.replace(/ /g,"-")}.png`;
      link.href = canvas.toDataURL(); link.click();
    }
  }

  return (
    <div style={{ position:"fixed",inset:0,zIndex:600,background:"rgba(0,8,20,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box",overflowY:"auto" }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",width:"min(560px, 100%)",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.6)",display:"flex",flexDirection:"column" }}>
        {/* Header */}
        <div style={{ background:"var(--navy)",padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <div style={{ width:28,height:28,borderRadius:6,background:"#15803D",display:"flex",alignItems:"center",justifyContent:"center" }}>
              <span style={{ fontWeight:900,fontSize:11,color:"white" }}>IQ</span>
            </div>
            <div>
              <div style={{ fontFamily:"var(--font-display)",fontSize:14,fontWeight:800,color:"white" }}>Share Pick</div>
              <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)" }}>diamondiq.pro</div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        {/* Canvas preview */}
        <div style={{ padding:"14px",background:"#060F1E",display:"flex",justifyContent:"center",flexShrink:0 }}>
          <canvas ref={canvasRef} className="share-modal-canvas" style={{ borderRadius:8,maxWidth:"100%",height:"auto",display:"block",boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }} />
        </div>
        {/* Actions */}
        <div style={{ padding:"12px 18px",display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",borderTop:"1px solid var(--border)",background:"var(--surface-2)" }}>
          <button className="btn btn-primary btn-sm" onClick={handleCopy} style={{ flex:1,minWidth:110,justifyContent:"center" }}>
            <span className="material-icons" style={{fontSize:15}}>{copied?"check":"content_copy"}</span>
            {copied ? "Copied!" : "Copy Image"}
          </button>
          <button className="btn btn-sm" onClick={() => { const l=document.createElement("a"); l.download=`pick-${pick.playerName.replace(/ /g,"-")}.png`; l.href=canvasRef.current.toDataURL(); l.click(); }}
            style={{ flex:1,minWidth:110,justifyContent:"center",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-secondary)" }}>
            <span className="material-icons" style={{fontSize:15}}>download</span>Download
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main PickTracker ───────────────────────────────────────────────────────
export default function PickTracker() {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [picks, setPicks]           = useState(loadPicks);
  const [showAdd, setShowAdd]       = useState(false);
  const [prefill, setPrefill]       = useState({});
  const [filterResult, setFilterResult] = useState("all");
  const [search, setSearch]         = useState("");
  const [sortDir, setSortDir]       = useState("desc");
  const [resolving, setResolving]   = useState(false);
  const [resolveMsg, setResolveMsg] = useState(null);
  const [selectedPick, setSelectedPick]   = useState(null);
  const [playerStats, setPlayerStats]     = useState(null);
  const [sharePickId, setSharePickId]     = useState(null);

  const today = new Date().toLocaleDateString("en-CA");

  // Load from Supabase
  useEffect(() => {
    let cancelled = false;
    async function syncFromDb() {
      const dbPicks = await dbLoadPicks(userId);
      if (cancelled || !dbPicks.length) return;
      const normalized = dbPicks.map(p => ({
        id:         p.id,
        playerName: p.player_name,
        playerId:   p.player_id,
        team:       p.team || "",
        opponent:   p.opponent || "",
        date:       p.game_date?.slice(0,10) || p.picked_at?.slice(0,10),
        prop:       p.prop || "1+ Hits (BTS)",
        hitScore:   p.score,
        gamePk:     p.game_pk,
        gameDate:   p.game_date,
        result:     p.result === "pending" ? null : p.result,
        hits:       p.hits,
        atBats:     p.at_bats,
        autoResolved: false,
      }));
      if (!cancelled) { savePicks(normalized); setPicks(normalized); }
    }
    syncFromDb();
    return () => { cancelled = true; };
  }, [userId]);

  // Listen for quick-add from TodaysPicks
  useEffect(() => {
    const handler = () => setPicks(loadPicks());
    window.addEventListener("diamondiq:addpick", handler);
    return () => window.removeEventListener("diamondiq:addpick", handler);
  }, []);

  // Auto-resolve stale pending picks on mount
  useEffect(() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const yStr = yesterday.toLocaleDateString("en-CA");
    const hasPast = picks.some(p => !p.result && p.date <= yStr);
    if (hasPast) autoResolve();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function autoResolve() {
    setResolving(true); setResolveMsg("Checking box scores...");
    const pending = picks.filter(p => !p.result || p.result === "pending");
    if (!pending.length) { setResolving(false); setResolveMsg(null); return; }

    const byDate = {};
    for (const p of pending) {
      if (!byDate[p.date]) byDate[p.date] = [];
      byDate[p.date].push(p);
    }

    const datesToResolve = Object.keys(byDate).filter(d => d < today);
    if (!datesToResolve.length) {
      setResolving(false);
      setResolveMsg("All pending picks are for today — will resolve after games finish");
      setTimeout(() => setResolveMsg(null), 3000);
      return;
    }

    let resolved = 0, failed = 0, pushCount = 0;
    const updatedPicks = [...picks];

    for (const date of datesToResolve) {
      setResolveMsg(`Checking ${date}...`);
      try {
        const { games } = await fetchGames(date);
        const boxDataByGame = {};
        await Promise.allSettled(games.map(async g => {
          boxDataByGame[g.gamePk] = await fetchBoxScore(g.gamePk);
        }));

        const allPlayerStats = {};
        for (const [, gData] of Object.entries(boxDataByGame)) {
          if (!gData) continue;
          for (const [pid, stats] of Object.entries(gData)) {
            if (pid.startsWith("_")) continue;
            allPlayerStats[pid] = stats;
          }
        }

        for (const pick of byDate[date]) {
          const idx = updatedPicks.findIndex(p => p.id === pick.id);
          if (idx === -1) continue;

          // Check postponement via game status
          let gameBoxData = pick.gamePk ? boxDataByGame[pick.gamePk] : null;
          if (gameBoxData) {
            const gs = gameBoxData._gameStatus || "";
            const ds = gameBoxData._detailedStatus || "";
            if (isPostponed(gs, ds)) {
              // Push — leave result as pending/null, don't reset streak
              pushCount++;
              continue;
            }
          }

          let stats = null;
          if (pick.playerId && pick.gamePk && boxDataByGame[pick.gamePk]) {
            stats = boxDataByGame[pick.gamePk][pick.playerId] || null;
          }
          if (!stats && pick.playerId && allPlayerStats[pick.playerId]) {
            stats = allPlayerStats[pick.playerId];
          }
          // Name fallback
          if (!stats && pick.playerName) {
            const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z ]/g,"").trim();
            const target = norm(pick.playerName);
            for (const [, gData] of Object.entries(boxDataByGame)) {
              if (!gData) continue;
              for (const [pid, pStats] of Object.entries(gData)) {
                if (pid.startsWith("_")) continue;
                if (pStats.name && norm(pStats.name) === target) {
                  stats = pStats;
                  updatedPicks[idx] = { ...updatedPicks[idx], playerId: parseInt(pid) };
                  break;
                }
              }
              if (stats) break;
            }
          }

          if (stats !== null) {
            const outcome = evaluatePick(pick.prop || "1+ Hits (BTS)", stats);
            if (outcome === "push") {
              pushCount++;
              // Keep result null (pending) — push means no AB, streak continues
            } else if (outcome !== null) {
              updatedPicks[idx] = { ...updatedPicks[idx], result: outcome, hits: stats.hits, atBats: stats.atBats, autoResolved: true };
              dbUpdatePickResult(userId, pick.playerId, pick.date, outcome, stats.hits, stats.atBats);
              resolved++;
            } else { failed++; }
          } else { failed++; }
        }
      } catch { failed += byDate[date].length; }
    }

    setPicks(updatedPicks); savePicks(updatedPicks);
    setResolving(false);
    const parts = [];
    if (resolved > 0) parts.push(`Resolved ${resolved} pick${resolved>1?"s":""}`);
    if (pushCount > 0) parts.push(`${pushCount} push${pushCount>1?"es":""} (no AB)`);
    if (failed > 0)    parts.push(`${failed} couldn't match`);
    setResolveMsg(parts.length ? parts.join(" · ") : "No picks to resolve");
    setTimeout(() => setResolveMsg(null), 5000);
  }

  function updateResult(id, result) {
    const updated = picks.map(p => p.id === id ? { ...p, result } : p);
    setPicks(updated); savePicks(updated);
    const p = picks.find(pk => pk.id === id);
    if (p) dbUpdatePickResult(userId, p.playerId, p.date, result, p.hits??null, p.atBats??null);
  }

  function removePick(id) {
    const p = picks.find(pk => pk.id === id);
    const updated = picks.filter(pk => pk.id !== id);
    setPicks(updated); savePicks(updated);
    if (p) dbDeletePick(userId, p.playerId, p.date);
  }

  function addPick(pick) {
    // Hard block: max 2 picks per day
    const dayCount = picks.filter(p => p.date === (pick.date || today)).length;
    if (dayCount >= MAX_PICKS_PER_DAY) {
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
        detail: { msg: `Daily limit reached — max ${MAX_PICKS_PER_DAY} picks per day`, type: "error" }
      }));
      return;
    }
    const newPick = { ...pick, id: `${Date.now()}-${Math.random()}`, result: null, autoResolved: false };
    const updated = [newPick, ...picks];
    setPicks(updated); savePicks(updated);
    setShowAdd(false); setPrefill({});
    dbSavePick(userId, {
      playerId:   newPick.playerId,
      playerName: newPick.playerName,
      gamePk:     newPick.gamePk,
      gameDate:   newPick.date,
      score:      newPick.hitScore,
      mode:       "bts",
      result:     "pending",
      pickedAt:   new Date().toISOString(),
    });
  }

  function swapPick(id) {
    // Swap/cancel allowed only before game starts
    const p = picks.find(pk => pk.id === id);
    if (!p) return;
    if (p.gameDate && gameHasStarted(p.gameDate)) {
      window.dispatchEvent(new CustomEvent("diamondiq:picktoast", {
        detail: { msg: "Game has started — picks cannot be changed after first pitch", type: "error" }
      }));
      return;
    }
    removePick(id);
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const decided  = picks.filter(p => p.result === "hit" || p.result === "miss");
  const wins     = picks.filter(p => p.result === "hit").length;
  const losses   = picks.filter(p => p.result === "miss").length;
  const pending  = picks.filter(p => !p.result || p.result === "pending").length;
  const winRate  = decided.length ? Math.round((wins / decided.length) * 100) : null;

  // BTS-rules current streak
  // Days with no picks at all are skipped (streak preserved)
  // Both picks must hit to count as a win day; any miss with AB resets
  const byDateMap = {};
  for (const p of decided) {
    if (!byDateMap[p.date]) byDateMap[p.date] = [];
    byDateMap[p.date].push(p);
  }
  // Only count dates that actually have decided picks — skip empty days entirely
  const sortedDates = Object.keys(byDateMap).sort().reverse();
  let streak = 0, streakType = null;
  for (const d of sortedDates) {
    const dayPicks = byDateMap[d];
    if (!dayPicks || dayPicks.length === 0) continue; // skip — no decided picks this day
    const allHit  = dayPicks.every(p => p.result === "hit");
    const anyMiss = dayPicks.some(p => p.result === "miss");
    if (streakType === null) {
      streakType = allHit ? "hit" : "miss";
      streak = allHit ? dayPicks.length : 1;
    } else if (streakType === "hit" && allHit) {
      streak += dayPicks.length;
    } else if (streakType === "miss" && anyMiss && !allHit) {
      streak++;
    } else break;
  }

  const todayPickCount = picks.filter(p => p.date === today).length;
  const canAddMoreToday = todayPickCount < MAX_PICKS_PER_DAY;

  // Filtered view
  const filtered = picks
    .filter(p => {
      if (filterResult === "hit"     && p.result !== "hit")                    return false;
      if (filterResult === "miss"    && p.result !== "miss")                   return false;
      if (filterResult === "pending" && p.result && p.result !== "pending")    return false;
      if (search && !p.playerName?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a,b) => sortDir === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));

  const sharePickObj = sharePickId ? picks.find(p => p.id === sharePickId) : null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">
            <span style={{ marginRight: 8, fontSize: 22 }}>{getEquippedEmoji()}</span>
            My Pick Record
          </h1>
          <p className="page-subtitle">
            BTS-style tracking · Max 2 picks/day · Both must hit to extend streak
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={autoResolve} disabled={resolving}
            style={{ background:"var(--surface-2)",border:"1px solid var(--border)",color:"var(--text-secondary)" }}>
            <span className="material-icons">{resolving ? "hourglass_top" : "fact_check"}</span>
            {resolving ? "Resolving..." : "Auto-Resolve"}
          </button>
          <button className="btn btn-primary btn-sm"
            onClick={() => { setPrefill({}); setShowAdd(true); }}
            disabled={!canAddMoreToday}
            title={!canAddMoreToday ? `Daily limit: ${MAX_PICKS_PER_DAY} picks per day` : undefined}>
            <span className="material-icons">add</span>
            Log a Pick {!canAddMoreToday && `(${todayPickCount}/${MAX_PICKS_PER_DAY})`}
          </button>
        </div>
      </div>

      {/* Daily pick counter */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, fontSize:12, color:"var(--text-muted)" }}>
        <span className="material-icons" style={{ fontSize:14 }}>today</span>
        Today: <strong style={{ color: todayPickCount >= MAX_PICKS_PER_DAY ? "var(--red-data)" : "var(--text-primary)" }}>
          {todayPickCount}/{MAX_PICKS_PER_DAY}
        </strong> picks used
        {todayPickCount >= MAX_PICKS_PER_DAY && (
          <span style={{ color:"var(--red-data)", fontSize:11 }}>· Daily limit reached</span>
        )}
      </div>

      {resolveMsg && (
        <div style={{ padding:"10px 16px",marginBottom:12,background:resolving?"var(--surface-2)":"rgba(34,197,94,0.08)",
          border:`1px solid ${resolving?"var(--border)":"rgba(34,197,94,0.2)"}`,borderRadius:"var(--radius)",
          fontSize:12,color:resolving?"var(--text-secondary)":"var(--green-light)",display:"flex",alignItems:"center",gap:8 }}>
          {resolving && <div className="spinner" style={{width:14,height:14}} />}
          {!resolving && <span className="material-icons" style={{fontSize:16}}>check_circle</span>}
          {resolveMsg}
        </div>
      )}

      {/* Record summary */}
      <div className="record-strip">
        <div className="record-card" onClick={() => setFilterResult("all")} style={{cursor:"pointer"}}>
          <div className="record-card-label">Overall Record</div>
          <div className="record-card-val" style={{ color: winRate>=55?"var(--data-green-light)":winRate>=45?"var(--data-yellow)":picks.length?"var(--data-red)":"var(--text-muted)" }}>
            {wins}-{losses}
          </div>
          <div className="record-card-sub">{pending} pending</div>
        </div>
        <div className="record-card" onClick={() => setFilterResult("hit")} style={{cursor:"pointer"}}>
          <div className="record-card-label">Wins</div>
          <div className="record-card-val" style={{ color:wins>0?"var(--data-green-light)":"var(--text-muted)" }}>{wins}</div>
          <div className="record-card-sub">{winRate!==null?`${winRate}% win rate`:"—"}</div>
        </div>
        <div className="record-card" onClick={() => setFilterResult("miss")} style={{cursor:"pointer"}}>
          <div className="record-card-label">Losses</div>
          <div className="record-card-val" style={{ color:losses>0?"var(--data-red)":"var(--text-muted)" }}>{losses}</div>
          <div className="record-card-sub">{decided.length} decided picks</div>
        </div>
        <div className="record-card" onClick={() => setFilterResult("all")} style={{cursor:"pointer"}}>
          <div className="record-card-label">Current Streak</div>
          <div className="record-card-val" style={{ color:streakType==="hit"?"var(--data-green-light)":streakType==="miss"?"var(--data-red)":"var(--text-muted)" }}>
            {streak > 0 ? `${streak}${streakType==="hit"?"W":"L"}` : "—"}
          </div>
          <div className="record-card-sub">BTS rules apply</div>
        </div>
      </div>

      {/* Trend chart */}
      {decided.length >= 3 && (() => {
        const datePts = Object.entries(
          decided.reduce((acc, p) => {
            if (!acc[p.date]) acc[p.date] = {hits:0,total:0};
            acc[p.date].total++;
            if (p.result==="hit") acc[p.date].hits++;
            return acc;
          }, {})
        ).sort(([a],[b])=>a.localeCompare(b)).map(([date,d])=>({date,rate:d.hits/d.total,hits:d.hits,total:d.total}));
        if (datePts.length < 2) return null;
        const W=100, H=40;
        const pts = datePts.map((d,i)=>({x:(i/(datePts.length-1))*W,y:H-d.rate*H,...d}));
        const pathD = pts.map((p,i)=>`${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        const fillD = `${pathD} L${pts[pts.length-1].x},${H} L0,${H} Z`;
        return (
          <div className="card" style={{padding:"14px 18px",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <span style={{fontSize:11,fontWeight:800,color:"var(--text-muted)",letterSpacing:"1px",textTransform:"uppercase"}}>Hit Rate Trend</span>
              <span style={{fontSize:11,color:"var(--text-muted)"}}>{datePts.length} days tracked</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:56,overflow:"visible"}}>
              <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />
              <path d={fillD} fill="rgba(63,185,80,0.08)" />
              <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p,i)=>(
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r="2.5" fill={p.rate>=0.5?"var(--accent)":"var(--data-red)"} stroke="var(--surface)" strokeWidth="1" />
                  <title>{p.date}: {p.hits}/{p.total} ({Math.round(p.rate*100)}%)</title>
                </g>
              ))}
            </svg>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
              <span style={{fontSize:9,color:"var(--text-muted)"}}>{datePts[0].date}</span>
              <span style={{fontSize:9,color:"var(--text-muted)"}}>{datePts[datePts.length-1].date}</span>
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Search</span>
          <div className="filter-input-icon" style={{minWidth:200}}>
            <span className="material-icons">search</span>
            <input className="filter-input" style={{paddingLeft:34,width:"100%"}}
              placeholder="Filter by player..." value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Result</span>
          <div className="chip-group">
            {[["all","All"],["pending","Pending"],["hit","Hits"],["miss","Misses"]].map(([val,label])=>(
              <button key={val} className={`chip ${filterResult===val?"active":""}`} onClick={()=>setFilterResult(val)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Date</span>
          <div className="chip-group">
            <button className={`chip ${sortDir==="desc"?"active":""}`} onClick={()=>setSortDir("desc")}>Newest</button>
            <button className={`chip ${sortDir==="asc"?"active":""}`}  onClick={()=>setSortDir("asc")}>Oldest</button>
          </div>
        </div>
        <div style={{marginLeft:"auto",alignSelf:"flex-end",fontSize:12,color:"var(--text-muted)"}}>{filtered.length} picks</div>
      </div>

      {picks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">assignment</span></div>
          <div className="empty-title">No picks logged yet</div>
          <div className="empty-sub">Track up to 2 players per day. Both must hit to extend your streak.</div>
          <button className="btn btn-primary" style={{marginTop:12}} onClick={()=>{setPrefill({});setShowAdd(true);}}>
            <span className="material-icons">add</span>Log your first pick
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><span className="material-icons">search_off</span></div>
          <div className="empty-title">No results</div>
          <div className="empty-sub">Try a different filter</div>
        </div>
      ) : (
        <div className="card" style={{padding:0}}>
          <div className="card-header">
            <span className="card-title"><span className="material-icons">assignment</span>Pick Log</span>
            <span style={{fontSize:11,color:"var(--text-muted)"}}>click Hit / Miss to record result</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Player</th>
                  <th>Prop</th>
                  <th>Score</th>
                  <th>Result</th>
                  <th style={{width:80}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const started  = p.gameDate ? gameHasStarted(p.gameDate) : p.date < today;
                  const shareable = p.result === "hit" || p.result === "miss" || started;
                  return (
                    <tr key={p.id} className={p.result==="hit"?"pick-row-hit":p.result==="miss"?"pick-row-miss":""}>
                      <td className="td-mono" style={{color:"var(--text-muted)",fontSize:11,whiteSpace:"nowrap"}}>
                        {p.date===today ? <span style={{color:"var(--accent)",fontWeight:700}}>Today</span> : p.date}
                      </td>
                      <td>
                        <div className="td-player" style={{color:"var(--navy)",cursor:"pointer",textDecoration:"underline",textDecorationColor:"var(--border)"}}
                          onClick={async e => {
                            e.stopPropagation(); setSelectedPick(p); setPlayerStats(null);
                            if (p.playerId) {
                              try {
                                const SEASON = new Date().getFullYear();
                                const [gl,glST,ss] = await Promise.allSettled([
                                  fetchGameLog(p.playerId,SEASON),
                                  fetchGameLog(p.playerId,SEASON,"S"),
                                  fetchSeasonStats(p.playerId,SEASON),
                                ]);
                                let gamelog = gl.value||[];
                                if (gamelog.length<3 && glST.value?.length) gamelog=[...gamelog,...glST.value];
                                setPlayerStats({ l7:computeSplit(gamelog,7), l3:computeSplit(gamelog,3), streak:computeActiveStreak(gamelog), season:ss.value||{}, gamelog:gamelog.slice(0,7) });
                              } catch { setPlayerStats({l7:{},l3:{},streak:0,season:{},gamelog:[]}); }
                            }
                          }}>
                          {p.playerName}
                        </div>
                        {p.team && <div className="td-sub">{p.team}{p.opponent?` vs ${p.opponent}`:""}</div>}
                      </td>
                      <td><span className="badge badge-navy" style={{fontSize:9}}>{p.prop}</span></td>
                      <td>
                        {p.hitScore ? (
                          <span style={{fontFamily:"var(--font-display)",fontWeight:800,fontSize:16,
                            color:p.hitScore>=75?"#D97706":p.hitScore>=60?"var(--accent)":p.hitScore>=45?"var(--data-blue)":"var(--text-muted)"}}>
                            {p.hitScore}
                          </span>
                        ) : <span style={{color:"var(--text-muted)"}}>—</span>}
                      </td>
                      <td>
                        {p.result==="hit" ? (
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <span className="badge badge-green" style={{fontSize:11,padding:"3px 10px"}}>
                              <span className="material-icons" style={{fontSize:12}}>check_circle</span> Hit
                            </span>
                            {p.autoResolved && <span className="material-icons" style={{fontSize:10,color:"var(--text-muted)"}} title="Auto-resolved">smart_toy</span>}
                          </div>
                        ) : p.result==="miss" ? (
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <span className="badge badge-red" style={{fontSize:11,padding:"3px 10px"}}>
                              <span className="material-icons" style={{fontSize:12}}>cancel</span> Miss
                            </span>
                            {p.autoResolved && <span className="material-icons" style={{fontSize:10,color:"var(--text-muted)"}} title="Auto-resolved">smart_toy</span>}
                          </div>
                        ) : (
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            <button className="btn btn-sm" onClick={()=>updateResult(p.id,"hit")}
                              style={{fontSize:9,padding:"2px 8px",background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",color:"var(--data-green)"}}>Hit</button>
                            <button className="btn btn-sm" onClick={()=>updateResult(p.id,"miss")}
                              style={{fontSize:9,padding:"2px 8px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",color:"var(--red-data)"}}>Miss</button>
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{display:"flex",gap:2,alignItems:"center"}}>
                          {/* Share — only if confirmed or game started */}
                          {shareable && (
                            <button onClick={()=>setSharePickId(p.id)}
                              style={{background:"none",border:"none",cursor:"pointer",color:"var(--text-muted)",padding:"2px 4px"}}
                              title="Share pick">
                              <span className="material-icons" style={{fontSize:15}}>share</span>
                            </button>
                          )}
                          {/* Cancel/remove — only before game starts */}
                          {(!started || !p.gameDate) && (
                            <button onClick={()=>swapPick(p.id)}
                              style={{background:"none",border:"none",cursor:"pointer",color:"var(--text-muted)",padding:"2px 4px"}}
                              title={started?"Can't remove — game started":"Remove pick"}>
                              <span className="material-icons" style={{fontSize:15}}>close</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Player stat modal */}
      {selectedPick && (
        <div className="add-pick-modal-overlay" onClick={e=>{if(e.target===e.currentTarget){setSelectedPick(null);setPlayerStats(null);}}}>
          <div className="add-pick-modal" style={{maxWidth:400}}>
            <div className="add-pick-modal-header">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {selectedPick.playerId && (
                  <img src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${selectedPick.playerId}/headshot/67/current`}
                    alt="" style={{width:40,height:40,borderRadius:"50%",objectFit:"cover"}}
                    onError={e=>{e.target.style.display="none";}} />
                )}
                <div>
                  <span style={{fontFamily:"var(--font-display)",fontSize:17,fontWeight:800,color:"white"}}>{selectedPick.playerName}</span>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.5)"}}>{selectedPick.team} · {selectedPick.prop}</div>
                </div>
              </div>
              <button className="close-btn" onClick={()=>{setSelectedPick(null);setPlayerStats(null);}}><span className="material-icons">close</span></button>
            </div>
            <div className="add-pick-modal-body">
              {playerStats ? (
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:12}}>
                    {[{label:"L3 AVG",val:playerStats.l3?.avg||"—"},{label:"L7 AVG",val:playerStats.l7?.avg||"—"},{label:"Streak",val:playerStats.streak?`${playerStats.streak}G`:"—"},{label:"Season",val:playerStats.season?.avg||"—"}].map(s=>(
                      <div key={s.label} style={{textAlign:"center",padding:"10px 0",background:"var(--surface)",borderRadius:8,border:"1px solid var(--border)"}}>
                        <div style={{fontSize:18,fontWeight:800,fontFamily:"var(--font-display)",color:"var(--navy)"}}>{s.val}</div>
                        <div style={{fontSize:9,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.5px"}}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {playerStats.gamelog?.length>0 && (
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:"var(--text-muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:"1px"}}>Recent Games</div>
                      <table style={{fontSize:11,width:"100%"}}>
                        <thead><tr><th>Date</th><th>H</th><th>AB</th><th>AVG</th><th>HR</th><th>RBI</th></tr></thead>
                        <tbody>
                          {playerStats.gamelog.map((g,i)=>(
                            <tr key={i}>
                              <td className="td-mono" style={{color:"var(--text-muted)"}}>{g.date}</td>
                              <td className="td-mono" style={{fontWeight:parseInt(g.hits)>0?700:400,color:parseInt(g.hits)>0?"var(--accent)":undefined}}>{g.hits}</td>
                              <td className="td-mono">{g.atBats}</td>
                              <td className="td-mono">{g.avg}</td>
                              <td className="td-mono">{g.homeRuns}</td>
                              <td className="td-mono">{g.rbi}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div style={{textAlign:"center",padding:20,color:"var(--text-muted)"}}>
                  <div className="spinner" style={{margin:"0 auto 8px"}} />Loading stats...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <AddPickModal
          prefill={prefill}
          today={today}
          todayCount={todayPickCount}
          maxPicks={MAX_PICKS_PER_DAY}
          onAdd={addPick}
          onClose={()=>{setShowAdd(false);setPrefill({});}}
        />
      )}

      {sharePickObj && (
        <PickShareModal pick={sharePickObj} onClose={()=>setSharePickId(null)} />
      )}
    </div>
  );
}

// ── Add Pick Modal ─────────────────────────────────────────────────────────
function AddPickModal({ prefill, today, todayCount, maxPicks, onAdd, onClose }) {
  const [query, setQuery]         = useState(prefill.playerName || "");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected]   = useState(prefill.playerId ? prefill : null);
  const [prop, setProp]           = useState(prefill.prop || "1+ Hits (BTS)");
  const [notes, setNotes]         = useState("");
  const [todayRosters, setTodayRosters] = useState({});

  const slotsLeft = maxPicks - todayCount;

  useEffect(() => {
    let cancelled = false;
    async function loadSlate() {
      try {
        const { games } = await fetchGames(today);
        if (cancelled) return;
        const rosterMap = {};
        await Promise.allSettled(games.map(async game => {
          for (const side of ["home","away"]) {
            const team = game[side];
            const oppSide = side==="home"?"away":"home";
            const opp = game[oppSide];
            try {
              const roster = await fetchRoster(team.teamId);
              for (const p of roster) {
                rosterMap[p.id] = {
                  playerId: p.id, playerName: p.name,
                  team: team.abbr, teamId: team.teamId,
                  opponent: opp.abbr,
                  opponentSP: game[oppSide].pitcher?.name || null,
                  venue: game.venue,
                  gameDate: game.gameDate,
                  gamePk: game.gamePk,
                  batSide: p.batSide, position: p.position,
                };
              }
            } catch {}
          }
        }));
        if (!cancelled) setTodayRosters(rosterMap);
      } catch {}
    }
    loadSlate();
    return () => { cancelled = true; };
  }, [today]);

  useEffect(() => {
    if (selected) return;
    if (query.length < 2) { setSuggestions([]); return; }
    const q = query.toLowerCase();
    const localMatches = Object.values(todayRosters).filter(p=>p.playerName.toLowerCase().includes(q)).slice(0,8);
    if (localMatches.length > 0) {
      setSuggestions(localMatches.map(p=>({...p,isToday:true})));
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlayers(query);
        setSuggestions(results.map(p=>({playerId:p.id,playerName:p.name,team:"",opponent:"",opponentSP:null,position:p.position,batSide:p.batSide,isToday:false})));
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selected, todayRosters]);

  function handleSelect(s) { setSelected(s); setQuery(s.playerName); setSuggestions([]); }
  function handleClear() { setSelected(null); setQuery(""); setSuggestions([]); }

  const gameStarted = selected?.gameDate && gameHasStarted(selected.gameDate);

  function handleSubmit() {
    if (!selected && !query.trim()) return;
    if (gameStarted) return;
    onAdd({
      playerName: selected ? selected.playerName : query.trim(),
      playerId:   selected ? selected.playerId   : null,
      team:       selected ? selected.team        : "",
      opponent:   selected ? (selected.opponentSP || selected.opponent) : "",
      date:       selected?.gameDate ? selected.gameDate.split("T")[0] : today,
      gamePk:     selected ? selected.gamePk     : null,
      gameDate:   selected ? selected.gameDate   : null,
      prop, hitScore: prefill.hitScore || null, notes,
    });
  }

  return (
    <div className="add-pick-modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="add-pick-modal" style={{maxWidth:420}}>
        <div className="add-pick-modal-header">
          <span style={{fontFamily:"var(--font-display)",fontSize:17,fontWeight:800,color:"white"}}>Log a Pick</span>
          <button className="close-btn" onClick={onClose}><span className="material-icons">close</span></button>
        </div>
        <div className="add-pick-modal-body" style={{gap:10}}>

          {/* Slots remaining */}
          <div style={{fontSize:11,padding:"6px 10px",background:slotsLeft===0?"rgba(239,68,68,0.1)":"rgba(74,222,128,0.08)",border:`1px solid ${slotsLeft===0?"rgba(239,68,68,0.2)":"rgba(74,222,128,0.15)"}`,borderRadius:6,color:slotsLeft===0?"var(--red-data)":"var(--green-light)"}}>
            {slotsLeft===0 ? `Daily limit reached (${maxPicks}/${maxPicks} picks used)` : `${slotsLeft} pick slot${slotsLeft>1?"s":""} remaining today`}
          </div>

          {/* Player search */}
          <div className="form-field" style={{position:"relative"}}>
            <label className="form-label">Player *</label>
            <div style={{position:"relative"}}>
              <span className="material-icons" style={{position:"absolute",left:10,top:10,fontSize:16,color:"var(--text-muted)"}}>search</span>
              <input className="form-input" value={query}
                onChange={e=>{setQuery(e.target.value);if(selected)setSelected(null);}}
                placeholder="Start typing a player name..." autoFocus style={{paddingLeft:32}} />
              {selected && (
                <button onClick={handleClear} style={{position:"absolute",right:8,top:8,background:"none",border:"none",cursor:"pointer",color:"var(--text-muted)",padding:2}}>
                  <span className="material-icons" style={{fontSize:16}}>close</span>
                </button>
              )}
            </div>
            {suggestions.length>0 && !selected && (
              <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:10,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"0 0 8px 8px",maxHeight:240,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
                {suggestions.map((s,i)=>(
                  <div key={s.playerId||i} onClick={()=>handleSelect(s)}
                    style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid var(--border)"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="var(--surface-2)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="var(--surface)";}}>
                    <img src={headshot(s.playerId)} alt="" style={{width:32,height:32,borderRadius:"50%",objectFit:"cover",background:"var(--surface-2)",flexShrink:0}} onError={e=>{e.target.style.display="none";}} />
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13}}>{s.playerName}</div>
                      <div style={{fontSize:10,color:"var(--text-muted)"}}>
                        {s.isToday ? `${s.team} vs ${s.opponent}${s.opponentSP?" · SP: "+s.opponentSP:""} · Today` : `${s.position||""} ${s.batSide?s.batSide+"HB":""}`}
                      </div>
                    </div>
                    {s.isToday && <span style={{marginLeft:"auto",fontSize:9,fontWeight:700,background:"var(--accent)",color:"white",padding:"2px 6px",borderRadius:4,flexShrink:0}}>TODAY</span>}
                  </div>
                ))}
              </div>
            )}
            {searching && !selected && query.length>=2 && suggestions.length===0 && (
              <div style={{position:"absolute",top:"100%",left:0,right:0,padding:"10px 14px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"0 0 8px 8px",fontSize:12,color:"var(--text-muted)"}}>Searching...</div>
            )}
          </div>

          {selected && (
            <div style={{background:"var(--surface-2)",borderRadius:8,padding:"12px 14px",display:"flex",gap:12,alignItems:"center"}}>
              <img src={headshot(selected.playerId)} alt="" style={{width:44,height:44,borderRadius:"50%",objectFit:"cover",background:"var(--surface)",flexShrink:0}} onError={e=>{e.target.style.display="none";}} />
              <div>
                <div style={{fontWeight:700,fontSize:14}}>{selected.playerName}</div>
                <div style={{fontSize:11,color:"var(--text-muted)",display:"flex",gap:6,flexWrap:"wrap",marginTop:2}}>
                  {selected.team && <span className="badge badge-navy" style={{fontSize:9}}>{selected.team}</span>}
                  {selected.opponent && <span>vs {selected.opponent}</span>}
                  {selected.opponentSP && <span style={{fontSize:10}}>SP: {selected.opponentSP}</span>}
                  {selected.position && <span style={{fontSize:10}}>{selected.position}</span>}
                  {selected.batSide && <span style={{fontSize:10}}>{selected.batSide}HB</span>}
                </div>
              </div>
            </div>
          )}

          {gameStarted && (
            <div style={{fontSize:12,color:"var(--red-data)",padding:"8px 10px",background:"rgba(239,68,68,0.08)",borderRadius:6,display:"flex",alignItems:"center",gap:6}}>
              <span className="material-icons" style={{fontSize:14}}>lock_clock</span>
              Game has already started — picks must be logged before first pitch.
            </div>
          )}

          <div className="form-field">
            <label className="form-label">Prop Type</label>
            <div className="chip-group">
              {PROP_TYPES.map(t=>(
                <button key={t} type="button" className={`chip ${prop===t?"active":""}`} onClick={()=>setProp(t)} style={{fontSize:11}}>{t}</button>
              ))}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Notes (optional)</label>
            <input className="form-input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Hot streak, good platoon matchup..." />
          </div>

          <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:4}}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit}
              disabled={(!selected && !query.trim()) || !!gameStarted || slotsLeft===0}>
              <span className="material-icons">check</span>Log Pick
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
