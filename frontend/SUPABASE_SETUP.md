# DiamondIQ — Supabase Setup Guide

## Step 1 — Create Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name: `diamondiq`, choose a region, set a DB password
3. Wait ~2 min for provisioning

---

## Step 2 — Get API Keys

**Settings → API** in your Supabase dashboard:
- **Project URL** → `https://xxxxx.supabase.co`
- **anon public key** → `eyJhb...`
- **service_role key** → needed for the Stripe webhook only (never expose in frontend)

---

## Step 3 — Run the Database Schema

Go to **SQL Editor** and run this entire block:

```sql
-- picks table
CREATE TABLE picks (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id     integer NOT NULL,
  player_name   text NOT NULL,
  game_pk       integer,
  game_date     date NOT NULL,
  score         integer,
  tier          text,
  mode          text DEFAULT 'bts',
  result        text DEFAULT 'pending',
  hits          integer,
  at_bats       integer,
  picked_at     timestamptz DEFAULT now(),
  UNIQUE(user_id, player_id, game_date)
);
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own picks" ON picks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- backtester_usage table (tracks free user quota: 5/week)
CREATE TABLE backtester_usage (
  id       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at  timestamptz DEFAULT now()
);
ALTER TABLE backtester_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own usage" ON backtester_usage
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_bt_usage_user_date ON backtester_usage(user_id, used_at DESC);

-- subscriptions table (written by Stripe webhook, read by app)
CREATE TABLE subscriptions (
  id                     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text DEFAULT 'active',
  plan                   text DEFAULT 'edge',
  current_period_end     timestamptz,
  created_at             timestamptz DEFAULT now()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own subscription" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```

---

## Step 4 — Configure Auth

**Authentication → Providers:** enable Email (confirm email ON) and Google (see below).

**Authentication → URL Configuration:**
- Site URL: `https://your-app.vercel.app`
- Redirect URLs: `https://your-app.vercel.app` and `http://localhost:5173`

**Google OAuth:** Google Cloud Console → Credentials → OAuth 2.0 Client ID → Authorized redirect URI: `https://xxxxx.supabase.co/auth/v1/callback` → paste Client ID + Secret into Supabase → Auth → Providers → Google.

---

## Step 5 — Stripe

1. Create product **DiamondIQ Edge** with two prices: $14.99/mo and $119/yr
2. Webhook endpoint: `https://your-app.vercel.app/api/stripe-webhook`
3. Events: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`
4. Copy the webhook signing secret

---

## Step 6 — Vercel Environment Variables

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon/public key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |
| `VITE_STRIPE_PRICE_ID_MONTHLY` | monthly price ID |
| `VITE_STRIPE_PRICE_ID_ANNUAL` | annual price ID |
| `STRIPE_SECRET_KEY` | `sk_live_...` (server-side only) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `SUPABASE_URL` | same as VITE version (no prefix, for webhook) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (server-side only) |
| `VITE_ODDS_API_KEY` | optional |

Redeploy after adding variables.

---

## Step 7 — Verify

1. Sign up → check for verification email → sign in
2. Add a pick → refresh → confirm it persists
3. Run a backtest → check `backtester_usage` table in Supabase
4. Test Stripe checkout with a test card → confirm `subscriptions` row created
