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
        
        // 1. Fetch data for the selected date
        let gData = await fetchGames(selectedDate);
        let lData = [];
        
        try {
          lData = await fetchAllLineups(selectedDate);
        } catch (e) {
          lData = [];
        }

        // 2. SPRING TRAINING FALLBACK
        // If the date-specific fetch returns nothing, fetch the 'current' live slate
        if (!gData || gData.length === 0) {
          gData = await fetchGames();
        }

        if (!gData || gData.length === 0) {
          setCandidates([]);
          return;
        }

        // 3. Map using exact paths found in your mlbApi (p.batter.id)
        const mapped = gData.map(p => {
          const bId = p.batter ? p.batter.id : p.id;
          const name = p.name || (p.batter ? p.batter.name : 'Unknown Player');
          
          // Check lineups array for this player
          const isConfirmed = lData ? lData.some(l => 
            l.lineup && l.lineup.some(h => String(h.id) === String(bId))
          ) : false;

          return {
            ...p,
            id: bId,
            displayName: name,
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot ? headshot(bId) : '',
            isStarting: isConfirmed
          };
        });

        // 4. Sort: Highest score first.
        const topTen = mapped
          .sort((a, b) => b.hitScore - a.hitScore)
          .slice(0, 10);

        setCandidates(topTen);
      } catch (err) {
        console.error('57 Killer Error:', err);
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
            DiamondIQ Pro Optimization
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
        <div className="py-20 text-center text-gray-500 font-bold animate-pulse">
          CONNECTING TO MLB LIVE DATA...
        </div>
      ) : candidates.length === 0 ? (
        <div className="p-20 text-center bg-zinc-900/50 rounded-3xl border border-dashed border-white/10">
          <p className="text-gray-400 font-bold">No active matchups detected for this date.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className="bg-zinc-900 border border-white/10 rounded-2xl p-4 flex items-center gap-4 hover:border-red-500 transition-all cursor-pointer group"
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
                  {player.team || 'MLB'} <span className="opacity-30">vs</span> {player.oppPitcher || 'TBD'}
                  {!player.isStarting && <span className="ml-2 text-orange-500/50 italic normal-case font-medium">(Projected)</span>}
                </p>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase text-gray-500 font-bold">Hit Score</div>
                <div className="text-3xl font-black text-red-500 italic leading-none">{Math.round(player.hitScore)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
