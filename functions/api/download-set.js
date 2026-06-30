/**
 * Cloudflare Pages Function: GET /api/download-set?session_id=...
 * セット（工事台帳＋安全台帳）専用。
 * Stripe session を検証し、支払い済みのセット購入者にのみ R2 から zip を配信する。
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY      — Stripe シークレットキー
 *   STRIPE_PRICE_ID_SET    — セット専用 price ID（検証用）
 *   PRODUCT_BUCKET         — R2 バインディング名（既存と共用）
 *   DOWNLOAD_OBJECT_KEY_SET — R2 オブジェクトキー（例: set-koji-anzen-v1.zip）
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

  // セット購入者のみ通過
  if (env.STRIPE_PRICE_ID_SET) {
    const ok = (session.line_items?.data || []).some(
      (li) => li.price?.id === env.STRIPE_PRICE_ID_SET
    );
    if (!ok) return new Response("product mismatch", { status: 403 });
  }

  // 30日以上経過したセッションを弾く
  if (session.created && Date.now() / 1000 - session.created > 60 * 60 * 24 * 30) {
    return new Response("expired", { status: 403 });
  }

  // R2 からストリーム配信
  const obj = await env.PRODUCT_BUCKET.get(env.DOWNLOAD_OBJECT_KEY_SET);
  if (!obj) return new Response("file not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        "attachment; filename=\"set.zip\"; filename*=UTF-8''%E3%82%B7%E3%83%B3%E3%83%97%E3%83%AB%E5%B7%A5%E4%BA%8B%E5%8F%B0%E5%B8%B3%EF%BC%8B%E5%AE%89%E5%85%A8%E5%8F%B0%E5%B8%B3%E3%82%BB%E3%83%83%E3%83%88.zip",
      "Cache-Control": "no-store",
    },
  });
}
