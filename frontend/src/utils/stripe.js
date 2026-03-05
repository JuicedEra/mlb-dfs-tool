// ── Stripe Utilities ──────────────────────────────────────────────────────
// Env vars needed (Vercel + local .env):
//   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
//   VITE_STRIPE_PRICE_ID_MONTHLY=price_...
//   VITE_STRIPE_PRICE_ID_ANNUAL=price_...

const PRICE_MONTHLY = import.meta.env.VITE_STRIPE_PRICE_ID_MONTHLY || "";
const PRICE_ANNUAL  = import.meta.env.VITE_STRIPE_PRICE_ID_ANNUAL  || "";

export const HAS_STRIPE = !!(PRICE_MONTHLY);

export const PRICES = {
  monthly: { id: PRICE_MONTHLY, amount: "$14.99", label: "per month", savings: null },
  annual:  { id: PRICE_ANNUAL,  amount: "$119",   label: "per year",  savings: "Save $61" },
};

/**
 * Redirect to Stripe Checkout via server-side session creation.
 */
export async function redirectToCheckout(userId, email, plan = "monthly") {
  if (!HAS_STRIPE) {
    console.warn("Stripe not configured — add VITE_STRIPE_PRICE_ID_MONTHLY to env vars");
    return { error: "Stripe not configured" };
  }

  const priceId = plan === "annual" ? PRICE_ANNUAL : PRICE_MONTHLY;
  if (!priceId) return { error: `No price ID configured for ${plan} plan` };

  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, email, priceId }),
    });

    const data = await res.json();
    if (data.error) return { error: data.error };
    if (data.url) window.location.href = data.url;
    return {};
  } catch (err) {
    console.error("Checkout error:", err.message);
    return { error: err.message };
  }
}

/**
 * Open Stripe billing portal for subscription management.
 */
export async function openBillingPortal(stripeCustomerId) {
  if (!stripeCustomerId) return { error: "No Stripe customer ID found" };

  try {
    const res = await fetch("/api/create-portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stripeCustomerId }),
    });

    const data = await res.json();
    if (data.error) return { error: data.error };
    if (data.url) window.open(data.url, "_blank");
    return {};
  } catch (err) {
    console.error("Portal error:", err.message);
    return { error: err.message };
  }
}
