import Stripe from "stripe";

export async function onRequestPost({ env }) {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${env.SITE_ORIGIN}/products/koji-daicho/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.SITE_ORIGIN}/products/koji-daicho/`,
    });
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("create-checkout error:", e.message);
    return new Response(JSON.stringify({ error: "checkout_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
