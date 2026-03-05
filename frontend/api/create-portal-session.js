// ── Create Portal Session (Vercel Serverless) ─────────────────────────────
// POST /api/create-portal-session
// Body: { stripeCustomerId }

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { stripeCustomerId } = req.body;

  if (!stripeCustomerId) return res.status(400).json({ error: "stripeCustomerId required" });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: req.headers.origin || process.env.VITE_APP_URL,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Portal session error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
