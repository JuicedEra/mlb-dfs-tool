// ── Stripe Checkout ───────────────────────────────────────────────────────
// Add to .env:
//   VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...  (or pk_test_...)
//   VITE_STRIPE_PRICE_ID=price_...           (your PRO monthly price)
//
// Stripe setup checklist:
//   1. Create product "DiamondIQ PRO" in Stripe dashboard
//   2. Add a recurring price (e.g. $9.99/mo)
//   3. Copy the price ID to .env
//   4. Deploy the webhook handler (see /api/stripe-webhook.js)
//   5. Set webhook secret in Vercel env vars

import { loadStripe } from "@stripe/stripe-js";

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const PRICE_ID   = import.meta.env.VITE_STRIPE_PRICE_ID || "";

export const HAS_STRIPE = !!(STRIPE_KEY && PRICE_ID);

let stripePromise = null;
function getStripe() {
  if (!stripePromise && STRIPE_KEY) {
    stripePromise = loadStripe(STRIPE_KEY);
  }
  return stripePromise;
}

/**
 * Redirect to Stripe Checkout for PRO subscription.
 * @param {string} userId — Supabase user ID (passed as client_reference_id)
 * @param {string} email  — pre-fill checkout email
 */
export async function redirectToCheckout(userId, email) {
  if (!HAS_STRIPE) {
    console.warn("Stripe not configured — add VITE_STRIPE_PUBLISHABLE_KEY and VITE_STRIPE_PRICE_ID to .env");
    return;
  }
  const stripe = await getStripe();
  if (!stripe) return;

  const { error } = await stripe.redirectToCheckout({
    lineItems: [{ price: PRICE_ID, quantity: 1 }],
    mode: "subscription",
    successUrl: `${window.location.origin}?upgraded=true`,
    cancelUrl: `${window.location.origin}?upgrade=cancelled`,
    clientReferenceId: userId || undefined,
    customerEmail: email || undefined,
  });

  if (error) console.error("Stripe redirect error:", error.message);
}
