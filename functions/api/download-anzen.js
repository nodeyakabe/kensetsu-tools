/**
 * Cloudflare Pages Function: GET /api/download-anzen?session_id=...
 * Stripe session を検証し、支払い済みの場合のみ R2 から exe をストリーム配信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY         — Stripe シークレットキー
 *   STRIPE_PRICE_ID_ANZEN     — 対象商品の price ID（任意。商品一致検証用）
 *   PRODUCT_BUCKET            — R2 バインディング名（既存と共用可）
 *   DOWNLOAD_OBJECT_KEY_ANZEN — R2 オブジェクトキー（例: anzen-daicho-v1.exe）
 */

import Stripe from "stripe";

export async function onRequestGet({ request, env }) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return new Response("missing session_id", { status: 400 });

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
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

  // 当該商品か検証
  if (env.STRIPE_PRICE_ID_ANZEN) {
    const ok = (session.line_items?.data || []).some(
      (li) => li.price?.id === env.STRIPE_PRICE_ID_ANZEN
    );
    if (!ok) return new Response("product mismatch", { status: 403 });
  }

  // 30日以上経過したセッションを弾く
  if (session.created && Date.now() / 1000 - session.created > 60 * 60 * 24 * 30) {
    return new Response("expired", { status: 403 });
  }

  // R2 からストリーム配信
  const obj = await env.PRODUCT_BUCKET.get(env.DOWNLOAD_OBJECT_KEY_ANZEN);
  if (!obj) return new Response("file not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename=\"AnzenDaicho.App.exe\"; filename*=UTF-8''%E3%82%B7%E3%83%B3%E3%83%97%E3%83%AB%E5%AE%89%E5%85%A8%E5%8F%B0%E5%B8%B3_v1.exe",
      "Cache-Control": "no-store",
    },
  });
}
