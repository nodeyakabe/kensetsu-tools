/**
 * Cloudflare Pages Function: POST /api/create-checkout-anzen-test
 * シンプル安全台帳 テストモード専用チェックアウトセッション作成
 *
 * ⚠️ テスト専用エンドポイント。本番の購入導線からは到達不可。
 *    入口ページ: /test/anzen/（URLを知っている人だけがアクセスできる）
 *
 * 本番エンドポイント（/api/create-checkout-anzen）は完全に別ファイルで無変更。
 *
 * 環境変数（本番変数とは別に Cloudflare Pages で追加設定が必要）:
 *   STRIPE_SECRET_KEY_TEST      — テストモードシークレットキー（sk_test_...）
 *   STRIPE_PRICE_ID_ANZEN_TEST  — テストモードの安全台帳 price ID（price_...）
 *   SITE_ORIGIN                 — サイトURL（本番と共用）
 */
import Stripe from "stripe";

export async function onRequestPost({ env }) {
  // テスト専用キーが未設定なら明示的にエラー（本番キーへのフォールバックを防ぐ）
  if (!env.STRIPE_SECRET_KEY_TEST) {
    return new Response(JSON.stringify({ error: "test_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY_TEST);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: env.STRIPE_PRICE_ID_ANZEN_TEST, quantity: 1 }],
      success_url: `${env.SITE_ORIGIN}/test/anzen/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.SITE_ORIGIN}/test/anzen/`,
    });
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("create-checkout-anzen-test error:", e.message);
    return new Response(JSON.stringify({ error: "checkout_failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
