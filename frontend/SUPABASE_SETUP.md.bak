# DiamondIQ — Supabase Setup Guide

## 1. Create a Supabase Project (Free)

1. Go to [supabase.com](https://supabase.com) and sign up / sign in
2. Click **New Project**
3. Name it `diamondiq` (or whatever you like)
4. Set a **database password** (save it somewhere)
5. Choose a region closest to your users (e.g., US East)
6. Click **Create new project** — takes ~2 minutes

## 2. Get Your API Keys

Go to **Settings → API** in your Supabase dashboard.

You need two values:
- **Project URL** → `https://xxxxx.supabase.co`
- **anon (public) key** → `eyJhb...` (the public one, NOT the service role key)

Add these to your `.env` file:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your_anon_key_here
```

## 3. Enable Email Auth (Already On by Default)

Go to **Authentication → Providers** and confirm **Email** is enabled.

Settings to configure:
- **Confirm email**: ON (sends verification email on signup)
- **Secure email change**: ON
- **Minimum password length**: 6

### Custom Email Templates (Optional but Recommended)
Go to **Authentication → Email Templates** and customize:
- **Confirm signup**: "Welcome to DiamondIQ — verify your email"
- **Reset password**: "DiamondIQ password reset"
- **Magic link**: (optional)

## 4. Enable Google OAuth (Optional)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Go to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `https://xxxxx.supabase.co/auth/v1/callback`
7. Copy the **Client ID** and **Client Secret**

Back in Supabase:
1. Go to **Authentication → Providers → Google**
2. Toggle it ON
3. Paste Client ID and Client Secret
4. Save

## 5. Set Up Stripe for Subscriptions (Optional)

1. Go to [stripe.com](https://stripe.com) and create an account
2. Create a **Product** called "DiamondIQ PRO"
3. Add two **Prices**:
   - Monthly: $9.99/month (or your price)
   - Yearly: $79.99/year (or your price)
4. Copy the **Publishable Key** from Developers → API Keys
5. Copy the **Price ID** from the product page

Add to `.env`:
```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_STRIPE_PRICE_ID=price_...
```

### Stripe Webhook (for auto-upgrading users)
1. In Stripe → Developers → Webhooks → Add endpoint
2. URL: `https://your-domain.vercel.app/api/stripe-webhook`
3. Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`
4. Copy the webhook signing secret

In Supabase, create a `subscriptions` table:
```sql
CREATE TABLE subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text DEFAULT 'active',
  plan text DEFAULT 'pro',
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- Enable Row Level Security
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription
CREATE POLICY "Users can read own subscription" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```

## 6. Live Betting Odds (Optional)

1. Go to [the-odds-api.com](https://the-odds-api.com) and sign up (free: 500 req/month)
2. Copy your API key

Add to `.env`:
```
VITE_ODDS_API_KEY=your_key_here
```

## 7. Deploy to Vercel

```bash
cd frontend
npm install
npx vercel
```

Set environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY` (optional)
- `VITE_STRIPE_PRICE_ID` (optional)
- `VITE_ODDS_API_KEY` (optional)

## 8. Redirect URLs

In Supabase → Authentication → URL Configuration:
- **Site URL**: `https://your-domain.vercel.app`
- **Redirect URLs**: Add `https://your-domain.vercel.app` and `http://localhost:5173` (for local dev)

## Summary of .env Variables

```env
# Required — Auth
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhb...

# Optional — Payments
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_STRIPE_PRICE_ID=price_...

# Optional — Live Odds
VITE_ODDS_API_KEY=...
```

The app gracefully degrades when optional keys are missing:
- No Supabase → Dev mode with PRO toggle, no auth gate
- No Stripe → Shows alert instead of checkout
- No Odds API → "Not connected" in sidebar, no prop lines
