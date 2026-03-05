// ── Create Portal Session (Vercel Serverless) ─────────────────────────────
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { stripeCustomerId } = req.body;

  if (!stripeCustomerId) return res.status(400).json({ error: "stripeCustomerId required" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

  try {
    const origin = req.headers.origin || req.headers.host || "https://www.diamondiq.pro";
    const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: baseUrl,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Portal session error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
