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
        console.log("Fetching 57 Killer Data for:", selectedDate);

        // 1. Fetch Games and Lineups
        const [games, lineups] = await Promise.all([
          fetchGames(selectedDate),
          fetchAllLineups(selectedDate).catch(() => [])
        ]);

        // 2. Fallback: If specific date is empty (common in Spring Training), try current day
        let activeGames = games;
        if (!activeGames || activeGames.length === 0) {
          activeGames = await fetchGames(); 
        }

        if (!activeGames || activeGames.length === 0) {
          setCandidates([]);
          return;
        }

        // 3. Map Data with Spring Training Fallbacks
        const mapped = activeGames.map(p => {
          const bId = p.batter?.id || p.id;
          // Check if they are in the 'lineup' array if it exists
          const isConfirmed = lineups?.some(l => 
            l.lineup?.some(hitter => String(hitter.id) === String(bId))
          );

          return {
            ...p,
            id: bId,
            name: p.name || p.batter?.name || "Unknown Hitter",
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : (p.score || 0),
            img: headshot(bId),
            isStarting: isConfirmed
          };
        });

        // 4. Sort: Show the best contact hitters for the day regardless of "Confirmed" status
        const topPicks = mapped
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 15);

        setCandidates(topPicks);
      } catch (err) {
        console.error("57 Killer Critical Error:", err);
      } finally {
        setLoading(false);
      }
    }
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
            {candidates.some(c => c.isStarting) ? 'Confirmed Lineups Detected' : 'Spring Training Projection Mode'}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1">
          <span className="material-icons text-xs text-[var(--text-secondary)]">event</span>
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-[var(--text-primary)] font-bold outline-none cursor-pointer text-sm"
          />
        </div>
      </header>

      {loading ? (
        <div className="py-20 text-center text-[var(--text-secondary)] font-bold animate-pulse">
          FETCHING SLATE...
        </div>
      ) : candidates.length === 0 ? (
        <div className="p-20 text-center bg-[var(--surface)] rounded-3xl border border-[var(--border)]">
          <span className="material-icons text-5xl mb-4 opacity-10">search_off</span>
          <p className="text-[var(--text-secondary)] font-bold italic text-lg">No active matchups found for this date.</p>
          <button 
             onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
             className="mt-4 text-red-500 font-bold uppercase text-xs underline"
          >
            Reset to Today
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className={`bg-[var(--surface)] border ${player.isStarting ? 'border-green-500/40' : 'border-[var(--border)]'} rounded-2xl p-4 flex items-center gap-4 hover:border-red-50
