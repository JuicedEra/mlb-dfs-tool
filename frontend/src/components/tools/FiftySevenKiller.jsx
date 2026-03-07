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
  const [errorInfo, setErrorInfo] = useState(null);
  // Using a simple string date to start, just like the MLB API usually prefers
  const [selectedDate, setSelectedDate] = useState("2026-03-06"); 

  useEffect(() => {
    async function loadKillerData() {
      try {
        setLoading(true);
        setErrorInfo(null);

        // 1. Fetch using the utility from your screenshot
        const gamesData = await fetchGames(selectedDate);
        const lineupsData = await fetchAllLineups(selectedDate).catch(() => []);

        // DEBUG: If games are empty, let's find out why
        if (!gamesData || gamesData.length === 0) {
          setErrorInfo(`No games returned for ${selectedDate}. It might be a scheduling gap or API format issue.`);
          setCandidates([]);
          return;
        }

        // 2. Map data using the EXACT paths from your screenshots
        const mapped = gamesData.map(p => {
          const bId = p.batter?.id; 
          const gDate = p.game?.gameDate;
          
          // Match the lineup checking logic seen in your app
          const isStarting = lineupsData?.some(l => 
            l.lineup?.some(hitter => String(hitter.id) === String(bId))
          );

          return {
            ...p,
            id: bId,
            displayDate: gDate,
            // Sync with your app's hit score brain
            hitScore: typeof computeHitScore === 'function' ? computeHitScore(p) : 0,
            img: headshot(bId),
            isStarting: isStarting
          };
        });

        // 3. Sort: Confirmed starters first, then highest Score
        const topTen = mapped
          .sort((a, b) => {
            if (a.isStarting && !b.isStarting) return -1;
            if (!a.isStarting && b.isStarting) return 1;
            return b.hitScore - a.hitScore;
          })
          .slice(0, 10);

        setCandidates(topTen);
      } catch (err) {
        console.error("57 Killer Crash:", err);
        setErrorInfo(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadKillerData();
  }, [selectedDate]);

  return (
    <div className="max-w-5xl mx-auto p-4 min-h-[600px]">
      <header className="mb-8 border-b border-[var(--border)] pb-6 flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-black italic tracking-tighter text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            57 <span className="text-red-500">KILLER</span>
          </h1>
          <p className="text-[var(--text-secondary)] font-bold uppercase text-xs tracking-widest mt-1">
            DiamondIQ Pro Optimization
          </p>
        </div>
        
        <input 
          type="date" 
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] rounded p-2 font-bold outline-none"
        />
      </header>

      {loading ? (
        <div className="py-20 text-center animate-pulse text-[var(--text-secondary)]">CONNECTING TO MLB DATA...</div>
      ) : errorInfo ? (
        <div className="p-10 bg-red-500/10 border border-red-500/50 rounded-2xl text-center">
          <p className="text-red-500 font-bold">{errorInfo}</p>
          <button 
            onClick={() => setSelectedDate("2026-03-05")} 
            className="mt-4 bg-red-500 text-white px-4 py-2 rounded font-bold"
          >
            Try Yesterday's Data
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {candidates.map((player, idx) => (
            <div 
              key={player.id || idx}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center gap-4 hover:border-red-500
