import React, { useState, useEffect } from 'react';
import { 
  fetchGames, 
  fetchAllLineups, 
  computeHitScore, 
  headshot 
} from '../../utils/mlbApi'; // Using your existing utility
import { openAddPick } from './PickTracker';

export default function FiftySevenKiller() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadKillerData() {
      try {
        // Fetch real-time games and lineups simultaneously
        const [games, lineups] = await Promise.all([
          fetchGames(),
          fetchAllLineups()
        ]);

        const now = new Date();

        // Filter: Only players in confirmed lineups whose games haven't started
        const processed = games
          .filter(p => {
            const isStarting = lineups.some(l => l.gameId === p.gameId);
            const notStarted = new Date(p.gameDate) > now;
            return isStarting && notStarted;
          })
          .map(p => ({
            ...p,
            hitScore: computeHitScore(p), // Syncs rank with TodaysPicks
            img: headshot(p.batterId)
          }))
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(processed);
      } catch (err) {
        console.error("57 Killer Error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in fade-in duration-500">
      <header className="mb-8 flex items-center justify-between border-b border-[var(--border)] pb-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            57 <span className="text-red-500">KILLER</span>
          </h1>
          <p className="text-[var(--text-secondary)] font-medium">Top 10 daily picks for 'Beat the Streak' optimization.</p>
        </div>
        <div className="hidden md:block bg-[var(--navy)] px-4 py-2 rounded-lg border border-[var(--border)]">
          <span className="text-xs uppercase tracking-widest text-white/50 block">Algorithm</span>
          <span className="text-sm font-bold text-white">Contact + Matchup Grade</span>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <span className="material-icons animate-spin text-4xl text-[var(--navy)] mb-4">sync</span>
          <p className="text-[var(--text-secondary)] animate-pulse">Analyzing confirmed lineups...</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.batterId}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-4 hover:border-red-500/50 transition-all cursor-pointer group"
              onClick={() => openAddPick(player)}
            >
              <div className="text-2xl font-black text-[var(--text-secondary)] w-8 opacity-30 group-hover:opacity-100 transition-opacity">
                {idx + 1}
              </div>
              
              <img src={player.img} alt="" className="w-16 h-16 rounded-full bg-slate-200 border-2 border-[var(--border)]" />
              
              <div className="flex-1">
                <h3 className="font-bold text-lg text-[var(--text-primary)] leading-tight">{player.name}</h3>
                <p className="text-sm text-[var(--text-secondary)] uppercase font-semibold">
                  {player.team} <span className="mx-1 opacity-30">vs</span> {player.oppPitcher}
                </p>
              </div>

              <div className="text-right">
                <div className="text-xs uppercase text-[var(--text-secondary)] font-bold">Hit Score</div>
                <div className="text-3xl font-black text-red-500 italic">
                  {Math.round(player.hitScore)}
                </div>
              </div>

              <div className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity hidden md:block">
                <span className="material-icons text-[var(--navy)]">add_circle</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
