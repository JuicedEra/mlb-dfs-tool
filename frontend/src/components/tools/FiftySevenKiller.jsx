import React, { useState, useEffect } from 'react';
import { 
  fetchGames, 
  fetchAllLineups, 
  computeHitScore, 
  headshot 
} from '../../utils/mlbApi';
import { openAddPick } from './PickTracker';

export default function FiftySevenKiller() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  async function loadKillerData(overrideDate = null) {
    try {
      setLoading(true);
      const targetDate = overrideDate || selectedDate;
      
      const [games, lineups] = await Promise.all([
        fetchGames(targetDate),
        fetchAllLineups(targetDate).catch(() => [])
      ]);

      let activeGames = games || [];
      
      // Spring Training Fallback: if no games for date, fetch latest active
      if (activeGames.length === 0 && !overrideDate) {
        activeGames = await fetchGames();
      }

      const mapped = activeGames.map(p => {
        const bId = p.batter?.id || p.id;
        const isStarting = lineups?.some(l => 
          l.lineup?.some(hitter => String(hitter.id) === String(bId))
        );

        return {
          ...p,
          id: bId,
          hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : (p.score || 0),
          img: headshot(bId),
          isStarting: isStarting,
          displayName: p.name || p.batter?.name || "Unknown Hitter"
        };
      });

      const finalTop = mapped
        .sort((a, b) => b.hitScore - a.hitScore)
        .slice(0, 15);

      setCandidates(finalTop);
    } catch (err) {
      console.error("57 Killer Error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKillerData();
  }, [selectedDate]);

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in fade-in">
      <header className="mb-8 border-b border-[var(--border)] pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-5xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            57 <span className="text-red-500">KILLER</span>
          </h1>
          <p className="text-[var(--text-secondary)] font-bold uppercase text-[10px] tracking-widest mt-1">
            {candidates.some(c => c.isStarting) ? 'Confirmed Lineups Active' : 'Spring Training / Projected Mode'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => loadKillerData()}
            className="text-[var(--text-secondary)] hover:text-white transition-colors"
            title="Refresh Data"
          >
            <span className="material-icons text-xl">refresh</span>
          </button>
          <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1">
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-[var(--text-primary)] font-bold outline-none cursor-pointer text-sm"
            />
          </div>
        </div>
      </header>

      {loading ? (
        <div className="py-20 text-center text-[var(--text-secondary)] font-bold animate-pulse">CRUNCHING SLATE...</div>
      ) : candidates.length === 0 ? (
        <div className="p-20 text-center bg-[var(--surface)] rounded-3xl border border-[var(--border)]">
          <p className="text-[var(--text-secondary)] font-bold mb-4">No games found for this date.</p>
          <button 
            onClick={() => loadKillerData(new Date().toISOString().split('T')[0])}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-full font-bold transition-all shadow-lg"
          >
            FORCE LOAD TODAY
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className={`bg-[var(--surface)] border ${player.isStarting ? 'border-green-500/40 shadow-lg shadow-green-500/5' : 'border-[var(--border)]'} rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer group`}
              onClick={() => openAddPick(player)}
            >
              <div className="text-xl font-black text-[var(--text-secondary)] w-6 opacity-20 italic">{idx + 1}</div>
              
              <div className="relative">
                <img src={player.img} alt="" className="w-14 h-14 rounded-full bg-[var(--navy)] border border-[var(--border)]" />
                {player.isStarting && (
                  <span className="absolute -top-1 -right-1 text-green-500 material-icons text-lg bg-white rounded-full">check_circle</span>
                )}
              </div>
              
              <div className="flex-1">
                <h3 className="font-bold text-lg text-[var(--text-primary)] leading-tight">{player.displayName}</h3>
                <p className="text-[10px] text-[var(--text-secondary)] font-black uppercase">
                  {player.team} <span className="opacity-30">vs</span> {player.oppPitcher || 'TBD'}
                  {!player.isStarting && <span className="ml-2 text-orange-500/50 italic normal-case font-medium">(Projected)</span>}
                </p>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase text-[var(--text-secondary)] font-bold">Score</div>
                <div className="text-3xl font-black text-red-500 italic leading-none">{Math.round(player.hitScore)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
