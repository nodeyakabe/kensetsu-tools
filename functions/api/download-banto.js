/**
 * Cloudflare Pages Function: GET /api/download-banto?session_id=...
 * Stripe session を検証し、支払い済みの場合のみ R2 から 建設番頭 をストリーム配信する
 * 単品（STRIPE_PRICE_ID_BANTO）・セット（STRIPE_PRICE_ID_BANTO_SET）どちらのセッションも受け付ける
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY          — Stripe シークレットキー
 *   STRIPE_PRICE_ID_BANTO      — 建設番頭 単品 price ID
 *   STRIPE_PRICE_ID_BANTO_SET  — 建設番頭＋安全台帳セット price ID
 *   PRODUCT_BUCKET             — R2 バインディング名（既存と共用）
 *   DOWNLOAD_OBJECT_KEY_BANTO  — R2 オブジェクトキー（例: kensetsu-banto-v1.zip）
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

  // 単品またはセットのどちらかであれば配信を許可
  const items = session.line_items?.data || [];
  const isBantoSingle = env.STRIPE_PRICE_ID_BANTO     && items.some(li => li.price?.id === env.STRIPE_PRICE_ID_BANTO);
  const isBantoSet    = env.STRIPE_PRICE_ID_BANTO_SET && items.some(li => li.price?.id === env.STRIPE_PRICE_ID_BANTO_SET);
  if (!isBantoSingle && !isBantoSet) {
    return new Response("product mismatch", { status: 403 });
  }

  // 30日以上経過したセッションを弾く
  if (session.created && Date.now() / 1000 - session.created > 60 * 60 * 24 * 30) {
    return new Response("expired", { status: 403 });
  }

  // R2 からストリーム配信
  const obj = await env.PRODUCT_BUCKET.get(env.DOWNLOAD_OBJECT_KEY_BANTO);
  if (!obj) return new Response("file not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        "attachment; filename=\"kensetsu-banto.zip\"; filename*=UTF-8''%E5%BB%BA%E8%A8%AD%E7%95%AA%E9%A0%AD.zip",
      "Cache-Control": "no-store",
    },
  });
}
