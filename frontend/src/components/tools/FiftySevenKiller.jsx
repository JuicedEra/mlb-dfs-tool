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
    async function loadData() {
      try {
        setLoading(true);
        // Step 1: Try to get games for the date
        let games = await fetchGames(selectedDate);
        
        // Step 2: Spring Training Overwrite 
        // If the date query returns nothing, pull the "current" global slate
        if (!games || games.length === 0) {
          games = await fetchGames();
        }

        const lineups = await fetchAllLineups(selectedDate).catch(() => []);

        if (!games || games.length === 0) {
          setCandidates([]);
          return;
        }

        // Step 3: Map using EXACT paths from your Screenshots (p.batter.id)
        const mapped = games.map(p => {
          const bId = p.batter?.id || p.id;
          const isConfirmed = lineups?.some(l => 
            l.lineup?.some(hitter => String(hitter.id) === String(bId))
          );

          return {
            ...p,
            id: bId,
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot(bId),
            isStarting: isConfirmed,
            displayName: p.name || p.batter?.name || "Unknown Player"
          };
        });

        // Step 4: Just show the top 10 scores, period.
        const topTen = mapped
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(topTen);
      } catch (err) {
        console.error("Critical Failure:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedDate]);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-8 border-b border-white/10 pb-6 flex justify-between items-center">
        <div>
          <h1 className="text-5xl font-black italic tracking-tighter text-white">
            57 <span className="text-red-500">KILLER</span>
          </h1>
          <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mt-1">
            Algorithm-Driven Contact Probability
          </p>
        </div>
        <input 
          type="date" 
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-zinc-900 text-white border border-white/20 rounded-lg p-2 font-mono text-sm outline-none"
        />
      </header>

      {loading ? (
        <div className="py-20 text-center text-gray-500 font-bold animate-pulse">SYNCING MLB DATA...</div>
      ) : candidates.length === 0 ? (
        <div className="p-20 text-center bg-zinc-900/50 rounded-3xl border border-dashed border-white/10">
          <p className="text-gray-400 font-bold italic">No active matchups found for this slate.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className="bg-zinc-900 border border-white/10 rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer"
              onClick={() => openAddPick(player)}
            >
              <div className="text-2xl font-black text-white/10 w-8 italic">{idx + 1}</div>
              <div className="relative">
                <img src={player.img} alt="" className="w-14 h-14 rounded-full bg-black border border-white/10" />
                {player.isStarting && (
                  <span className="absolute -top-1 -right-1 text-green-500 material-icons text-lg bg-white rounded-full">check_circle</span>
                )}
              </div>
              <div className="flex-1">
                <h3
