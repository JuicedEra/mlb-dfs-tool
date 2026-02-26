import { useState } from "react";

const PARKS = [
  { name: "Coors Field",               team: "Colorado Rockies",       abbr: "COL", factor: 121, hr: 118, h: 122, r: 125, type: "hitter" },
  { name: "Great American Ball Park",  team: "Cincinnati Reds",        abbr: "CIN", factor: 112, hr: 115, h: 108, r: 114, type: "hitter" },
  { name: "Fenway Park",               team: "Boston Red Sox",         abbr: "BOS", factor: 110, hr: 99,  h: 112, r: 111, type: "hitter" },
  { name: "Wrigley Field",             team: "Chicago Cubs",           abbr: "CHC", factor: 108, hr: 111, h: 107, r: 109, type: "hitter" },
  { name: "Globe Life Field",          team: "Texas Rangers",          abbr: "TEX", factor: 107, hr: 108, h: 106, r: 108, type: "hitter" },
  { name: "American Family Field",     team: "Milwaukee Brewers",      abbr: "MIL", factor: 106, hr: 110, h: 103, r: 107, type: "hitter" },
  { name: "Yankee Stadium",            team: "New York Yankees",       abbr: "NYY", factor: 105, hr: 118, h: 100, r: 105, type: "hitter" },
  { name: "Camden Yards",              team: "Baltimore Orioles",      abbr: "BAL", factor: 105, hr: 112, h: 102, r: 105, type: "hitter" },
  { name: "Rogers Centre",             team: "Toronto Blue Jays",      abbr: "TOR", factor: 104, hr: 107, h: 103, r: 104, type: "hitter" },
  { name: "Angel Stadium",             team: "Los Angeles Angels",     abbr: "LAA", factor: 104, hr: 106, h: 103, r: 104, type: "hitter" },
  { name: "Citizens Bank Park",        team: "Philadelphia Phillies",  abbr: "PHI", factor: 104, hr: 110, h: 102, r: 105, type: "hitter" },
  { name: "Guaranteed Rate Field",     team: "Chicago White Sox",      abbr: "CWS", factor: 103, hr: 109, h: 100, r: 103, type: "hitter" },
  { name: "Truist Park",               team: "Atlanta Braves",         abbr: "ATL", factor: 103, hr: 105, h: 102, r: 104, type: "hitter" },
  { name: "Progressive Field",         team: "Cleveland Guardians",    abbr: "CLE", factor: 102, hr: 101, h: 103, r: 102, type: "neutral" },
  { name: "Nationals Park",            team: "Washington Nationals",   abbr: "WSH", factor: 99,  hr: 103, h: 97,  r: 99,  type: "neutral" },
  { name: "Minute Maid Park",          team: "Houston Astros",         abbr: "HOU", factor: 99,  hr: 100, h: 99,  r: 99,  type: "neutral" },
  { name: "Chase Field",               team: "Arizona Diamondbacks",   abbr: "ARI", factor: 99,  hr: 101, h: 99,  r: 99,  type: "neutral" },
  { name: "loanDepot Park",            team: "Miami Marlins",          abbr: "MIA", factor: 100, hr: 97,  h: 102, r: 100, type: "neutral" },
  { name: "Target Field",              team: "Minnesota Twins",        abbr: "MIN", factor: 97,  hr: 102, h: 95,  r: 97,  type: "pitcher" },
  { name: "Busch Stadium",             team: "St. Louis Cardinals",    abbr: "STL", factor: 96,  hr: 93,  h: 98,  r: 95,  type: "pitcher" },
  { name: "PNC Park",                  team: "Pittsburgh Pirates",     abbr: "PIT", factor: 97,  hr: 97,  h: 97,  r: 97,  type: "pitcher" },
  { name: "Kauffman Stadium",          team: "Kansas City Royals",     abbr: "KC",  factor: 96,  hr: 95,  h: 97,  r: 96,  type: "pitcher" },
  { name: "Citi Field",                team: "New York Mets",          abbr: "NYM", factor: 95,  hr: 92,  h: 96,  r: 94,  type: "pitcher" },
  { name: "Tropicana Field",           team: "Tampa Bay Rays",         abbr: "TB",  factor: 95,  hr: 92,  h: 96,  r: 94,  type: "pitcher" },
  { name: "T-Mobile Park",             team: "Seattle Mariners",       abbr: "SEA", factor: 97,  hr: 95,  h: 98,  r: 96,  type: "pitcher" },
  { name: "Dodger Stadium",            team: "Los Angeles Dodgers",    abbr: "LAD", factor: 96,  hr: 94,  h: 97,  r: 95,  type: "pitcher" },
  { name: "Oracle Park",               team: "San Francisco Giants",   abbr: "SF",  factor: 94,  hr: 87,  h: 97,  r: 93,  type: "pitcher" },
  { name: "Petco Park",                team: "San Diego Padres",       abbr: "SD",  factor: 93,  hr: 91,  h: 94,  r: 92,  type: "pitcher" },
  { name: "Oakland Coliseum",          team: "Oakland Athletics",      abbr: "OAK", factor: 92,  hr: 88,  h: 95,  r: 91,  type: "pitcher" },
  { name: "Comerica Park",             team: "Detroit Tigers",         abbr: "DET", factor: 92,  hr: 88,  h: 94,  r: 91,  type: "pitcher" },
];

export default function ParkFactors() {
  const [sortCol, setSortCol]     = useState("factor");
  const [sortDir, setSortDir]     = useState("desc");
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch]       = useState("");

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = PARKS
    .filter(p => {
      if (filterType !== "all" && p.type !== filterType) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.team.toLowerCase().includes(search.toLowerCase()) && !p.abbr.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a,b) => sortDir === "desc" ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]);

  const top5 = [...PARKS].sort((a,b) => b.factor - a.factor).slice(0,5);

  const fColor = (val) => val >= 108 ? "var(--green-light)" : val <= 93 ? "var(--red-data)" : "var(--text-secondary)";

  return (
    <div>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Park Factors</h1>
          <p className="page-subtitle">5-year normalized run environment data · 100 = perfectly neutral</p>
        </div>
      </div>

      <div className="info-banner info" style={{ marginBottom: 20 }}>
        <span className="material-icons">info</span>
        <span>Values above 100 inflate offense (favor hitters/hits). Values below 100 suppress it. Use HR Factor to identify home run environments specifically.</span>
      </div>

      <div className="section-label">Top Hitter-Friendly Parks Today</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 28 }}>
        {top5.map((p, i) => (
          <div key={p.name} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", textAlign: "center", boxShadow: "var(--shadow-sm)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>#{i+1}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 800, color: "var(--green-light)", lineHeight: 1 }}>{p.factor}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "var(--navy)", margin: "4px 0 2px" }}>{p.abbr}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, marginBottom: 8 }}>{p.name}</div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
              <span className="badge badge-green" style={{fontSize:9}}>HR {p.hr}</span>
              <span className="badge badge-blue"  style={{fontSize:9}}>H {p.h}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <div className="filter-group">
          <span className="filter-label">Search</span>
          <div className="filter-input-icon" style={{ minWidth: 220 }}>
            <span className="material-icons">search</span>
            <input className="filter-input" style={{ paddingLeft: 34, width: "100%" }} placeholder="Team or stadium..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Park Type</span>
          <div className="chip-group">
            {[["all","All"],["hitter","Hitter's"],["neutral","Neutral"],["pitcher","Pitcher's"]].map(([k,l]) => (
              <button key={k} className={`chip ${filterType === k ? "active" : ""}`} onClick={() => setFilterType(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="card-header">
          <span className="card-title"><span className="material-icons">stadium</span>All 30 Parks ({filtered.length})</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Click headers to sort</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stadium</th>
                <th>Team</th>
                {[["factor","Park Factor"],["hr","HR Factor"],["h","H Factor"],["r","R Factor"]].map(([k,l]) => (
                  <th key={k} className={sortCol===k?"sorted":""} onClick={() => handleSort(k)} style={{cursor:"pointer"}}>
                    <span style={{display:"flex",alignItems:"center",gap:3}}>
                      {l}
                      <span className="material-icons sort-icon" style={{fontSize:12}}>
                        {sortCol===k?(sortDir==="asc"?"arrow_upward":"arrow_downward"):"unfold_more"}
                      </span>
                    </span>
                  </th>
                ))}
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const pct = Math.min(Math.max(((p.factor-80)/50)*100,0),100);
                return (
                  <tr key={p.name}>
                    <td><div style={{fontWeight:700,color:"var(--navy)",fontSize:13}}>{p.name}</div></td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:28,height:28,borderRadius:6,background:"var(--navy)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"white",flexShrink:0}}>{p.abbr}</div>
                        <span style={{fontSize:12,color:"var(--text-secondary)"}}>{p.team}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div className="park-bar-outer">
                          <div className={`park-bar-fill ${p.type}`} style={{width:`${pct}%`}} />
                        </div>
                        <span style={{fontFamily:"var(--font-mono)",fontSize:13,fontWeight:700,color:fColor(p.factor)}}>{p.factor}</span>
                      </div>
                    </td>
                    <td><span style={{fontFamily:"var(--font-mono)",fontSize:13,fontWeight:600,color:fColor(p.hr)}}>{p.hr}</span></td>
                    <td><span style={{fontFamily:"var(--font-mono)",fontSize:13,color:fColor(p.h)}}>{p.h}</span></td>
                    <td><span style={{fontFamily:"var(--font-mono)",fontSize:13,color:fColor(p.r)}}>{p.r}</span></td>
                    <td>
                      <span className={`badge ${p.type==="hitter"?"badge-green":p.type==="pitcher"?"badge-red":"badge-gray"}`}>
                        <span className="material-icons" style={{fontSize:10}}>{p.type==="hitter"?"trending_up":p.type==="pitcher"?"trending_down":"remove"}</span>
                        {p.type==="hitter"?"Hitter's":p.type==="pitcher"?"Pitcher's":"Neutral"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
