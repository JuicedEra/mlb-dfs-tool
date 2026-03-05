// ── Create Checkout Session (Vercel Serverless) ───────────────────────────
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { userId, email, priceId, plan } = req.body;

  if (!priceId) return res.status(400).json({ error: "priceId required" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe not configured" });

  try {
    const origin = req.headers.origin || req.headers.host || "https://www.diamondiq.pro";
    const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;

    const sessionParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}?upgraded=true`,
      cancel_url:  `${baseUrl}?upgrade=cancelled`,
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { userId: userId || "" },
      },
    };

    // If monthly plan, add annual upsell via custom_text
    if (plan === "monthly" && process.env.VITE_STRIPE_PRICE_ID_ANNUAL) {
      sessionParams.custom_text = {
        submit: {
          message: "💡 Switch to annual and save $61/year — cancel anytime."
        }
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
