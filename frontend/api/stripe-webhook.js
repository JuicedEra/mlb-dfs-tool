// ── Stripe Webhook Handler (Vercel Serverless) ───────────────────────────
// Env vars needed in Vercel dashboard:
//   STRIPE_SECRET_KEY=sk_live_...
//   STRIPE_WEBHOOK_SECRET=whsec_...
//   SUPABASE_URL=https://your-project.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...  (service role, NOT anon)
//
// Stripe webhook setup:
//   1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
//   2. URL: https://your-domain.vercel.app/api/stripe-webhook
//   3. Events: checkout.session.completed, customer.subscription.deleted
//   4. Copy signing secret to STRIPE_WEBHOOK_SECRET env var

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;
    if (userId) {
      // Set is_pro = true on the Supabase user
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { is_pro: true, stripe_customer_id: session.customer },
      });
      if (error) console.error("Failed to update user:", error.message);
      else console.log(`✅ User ${userId} upgraded to PRO`);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    // Find user by stripe_customer_id and revoke PRO
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.user_metadata?.stripe_customer_id === sub.customer);
    if (user) {
      await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: { is_pro: false },
      });
      console.log(`⬇️ User ${user.id} downgraded from PRO`);
    }
  }

  res.json({ received: true });
}
