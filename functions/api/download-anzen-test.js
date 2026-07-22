/**
 * Cloudflare Pages Function: GET /api/download-anzen-test?session_id=...
 * シンプル安全台帳 テストモード専用ダウンロード
 *
 * ⚠️ テスト専用エンドポイント。テスト用 Checkout Session を検証するため
 *    テストモードの STRIPE_SECRET_KEY_TEST を使う（本番キーでは取得不可）。
 *    本番ダウンロード（/api/download-anzen）は完全に別ファイルで無変更。
 *
 * 配信ファイルは本番と同じ R2 オブジェクト（DOWNLOAD_OBJECT_KEY_ANZEN）を使用。
 *
 * 環境変数:
 *   STRIPE_SECRET_KEY_TEST      — テストモードシークレットキー（sk_test_...）
 *   STRIPE_PRICE_ID_ANZEN_TEST  — テストモードの安全台帳 price ID（検証用）
 *   PRODUCT_BUCKET              — R2 バインディング名（本番と共用）
 *   DOWNLOAD_OBJECT_KEY_ANZEN   — R2 オブジェクトキー（本番と共用）
 */

import Stripe from "stripe";

export async function onRequestGet({ request, env }) {
  if (!env.STRIPE_SECRET_KEY_TEST) {
    return new Response("test_not_configured", { status: 503 });
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return new Response("missing session_id", { status: 400 });

  const stripe = new Stripe(env.STRIPE_SECRET_KEY_TEST);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    });
  } catch {
    return new Response("invalid session", { status: 403 });
  }

  if (session.payment_status !== "paid") {
    return new Response("not paid", { status: 403 });
  }

  // 当該テスト商品か検証
  if (env.STRIPE_PRICE_ID_ANZEN_TEST) {
    const ok = (session.line_items?.data || []).some(
      (li) => li.price?.id === env.STRIPE_PRICE_ID_ANZEN_TEST
    );
    if (!ok) return new Response("product mismatch", { status: 403 });
  }

  // 二重安全策: 本番セッションが誤って送られてきても弾く
  if (session.livemode === true) {
    return new Response("livemode session not allowed on test endpoint", { status: 403 });
  }

  // 30日以上経過したセッションを弾く
  if (session.created && Date.now() / 1000 - session.created > 60 * 60 * 24 * 30) {
    return new Response("expired", { status: 403 });
  }

  // R2 からストリーム配信（本番と同じファイル）
  const obj = await env.PRODUCT_BUCKET.get(env.DOWNLOAD_OBJECT_KEY_ANZEN);
  if (!obj) return new Response("file not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        "attachment; filename=\"anzen-daicho.zip\"; filename*=UTF-8''%E3%82%B7%E3%83%B3%E3%83%97%E3%83%AB%E5%AE%89%E5%85%A8%E5%8F%B0%E5%B8%B3.zip",
      "Cache-Control": "no-store",
    },
  });
}
