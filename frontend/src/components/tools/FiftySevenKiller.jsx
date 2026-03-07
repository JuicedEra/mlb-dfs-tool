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
        const [games, lineups] = await Promise.all([
          fetchGames(),
          fetchAllLineups().catch(() => []) // Don't let lineup failure crash the app
        ]);

        if (!games) return;

        const now = new Date();

        // 1. Map all games to our display format first
        const allMapped = games.map(p => ({
          ...p,
          hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : (p.score || 0),
          img: headshot(p.batterId),
          // Check if this specific player ID exists in any of the confirmed lineups
          isStarting: lineups?.some(l => 
            l.lineup?.some(hitter => String(hitter.id) === String(p.batterId))
          ) || false,
          gameStarted: new Date(p.gameDate) <= now
        }));

        // 2. Filter: Priorities players who ARE starting and haven't played yet
        let filtered = allMapped.filter(p => p.isStarting && !p.gameStarted);

        // 3. Fallback: If no lineups are confirmed yet, show top projected players who haven't started
        if (filtered.length === 0) {
          filtered = allMapped.filter(p => !p.gameStarted).slice(0, 10);
        }

        const topTen = filtered
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(topTen);
      } catch (err) {
        console.error("57 Killer Crash:", err);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, []);

  if (loading) return <div className="p-20 text-center text-[var(--text-secondary)]">Loading Analytics...</div>;

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in fade-in">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <h1 className="text-5xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
          57 <span className="text-red-500">KILLER</span>
        </h1>
        <p className="text-[var(--text-secondary)] font-medium mt-1">Confirmed Lineups + High Contact Probability</p>
      </header>

      <div className="grid gap-3">
        {candidates.map((player, idx) => (
          <div 
            key={player.batterId || idx}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer group"
            onClick={() => openAddPick(player)}
          >
            <div className="text-xl font-black text-[var(--text-secondary)] w-6 opacity-40">{idx + 1}</div>
            
            <div className="relative">
              <img src={player.img} alt="" className="w-14 h-14 rounded-full bg-[var(--navy)] border border-[var(--border)]" />
              {player.isStarting && (
                <span className="absolute -top-1 -right-1 text-green-500 material-icons text-lg bg-white rounded-full">check_circle</span>
              )}
            </div>
            
            <div className="flex-1">
              <h3 className="font-bold text-lg text-[var(--text-primary)] leading-tight">{player.name}</h3>
              <p className="text-sm text-[var(--text-secondary)] font-semibold uppercase">
                {player.team} <span className="text-[var(--border)]">vs</span> {player.oppPitcher || 'TBD'}
              </p>
            </div>

            <div className="text-right">
              <div className="text-[10px] uppercase text-[var(--text-secondary)] font-bold">Hit Score</div>
              <div className="text-3xl font-black text-red-500 italic leading-none">{Math.round(player.hitScore)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
