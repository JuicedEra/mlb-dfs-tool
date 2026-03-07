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
  // Default to today's date string
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    async function loadKillerData() {
      try {
        setLoading(true);
        
        // 1. Attempt fetch with selected date
        let gamesData = await fetchGames(selectedDate);
        
        // SPRING TRAINING FALLBACK: If selected date returns empty, try fetching without a date param
        // This often pulls the "current active slate" in many MLB API implementations
        if (!gamesData || gamesData.length === 0) {
          gamesData = await fetchGames();
        }

        const lineupsData = await fetchAllLineups(selectedDate).catch(() => []);

        if (!gamesData || gamesData.length === 0) {
          setCandidates([]);
          return;
        }

        // 2. Map data using the specific paths from your screenshots (p.batter.id)
        const mapped = gamesData.map(p => {
          const bId = p.batter?.id || p.id;
          const isStarting = lineupsData?.some(l => 
            l.lineup?.some(hitter => String(hitter.id) === String(bId))
          );

          return {
            ...p,
            id: bId,
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : (p.score || 0),
            img: headshot(bId),
            isStarting: isStarting,
            // Fallback for names if the object structure is deep
            displayName: p.name || p.batter?.name || "Unknown Player"
          };
        });

        // 3. Sort by Score, but keep confirmed lineups at the top
        const finalTop = mapped.sort((a, b) => {
          if (a.isStarting && !b.isStarting) return -1;
          if (!a.isStarting && b.isStarting) return 1;
          return b.hitScore - a.hitScore;
        }).slice(0, 15);

        setCandidates(finalTop);
      } catch (err) {
        console.error("57 Killer System Error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, [selectedDate]);

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in fade-in duration-500">
      <header className="mb-8 border-b border-[var(--border)] pb-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-6xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            57 <span className="text-red-500">KILLER</span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <span className={`h-2 w-2 rounded-full ${candidates.some(c => c.isStarting) ? 'bg-green-500 animate-pulse' : 'bg-orange-500'}`}></span>
            <p className="text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest">
              {candidates.some(c => c.isStarting) ? 'Confirmed Lineups Live' : 'Spring Training / Projected Mode'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-[var(--navy)] p-1 rounded-xl border border-[var(--border)]">
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-white font-bold p-2 outline-none invert cursor-pointer"
          />
        </div>
      </header>

      {loading ? (
        <div className="py-20 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-red-500 border-r-transparent"></div>
          <p className="mt-4 text-[var(--text-secondary)] font-bold uppercase tracking-tighter">Scanning Boxscores...</p>
        </div>
      ) : candidates.length === 0 ? (
        <div className="bg-[var(--surface)] border-2 border-dashed border-[var(--border)] rounded-3xl p-16 text-center">
          <span className="material-icons text-6xl text-[var(--text-secondary)] opacity-20 mb-4">sports_baseball</span>
          <h3 className="text-[var(--text-primary)] text-xl font-bold">No Matchups Detected</h3>
          <p className="text-[var(--text-secondary)] max-w-xs mx-auto mt-2">We couldn't find any games for {selectedDate}. Try selecting a different date.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className={`group relative overflow-hidden bg-[var(--surface)] border ${player.isStarting ? 'border-green-500/50' : 'border-[var(--border)]'} rounded-2xl p-5 flex items-center gap-5 hover:border-red-500 transition-all cursor-pointer`}
              onClick={() => openAddPick(player)}
             Benny
            >
              {/* Rank Number */}
              <div className="text-3xl font-black text-[var(--text-secondary)] opacity-10 italic w-10">
                {idx + 1}
              </div>

              {/* Avatar + Status */}
              <div className="relative">
                <img src={player.img} alt="" className="w-16 h-16 rounded-full bg-[var(--navy)] border-2 border-[var(--border)] group-hover:scale-110 transition-transform" />
                {player.isStarting && (
                  <div className="absolute -top-1 -right-1 bg-green-500 text-white rounded-full p-0.5 shadow-lg">
                    <span className="material-icons text-sm">check</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1">
                <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight group-hover:text-red-500 transition-colors">
                  {player.displayName}
                </h3>
                <div className="flex items-center gap-2 text-xs font-black uppercase text-[var(--text-secondary)]">
                  <span className="text-red-500">{player.team}</span>
                  <span className="opacity-30">VS</span>
                  <span>{player.oppPitcher || 'TBD'}</span>
                </div>
              </div>

              {/* Score Metric */}
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-[var(--text-secondary)] leading-none mb-1">Hit Prob</p>
                <p className="text-4xl font-black italic text-[var(--text-primary)] leading-none">
                  {Math.round(player.hitScore)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
