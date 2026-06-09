/**
 * Cloudflare Pages Function: GET /api/download?session_id=...
 * Stripe session を検証し、支払い済みの場合のみ R2 から Excel をストリーム配信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY    — Stripe シークレットキー（Secret）
 *   STRIPE_PRICE_ID      — 対象商品の price ID（任意。商品一致検証用）
 *   PRODUCT_BUCKET       — R2 バインディング名（バインド名 PRODUCT_BUCKET）
 *   DOWNLOAD_OBJECT_KEY  — R2 オブジェクトキー（例: koji-daicho-light-v1.xlsx）
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

  // 支払い済みか
  if (session.payment_status !== "paid") {
    return new Response("not paid", { status: 403 });
  }

  // （推奨）当該商品か検証
  if (env.STRIPE_PRICE_ID) {
    const ok = (session.line_items?.data || []).some(
      (li) => li.price?.id === env.STRIPE_PRICE_ID
    );
    if (!ok) return new Response("product mismatch", { status: 403 });
  }

  // 古すぎるセッションは弾く（30日）
  if (session.created && Date.now() / 1000 - session.created > 60 * 60 * 24 * 30) {
    return new Response("expired", { status: 403 });
  }

  // R2 からストリーム配信
  const obj = await env.PRODUCT_BUCKET.get(env.DOWNLOAD_OBJECT_KEY);
  if (!obj) return new Response("file not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="シンプル工事台帳_ライト版_v1.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
