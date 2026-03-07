import React, { useState, useEffect } from 'react';
import { 
  fetchGames, 
  fetchRoster,
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
        
        // 1. Get the Games for the date
        let gamesData = await fetchGames(selectedDate);
        if (!gamesData || gamesData.length === 0) {
          gamesData = await fetchGames(); // Spring Training fallback
        }

        if (!gamesData || gamesData.length === 0) {
          setCandidates([]);
          return;
        }

        // 2. Fetch rosters for all teams in those games to find our players
        const playerPool = [];
        const lineupData = await fetchAllLineups(selectedDate).catch(() => []);

        await Promise.all(gamesData.map(async (game) => {
          const homeId = game.teams?.home?.team?.id;
          const awayId = game.teams?.away?.team?.id;
          
          if (homeId && awayId) {
            const [homeRoster, awayRoster] = await Promise.all([
              fetchRoster(homeId).catch(() => []),
              fetchRoster(awayId).catch(() => [])
            ]);

            // Add players to pool with game context for the HitScore algorithm
            homeRoster.forEach(p => {
              playerPool.push({
                ...p,
                game: game,
                team: game.teams.home.team.name,
                oppPitcher: game.teams.away.probablePitcher?.fullName || 'TBD'
              });
            });
            awayRoster.forEach(p => {
              playerPool.push({
                ...p,
                game: game,
                team: game.teams.away.team.name,
                oppPitcher: game.teams.home.probablePitcher?.fullName || 'TBD'
              });
            });
          }
        }));

        // 3. Map and Score
        const mapped = playerPool.map(p => {
          const bId = p.person?.id || p.id;
          const name = p.person?.fullName || p.name || 'Unknown';
          
          const isStarting = lineupData ? lineupData.some(l => 
            l.lineup && l.lineup.some(h => String(h.id) === String(bId))
          ) : false;

          return {
            ...p,
            id: bId,
            displayName: name,
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot(bId),
            isStarting: isStarting
          };
        });

        // 4. Sort and Filter (Top 10)
        const sorted = mapped
          .filter(p => p.hitScore > 0)
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(sorted);
      } catch (err) {
        console.error('Data Fetch Error:', err);
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
          <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mt-1">
            Roster-Level Analytics Active
          </p>
        </div>
        <input 
          type="date" 
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-zinc-900 text-white border border-white/20 rounded-lg p-2 text-sm outline-none"
        />
      </header>

      {loading ? (
        <div className="py-20 text-center text-gray-500 font-bold animate-pulse">BUILDING PLAYER POOL...</div>
      ) : candidates.length === 0 ? (
        <div className="p-20 text-center bg-zinc-900/50 rounded-3xl border border-dashed border-white/10">
          <p className="text-gray-400 font-bold">No projected matchups found for this date.</p>
          <button onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} className="mt-4 text-red-500 text-xs font-bold uppercase">Reset to Today</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className="bg-zinc-900 border border-white/10 rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer"
              onClick={() => { if(typeof openAddPick === 'function') openAddPick(player); }}
            >
              <div className="text-2xl font-black text-white/5 w-8 italic">{idx + 1}</div>
              <div className="relative">
                <img src={player.img} alt="" className="w-14 h-14 rounded-full bg-black border border-white/10" />
                {player.isStarting && (
                  <span className="absolute -top-1 -right-1 text-green-500 material-icons text-lg bg-white rounded-full">check_circle</span>
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-white leading-tight">{player.displayName}</h3>
                <p className="text-[10px] text-gray-500 font-black uppercase">
                  {player.team} <span className="opacity-30">vs</span> {player.oppPitcher}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-gray-500 font-bold">Score</div>
                <div className="text-3xl font-black text-red-500 italic leading-none">{Math.round(player.hitScore)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
