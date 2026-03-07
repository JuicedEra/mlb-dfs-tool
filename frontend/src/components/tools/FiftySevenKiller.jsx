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

  useEffect(() => {
    async function loadKillerData() {
      try {
        setLoading(true);
        // 1. Fetch data
        const [games, lineups] = await Promise.all([
          fetchGames(),
          fetchAllLineups()
        ]);

        if (!games || !lineups) throw new Error("Missing API Data");

        const now = new Date();

        // 2. Process players with safety checks
        const processed = games
          .filter(p => {
            // Confirm they are in a starting lineup
            const isStarting = lineups.some(l => 
               l.lineup?.some(hitter => hitter.id === p.batterId)
            );
            // Ensure game hasn't started
            const notStarted = new Date(p.gameDate) > now;
            return isStarting && notStarted;
          })
          .map(p => ({
            ...p,
            // Fallback to 0 if computeHitScore fails
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot(p.batterId)
          }))
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(processed);
      } catch (err) {
        console.error("57 Killer Data Error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <span className="material-icons animate-spin text-4xl text-[var(--navy)] mb-4">sync</span>
        <p className="text-[var(--text-secondary)]">Analyzing confirmed lineups...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in fade-in duration-500">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <h1 className="text-5xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
          57 <span className="text-red-500">KILLER</span>
        </h1>
        <p className="text-[var(--text-secondary)] font-medium mt-2">
          Top 10 daily picks for 'Beat the Streak' optimization.
        </p>
      </header>

      {candidates.length === 0 ? (
        <div className="bg-[var(--surface)] p-10 rounded-2xl border border-dashed border-[var(--border)] text-center">
          <span className="material-icons text-4xl mb-2 opacity-20">error_outline</span>
          <p className="text-[var(--text-secondary)]">No confirmed lineups available yet. Check back closer to first pitch.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.batterId || idx}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-4 hover:border-red-500/50 transition-all cursor-pointer group"
              onClick={() => openAddPick(player)}
            >
              <div className="text-2xl font-black text-[var(--text-secondary)] w-8 opacity-30">
                {idx + 1}
              </div>
              
              <img src={player.img} alt="" className="w-14 h-14 rounded-full bg-[var(--navy)] border border-[var(--border)]" />
              
              <div className="flex-1">
                <h3 className="font-bold text-lg text-[var(--text-primary)] leading-tight">{player.name}</h3>
                <p className="text-sm text-[var(--text-secondary)] uppercase font-semibold">
                  {player.team} vs {player.oppPitcher || 'TBD'}
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
