import { useState, useEffect } from "react";
import { fetchStatcastLeaderboard } from "../../utils/mlbApi";

const SEASON = new Date().getFullYear();

export default function StatcastTool() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortCol, setSortCol] = useState("est_ba");
  const [sortDir, setSortDir] = useState("desc");
  const [minPA, setMinPA] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await fetchStatcastLeaderboard(SEASON)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const diffColor = v => parseFloat(v) > 0.020 ? "var(--green-light)" : parseFloat(v) > 0.005 ? "var(--yellow)" : parseFloat(v) < -0.020 ? "var(--red-data)" : "var(--text-secondary)";
  const avgClr    = v => parseFloat(v) >= 0.300 ? "var(--green-light)" : parseFloat(v) >= 0.260 ? "var(--yellow)" : parseFloat(v) < 0.220 ? "var(--red-data)" : "var(--text-primary)";

  const filtered = data
    .filter(p => {
      if (+p.pa < minPA) return false;
      if (search && !p.player_name?.toLowerCase().includes(search.toLowerCase())) return false;
      const d = parseFloat(p.est_ba_minus_ba_diff);
      if (filter === "under" && d <= 0) return false;
      if (filter === "over"  && d >= 0) return false;
      return true;
    })
    .sort((a,b) => {
      const av = parseFloat(a[sortCol])||0, bv = parseFloat(b[sortCol])||0;
      return sortDir === "desc" ? bv - av : av - bv;
    });

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Statcast Deep Dive</h1>
          <p className="page-subtitle">Expected statistics from Baseball Savant · {SEASON}</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className={`info-banner success${filter === "under" ? "" : ""}`}
          onClick={() => { setFilter("under"); setSortCol("est_ba_minus_ba_diff"); setSortDir("desc"); }}
          style={{ cursor: "pointer", outline: filter === "under" ? "2px solid var(--accent)" : "none", outlineOffset: -2 }}>
          <span className="material-icons">trending_up</span><span><strong>Positive xBA Diff</strong> → xBA &gt; BA → player hitting below expected → likely to improve (buy low)</span>
        </div>
        <div className="info-banner" onClick={() => { setFilter("over"); setSortCol("est_ba_minus_ba_diff"); setSortDir("asc"); }}
          style={{ background: "var(--red-data-bg)", color: "var(--red-data)", border: "1px solid var(--red-data-border)", cursor: "pointer", outline: filter === "over" ? "2px solid var(--red-data)" : "none", outlineOffset: -2 }}>
          <span className="material-icons">trending_down</span><span><strong>Negative xBA Diff</strong> → BA &gt; xBA → likely to decline (sell high)</span>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-group filter-input-icon" style={{ minWidth: 240 }}>
          <span className="filter-label">Search Player</span>
          <div style={{ position: "relative" }}>
            <span className="material-icons" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "var(--text-muted)", pointerEvents: "none" }}>search</span>
            <input className="filter-input" style={{ paddingLeft: 34, width: "100%" }} placeholder="Player name..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Min PA</span>
          <select className="filter-select" value={minPA} onChange={e => setMinPA(+e.target.value)} style={{ minWidth: 100 }}>
            {[1,10,25,50,100,150,200,300].map(v => <option key={v} value={v}>{v === 1 ? "Any" : `${v}+`}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">xBA Filter</span>
          <div className="chip-group">
            <button className={`chip ${filter==="all"?"active":""}`} onClick={() => setFilter("all")}>All</button>
            <button className={`chip ${filter==="under"?"active":""}`} onClick={() => setFilter("under")} data-tooltip="xBA > BA — hitting below expected">Underperforming</button>
            <button className={`chip ${filter==="over"?"active":""}`} onClick={() => setFilter("over")} data-tooltip="BA > xBA — hitting above expected">Overperforming</button>
          </div>
        </div>
        <div style={{ marginLeft: "auto", alignSelf: "flex-end", display: "flex", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>{filtered.length} players</span>
          <button className="btn btn-ghost btn-sm" onClick={load}><span className="material-icons">refresh</span>Reload</button>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" />Loading Statcast data...</div>}

      {error && (
        <div className="info-banner warn">
          <span className="material-icons">warning</span>
          <div>
            <strong>Backend required for Statcast data.</strong> Baseball Savant blocks direct browser requests.
            Run the backend locally: <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>cd backend && uvicorn main:app --reload --port 8000</code>
          </div>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header">
            <span className="card-title"><span className="material-icons">speed</span>Expected Statistics Leaderboard</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width:36}}>#</th>
                  <th>Player</th>
                  <SortTh col="pa"    s={sortCol} d={sortDir} onClick={handleSort}>PA</SortTh>
                  <SortTh col="ba"    s={sortCol} d={sortDir} onClick={handleSort}>BA</SortTh>
                  <SortTh col="est_ba" s={sortCol} d={sortDir} onClick={handleSort}>xBA</SortTh>
                  <SortTh col="est_ba_minus_ba_diff" s={sortCol} d={sortDir} onClick={handleSort} tip="Positive = underperforming, likely to improve">xBA Diff</SortTh>
                  <SortTh col="slg"   s={sortCol} d={sortDir} onClick={handleSort}>SLG</SortTh>
                  <SortTh col="est_slg" s={sortCol} d={sortDir} onClick={handleSort}>xSLG</SortTh>
                  <SortTh col="woba"  s={sortCol} d={sortDir} onClick={handleSort}>wOBA</SortTh>
                  <SortTh col="est_woba" s={sortCol} d={sortDir} onClick={handleSort}>xwOBA</SortTh>
                  <SortTh col="est_woba_minus_woba_diff" s={sortCol} d={sortDir} onClick={handleSort} tip="Positive = underperforming expected">xwOBA Diff</SortTh>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0,100).map((p,i) => {
                  const diff = parseFloat(p.est_ba_minus_ba_diff);
                  const wDiff = parseFloat(p.est_woba_minus_woba_diff);
                  return (
                    <tr key={i}>
                      <td className="td-mono" style={{color:"var(--text-muted)",fontSize:11}}>{i+1}</td>
                      <td className="td-player" style={{minWidth:160}}>{p.player_name}</td>
                      <td className="td-mono" style={{color:"var(--text-secondary)"}}>{p.pa}</td>
                      <td className="td-mono" style={{color:avgClr(p.ba),fontWeight:600}}>{p.ba}</td>
                      <td className="td-mono" style={{color:avgClr(p.est_ba),fontWeight:600}}>{p.est_ba}</td>
                      <td className="td-mono" style={{color:diffColor(diff),fontWeight:700}}>{diff>0?"+":""}{diff.toFixed(3)}</td>
                      <td className="td-mono">{p.slg}</td>
                      <td className="td-mono">{p.est_slg}</td>
                      <td className="td-mono">{p.woba}</td>
                      <td className="td-mono">{p.est_woba}</td>
                      <td className="td-mono" style={{color:diffColor(wDiff),fontWeight:700}}>{wDiff>0?"+":""}{isNaN(wDiff)?"—":wDiff.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SortTh({ col, s, d, onClick, tip, children }) {
  return (
    <th className={s===col?"sorted":""} onClick={() => onClick(col)} data-tooltip={tip} style={{cursor:"pointer"}}>
      <span style={{display:"flex",alignItems:"center",gap:3}}>
        {children}
        <span className="material-icons sort-icon" style={{fontSize:12}}>
          {s===col?(d==="asc"?"arrow_upward":"arrow_downward"):"unfold_more"}
        </span>
      </span>
    </th>
  );
}
