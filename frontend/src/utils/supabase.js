// ── Supabase Client ───────────────────────────────────────────────────────
// Add these to your .env:
//   VITE_SUPABASE_URL=https://your-project.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-key
//
// Supabase setup checklist:
//   1. Create project at supabase.com
//   2. Enable Email + Google auth in Authentication → Providers
//   3. Copy URL + anon key to .env
//   4. Add site URL to Authentication → URL Configuration

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const HAS_AUTH = !!(SUPABASE_URL && SUPABASE_KEY);

export const supabase = HAS_AUTH
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;
