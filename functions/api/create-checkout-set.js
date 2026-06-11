/**
 * Cloudflare Pages Function: POST /api/create-checkout-set
 * シンプル工事台帳 + シンプル安全台帳 セット購入チェックアウト
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY    — Stripe シークレットキー
 *   STRIPE_PRICE_ID_SET  — セット専用 price ID（¥13,800 の単一 price をStripeで作成して使う）
 *   SITE_ORIGIN          — サイトURL
 *
 * ※ Stripe ダッシュボードで ¥13,800 のセット専用 Price を作成し、
 *   STRIPE_PRICE_ID_SET に設定してください。
 *   2商品を個別 line_item で合算すると ¥15,780 になり表示価格と食い違うため、
 *   セット専用 price を使う方式を採用しています。
 */
import Stripe from "stripe";

export async function onRequestPost({ env }) {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: env.STRIPE_PRICE_ID_SET, quantity: 1 }],
      success_url: `${env.SITE_ORIGIN}/products/anzen-daicho/thanks/?session_id={CHECKOUT_SESSION_ID}&set=1`,
      cancel_url: `${env.SITE_ORIGIN}/products/anzen-daicho/`,
    });
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("create-checkout-set error:", e.message);
    return new Response(JSON.stringify({ error: "checkout_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
