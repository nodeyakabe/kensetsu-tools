/**
 * Cloudflare Pages Function: GET /api/download-banto-set?session_id=...
 * Stripe session を検証し、支払い済みの場合のみ R2 から 建設番頭＋安全台帳 セット zip をストリーム配信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY              — Stripe シークレットキー
 *   STRIPE_PRICE_ID_BANTO_SET      — 建設番頭＋安全台帳セット price ID
 *   PRODUCT_BUCKET                 — R2 バインディング名（既存と共用）
 *   DOWNLOAD_OBJECT_KEY_BANTO_SET  — R2 オブジェクトキー（例: banto-anzen-set-v1.zip）
 *
 * R2 に格納するファイル:
 *   KensetsuBanto.App.exe と AnzenDaicho.App.exe を1つの zip にまとめてアップロード
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

  // セット price ID の検証
  if (env.STRIPE_PRICE_ID_BANTO_SET) {
    const ok = (session.line_items?.data || []).some(
      li => li.price?.id === env.STRIPE_PRICE_ID_BANTO_SET
    );
    if (!ok) return new Response("product mismatch", { status: 403 });
  }

  // 30日以上経過したセッションを弾く
  if (session.created && Date.now() / 1000 - session.created > 60 * 60 * 24 * 30) {
    return new Response("expired", { status: 403 });
  }

  // R2 からストリーム配信
  const obj = await env.PRODUCT_BUCKET.get(env.DOWNLOAD_OBJECT_KEY_BANTO_SET);
  if (!obj) return new Response("file not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        "attachment; filename=\"banto-anzen-set.zip\"; filename*=UTF-8''%E5%BB%BA%E8%A8%AD%E7%95%AA%E9%A0%AD-%E5%AE%89%E5%85%A8%E5%8F%B0%E5%B8%B3-%E3%82%BB%E3%83%83%E3%83%88.zip",
      "Cache-Control": "no-store",
    },
  });
}
