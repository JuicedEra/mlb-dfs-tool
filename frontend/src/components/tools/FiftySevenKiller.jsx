import React, { useState, useEffect } from 'react';
import { 
  fetchGames, 
  fetchAllLineups, 
  computeHitScore, 
  headshot 
} from '../../utils/mlbApi'; //
import { openAddPick } from './PickTracker'; //

export default function FiftySevenKiller() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadKillerData() {
      try {
        setLoading(true);
        const [games, lineups] = await Promise.all([
          fetchGames(),
          fetchAllLineups().catch(() => [])
        ]);

        if (!games) return;

        const now = new Date();

        // Use the EXACT paths from your screenshots: p.batter.id and p.game.gameDate
        const processed = games.map(p => {
          const bId = p.batter?.id; 
          const gDate = p.game?.gameDate;
          
          return {
            ...p,
            id: bId,
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot(bId),
            // Lineup check: scans the lineup array for the player ID
            isStarting: lineups?.some(l => 
              l.lineup?.some(hitter => String(hitter.id) === String(bId))
            ),
            gameStarted: gDate ? new Date(gDate) <= now : false
          };
        });

        // FILTER: Only show players whose games HAVE NOT started
        const topTen = processed
          .filter(p => !p.gameStarted && p.id) 
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(topTen);
      } catch (err) {
        console.error("57 Killer Logic Error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, []);

  if (loading) return <div className="p-20 text-center text-[var(--text-secondary)]">Syncing with MLB Lineups...</div>;

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in fade-in">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <h1 className="text-5xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
          57 <span className="text-red-500">KILLER</span>
        </h1>
        <p className="text-[var(--text-secondary)] font-medium mt-1">Confirmed Lineups + High Contact Probability</p>
      </header>

      {candidates.length === 0 ? (
        <div className="p-10 text-center bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
          <p className="text-[var(--text-secondary)] font-bold">No active matchups found.</p>
          <p className="text-xs text-[var(--text-secondary)] opacity-50">Lineups may not be confirmed yet for today's slate.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer group"
              onClick={() => openAddPick(player)} //
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
                </p>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase text-[var(--text-secondary)] font-bold">Score</div>
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
