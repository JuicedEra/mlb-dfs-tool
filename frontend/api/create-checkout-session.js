// ── Create Checkout Session (Vercel Serverless) ───────────────────────────
// POST /api/create-checkout-session
// Body: { userId, email, priceId }

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { userId, email, priceId } = req.body;

  if (!priceId) return res.status(400).json({ error: "priceId required" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.origin || process.env.VITE_APP_URL}?upgraded=true`,
      cancel_url:  `${req.headers.origin || process.env.VITE_APP_URL}?upgrade=cancelled`,
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
      subscription_data: {
        metadata: { userId: userId || "" },
      },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
