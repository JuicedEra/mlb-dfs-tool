// ── Supabase Client + DB helpers ──────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const HAS_AUTH = !!(SUPABASE_URL && SUPABASE_KEY);

export const supabase = HAS_AUTH
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ── Pick Tracker: Supabase-backed persistence ─────────────────────────────
const LOCAL_KEY = "diamondiq_picks_v1";

function localLoad() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); }
  catch { return []; }
}
function localSave(picks) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(picks)); } catch {}
}

/** Load picks for current user. Returns [] on error. */
export async function dbLoadPicks(userId) {
  if (!supabase || !userId) return localLoad();
  try {
    const { data, error } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", userId)
      .order("picked_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn("dbLoadPicks fallback to localStorage:", e.message);
    return localLoad();
  }
}

/** Save a single pick. Returns saved pick or null. */
export async function dbSavePick(userId, pick) {
  const season = new Date(pick.gameDate || new Date()).getFullYear();
  const row = {
    user_id:     userId,
    player_id:   pick.playerId,
    player_name: pick.playerName,
    game_pk:     pick.gamePk,
    game_date:   pick.gameDate,
    score:       pick.score,
    tier:        pick.tier,
    mode:        pick.mode || "bts",
    result:      pick.result || "pending",
    hits:        pick.hits   ?? null,
    at_bats:     pick.atBats ?? null,
    picked_at:   pick.pickedAt || new Date().toISOString(),
    season,
  };
  if (!supabase || !userId) {
    const existing = localLoad();
    const merged = [row, ...existing.filter(p => !(p.player_id === row.player_id && p.game_date === row.game_date))];
    localSave(merged);
    return row;
  }
  try {
    const { data, error } = await supabase
      .from("picks")
      .upsert(row, { onConflict: "user_id,player_id,game_date" })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn("dbSavePick error:", e.message);
    return null;
  }
}

/** Update pick result (called by auto-resolve). */
export async function dbUpdatePickResult(userId, playerId, gameDate, result, hits, atBats) {
  if (!supabase || !userId) {
    const picks = localLoad();
    const updated = picks.map(p =>
      p.player_id === playerId && p.game_date === gameDate
        ? { ...p, result, hits, at_bats: atBats } : p
    );
    localSave(updated);
    return;
  }
  try {
    await supabase
      .from("picks")
      .update({ result, hits, at_bats: atBats })
      .eq("user_id", userId)
      .eq("player_id", playerId)
      .eq("game_date", gameDate);
  } catch (e) {
    console.warn("dbUpdatePickResult error:", e.message);
  }
}

/** Delete a pick. */
export async function dbDeletePick(userId, playerId, gameDate) {
  if (!supabase || !userId) {
    const picks = localLoad();
    localSave(picks.filter(p => !(p.player_id === playerId && p.game_date === gameDate)));
    return;
  }
  try {
    await supabase
      .from("picks")
      .delete()
      .eq("user_id", userId)
      .eq("player_id", playerId)
      .eq("game_date", gameDate);
  } catch (e) {
    console.warn("dbDeletePick error:", e.message);
  }
}

// ── Leaderboard appearances ───────────────────────────────────────────────

/** Record that a user appeared on the leaderboard today. */
export async function dbRecordLeaderboardAppearance(userId, rank) {
  if (!supabase || !userId) return;
  const today = new Date().toLocaleDateString("en-CA");
  try {
    await supabase
      .from("leaderboard_appearances")
      .upsert({ user_id: userId, appearance_date: today, rank }, { onConflict: "user_id,appearance_date" });
  } catch (e) {
    console.warn("dbRecordLeaderboardAppearance error:", e.message);
  }
}

/** Load total leaderboard appearance count for a user. */
export async function dbLoadLeaderboardDays(userId) {
  if (!supabase || !userId) return 0;
  try {
    const { count, error } = await supabase
      .from("leaderboard_appearances")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.warn("dbLoadLeaderboardDays error:", e.message);
    return 0;
  }
}

// ── Backtester usage tracking ─────────────────────────────────────────────
const BT_LOCAL_KEY = "diamondiq_bt_usage";

function btLocalLoad() {
  try { return JSON.parse(localStorage.getItem(BT_LOCAL_KEY) || "[]"); }
  catch { return []; }
}
function btLocalSave(entries) {
  try { localStorage.setItem(BT_LOCAL_KEY, JSON.stringify(entries)); } catch {}
}

/** Returns number of backtests used in the last 7 days. */
export async function btGetWeeklyUsage(userId) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (!supabase || !userId) {
    const entries = btLocalLoad().filter(e => e.used_at > cutoff);
    btLocalSave(entries);
    return entries.length;
  }
  try {
    const { count, error } = await supabase
      .from("backtester_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("used_at", cutoff);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.warn("btGetWeeklyUsage error:", e.message);
    return 0;
  }
}

/** Record one backtest usage. */
export async function btRecordUsage(userId) {
  const entry = { used_at: new Date().toISOString() };
  if (!supabase || !userId) {
    const entries = btLocalLoad();
    entries.push(entry);
    btLocalSave(entries);
    return;
  }
  try {
    await supabase
      .from("backtester_usage")
      .insert({ user_id: userId, used_at: entry.used_at });
  } catch (e) {
    console.warn("btRecordUsage error:", e.message);
  }
}

// ── Equipped avatar helper ────────────────────────────────────────────────
// Shared lookup so header, pick tracker, and leaderboard all stay in sync.

export const ACHIEVEMENT_EMOJIS = {
  // Starter avatars (always available)
  default_target:"🎯", default_cap:"🧢", default_chart:"📊",
  default_dice:"🎲", default_clipboard:"📋",
  // PRO-only
  pro_diamond:"💎",
  // Picks unlocks
  rookie:"⚾", prospect:"🔥", allstar:"⭐", veteran:"🏆", legend:"🏆",
  diamond:"💠", centurion:"🦅", grandmaster:"👑", immortal:"🌟",
  // Streak unlocks
  streak3:"🔥", streak5:"🌶️", streak10:"⚡", streak15:"🎯", streak20:"🤖",
  streak25:"⚾", streak30:"🏅", streak35:"🔮", streak40:"🌠", streak45:"✨",
  streak50:"🏆", streak55:"💠", streak57:"💰",
  // Leaderboard unlocks
  lb1:"📊", lb2:"📈", lb5:"🎖️", lb10:"🥊", lb20:"🔭",
  lb50:"🏅", lb100:"💡", lb365:"📅", lb500:"🌟", lb1000:"👑",
};

export function getEquippedEmoji() {
  try {
    const id = localStorage.getItem("diamondiq_equipped_avatar") || "default_target";
    return ACHIEVEMENT_EMOJIS[id] || "🎯";
  } catch { return "🎯"; }
}
