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
//   3. Events to enable:
//        checkout.session.completed
//        customer.subscription.deleted
//        customer.subscription.updated
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

// Helper: find a Supabase user by Stripe customer ID
async function findUserByCustomerId(customerId) {
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  return users?.find(u => u.user_metadata?.stripe_customer_id === customerId) || null;
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

  // ── Checkout completed: user starts trial or subscribes directly ──────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;
    if (userId) {
      // Retrieve the subscription to check if it's a trial
      let isTrial = false;
      if (session.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          isTrial = sub.status === "trialing";
        } catch (e) { console.warn("Could not retrieve subscription:", e.message); }
      }

      const metadata = {
        is_pro: true,
        stripe_customer_id: session.customer,
        // Mark trial_used on first-ever trial — prevents re-use across payment methods on same account
        ...(isTrial ? { trial_used: true, trial_started_at: new Date().toISOString() } : {}),
      };

      const { error } = await supabase.auth.admin.updateUserById(userId, { user_metadata: metadata });
      if (error) console.error("Failed to update user:", error.message);
      else console.log(`✅ User ${userId} ${isTrial ? "started trial" : "upgraded to PRO"}`);
    }
  }

  // ── Subscription updated: trial converted to active → keep PRO ───────────
  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object;
    if (sub.status === "active") {
      const user = await findUserByCustomerId(sub.customer);
      if (user && !user.user_metadata?.is_pro) {
        await supabase.auth.admin.updateUserById(user.id, { user_metadata: { is_pro: true } });
        console.log(`✅ User ${user.id} trial converted to active PRO`);
      }
    }
    // Payment failure — suspend PRO access
    if (sub.status === "past_due" || sub.status === "unpaid") {
      const user = await findUserByCustomerId(sub.customer);
      if (user) {
        await supabase.auth.admin.updateUserById(user.id, { user_metadata: { is_pro: false } });
        console.log(`⚠️ User ${user.id} PRO suspended (${sub.status})`);
      }
    }
  }

  // ── Subscription deleted: cancel or trial abandoned → revoke PRO ──────────
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const user = await findUserByCustomerId(sub.customer);
    if (user) {
      await supabase.auth.admin.updateUserById(user.id, { user_metadata: { is_pro: false } });
      console.log(`⬇️ User ${user.id} downgraded from PRO`);
    }
  }

  res.json({ received: true });
}
