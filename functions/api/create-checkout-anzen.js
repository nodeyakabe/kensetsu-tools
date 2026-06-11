/**
 * Cloudflare Pages Function: POST /api/create-checkout-anzen
 * シンプル安全台帳 専用チェックアウトセッション作成
 *
 * 環境変数:
 *   STRIPE_SECRET_KEY      — Stripe シークレットキー
 *   STRIPE_PRICE_ID_ANZEN  — シンプル安全台帳 の price ID
 *   SITE_ORIGIN            — サイトURL（例: https://kensetsu-tools.com）
 */
import Stripe from "stripe";

export async function onRequestPost({ env }) {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: env.STRIPE_PRICE_ID_ANZEN, quantity: 1 }],
      success_url: `${env.SITE_ORIGIN}/products/anzen-daicho/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.SITE_ORIGIN}/products/anzen-daicho/`,
    });
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("create-checkout-anzen error:", e.message);
    return new Response(JSON.stringify({ error: "checkout_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
