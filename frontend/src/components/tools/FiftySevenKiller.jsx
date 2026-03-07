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

  useEffect(() => {
    async function loadKillerData() {
      try {
        setLoading(true);
        // Fetch data for the selected date
        const [games, lineups] = await Promise.all([
          fetchGames(selectedDate),
          fetchAllLineups(selectedDate).catch(() => [])
        ]);

        if (!games || games.length === 0) {
          setCandidates([]);
          return;
        }

        const processed = games.map(p => {
          const bId = p.batter?.id;
          const isStarting = lineups?.some(l => 
            l.lineup?.some(hitter => String(hitter.id) === String(bId))
          );

          return {
            ...p,
            id: bId,
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot(bId),
            isStarting: isStarting
          };
        });

        // SORTING LOGIC: 
        // 1. Confirmed starters go to the top
        // 2. Then sort by high Hit Score
        const sorted = processed.sort((a, b) => {
          if (a.isStarting && !b.isStarting) return -1;
          if (!a.isStarting && b.isStarting) return 1;
          return b.hitScore - a.hitScore;
        }).slice(0, 15); // Show top 15 to give more options during Spring Training

        setCandidates(sorted);
      } catch (err) {
        console.error("57 Killer Error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, [selectedDate]);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-8 border-b border-[var(--border)] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            57 <span className="text-red-500">KILLER</span>
          </h1>
          <p className="text-[var(--text-secondary)] font-medium mt-1 uppercase tracking-wider text-xs">
            {candidates.some(c => c.isStarting) ? 'Confirmed Lineups Active' : 'Projected Matchups (Spring Training Fallback)'}
          </p>
        </div>

        {/* Date Picker Input */}
        <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2">
          <span className="material-icons text-sm text-[var(--text-secondary)]">calendar_today</span>
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-[var(--text-primary)] font-bold outline-none cursor-pointer"
          />
        </div>
      </header>

      {loading ? (
        <div className="p-20 text-center text-[var(--text-secondary)]">Crunching {selectedDate} Data...</div>
      ) : candidates.length === 0 ? (
        <div className="p-10 text-center bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <p className="text-[var(--text-secondary)]">No games found for this date.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className={`bg-[var(--surface)] border ${player.isStarting ? 'border-green-500/30 shadow-lg shadow-green-500/5' : 'border-[var(--border)]'} rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer group`}
              onClick={() => openAddPick(player)}
            >
              <div className="text-xl font-black text-[var(--text-secondary)] w-6 opacity-30">{idx + 1}</div>
              
              <div className="relative">
                <img src={player.img} alt="" className="w-14 h-14 rounded-full bg-[var(--navy)] border border-[var(--border)]" />
                {player.isStarting && (
                  <span className="absolute -top-1 -right-1 text-green-500 material-icons text-lg bg-white rounded-full">check_circle</span>
                )}
              </div>
              
              <div className="flex-1">
                <h3 className="font-bold text-lg text-[var(--text-primary)] leading-tight">{player.name || player.batter?.name}</h3>
                <p className="text-xs text-[var(--text-secondary)] font-bold uppercase">
                  {player.team} vs {player.oppPitcher || 'TBD'} 
                  {!player.isStarting && <span className="ml-2 opacity-40 font-normal italic">(Projected)</span>}
                </p>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase text-[var(--text-secondary)] font-bold leading-none">Score</div>
                <div className="text-3xl font-black text-red-500 italic leading-none">
                  {Math.round(player.hitScore)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
