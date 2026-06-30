/**
 * Cloudflare Pages Function: POST /api/stripe-webhook-anzen
 * シンプル安全台帳（単品）・セット購入 共用 Webhook
 * checkout.session.completed を受信し、Brevo でダウンロードリンク付きメールを送信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY           — Stripe シークレットキー
 *   STRIPE_WEBHOOK_SECRET_ANZEN — Webhook 署名シークレット（本エンドポイント専用）
 *   STRIPE_PRICE_ID_ANZEN       — シンプル安全台帳 単品 price ID
 *   STRIPE_PRICE_ID_SET         — セット（工事台帳＋安全台帳）price ID
 *   BREVO_API_KEY               — Brevo API キー
 *   BREVO_SENDER_EMAIL          — 送信元メールアドレス（Brevo認証済み）
 *   BREVO_SENDER_NAME           — 送信元名
 *   SITE_ORIGIN                 — サイトURL（例: https://kensetsu-tools.com）
 */

import Stripe from "stripe";

export async function onRequestPost({ request, env }) {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const sig = request.headers.get("stripe-signature");
  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET_ANZEN
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;

    if (s.payment_status !== "paid") return new Response("ok", { status: 200 });

    // line_items を展開して購入商品を特定
    const fullSession = await stripe.checkout.sessions.retrieve(s.id, {
      expand: ["line_items"],
    });
    const purchasedPriceId = fullSession.line_items?.data?.[0]?.price?.id;

    const isSet = env.STRIPE_PRICE_ID_SET && purchasedPriceId === env.STRIPE_PRICE_ID_SET;
    const isSingle = env.STRIPE_PRICE_ID_ANZEN && purchasedPriceId === env.STRIPE_PRICE_ID_ANZEN;

    // 本 Webhook が担当しない商品なら何もしない
    if (!isSet && !isSingle) return new Response("ok", { status: 200 });

    const email = s.customer_details?.email || s.customer_email;
    const dlAnzenUrl = `${env.SITE_ORIGIN}/api/download-anzen?session_id=${encodeURIComponent(s.id)}`;
    const dlSetUrl   = `${env.SITE_ORIGIN}/api/download-set?session_id=${encodeURIComponent(s.id)}`;

    if (email) {
      const subject = isSet
        ? "【建設業ツール工房】シンプル工事台帳＋安全台帳セット ダウンロードのご案内"
        : "【シンプル安全台帳】ダウンロードのご案内";

      const downloadSection = isSet
        ? `
    <p>下記のボタンからセット一括zipをダウンロードしてください。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dlSetUrl}"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        工事台帳＋安全台帳セットをダウンロード（.zip）
      </a>
    </div>`
        : `
    <p>下記のボタンからアプリをダウンロードしてください。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dlAnzenUrl}"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        シンプル安全台帳をダウンロード（.zip）
      </a>
    </div>`;

      const greeting = isSet
        ? "この度は「シンプル工事台帳 ライト版＋シンプル安全台帳 セット」をご購入いただき、ありがとうございます。"
        : "この度は「シンプル安全台帳」をご購入いただき、ありがとうございます。";

      const mailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            email: env.BREVO_SENDER_EMAIL,
            name: env.BREVO_SENDER_NAME,
          },
          to: [{ email }],
          subject,
          htmlContent: `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#1e293b;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0F2557;padding:16px 24px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-weight:bold;font-size:18px">建設業ツール工房</span>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:32px 24px">
    <p>${greeting}</p>
    ${downloadSection}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#374151">シンプル安全台帳 ご利用開始の手順</p>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.8">
        <li>ダウンロードした <strong>AnzenDaicho.App.exe</strong> をダブルクリック</li>
        <li>ライセンスキーの入力画面でキーを入力して有効化</li>
        <li>すぐにお使いいただけます</li>
      </ol>
    </div>
    <p style="font-size:13px;color:#374151;font-weight:bold">ライセンスキーについて</p>
    <p style="font-size:13px;color:#64748b;margin-top:4px">
      ご購入確認後、別途メールにてお送りします。<br>
      数分以内に届かない場合は迷惑メールフォルダをご確認ください。
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:13px;color:#64748b">
      ※このリンクはご購入者専用です。第三者への転送はご遠慮ください。<br>
      ※ダウンロードリンクは購入から30日間有効です。
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:13px;color:#64748b">
      うまくダウンロードできない場合や、ご不明点がございましたら<br>
      <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">contact@kensetsu-tools.com</a>
      までお気軽にご連絡ください。（営業日2〜3日以内に返信いたします）
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:12px;color:#94a3b8">
      このメールは <a href="https://kensetsu-tools.com" style="color:#0F2557">建設業ツール工房</a>
      でのご購入を受け付けたことをお知らせするものです。<br>
      心当たりのない場合は、このメールを無視してください。
    </p>
  </div>
</body>
</html>`,
        }),
      });
      if (!mailRes.ok) {
        const err = await mailRes.text();
        console.error("Brevo mail error:", mailRes.status, err);
      }
    }
  }

  return new Response("ok", { status: 200 });
}
