/**
 * Cloudflare Pages Function: POST /api/stripe-webhook
 * Stripe の checkout.session.completed イベントを受信し、
 * Brevo でダウンロードリンク付きメールを購入者に送信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY      — Stripe シークレットキー（Secret）
 *   STRIPE_WEBHOOK_SECRET  — webhook 署名シークレット（Secret）
 *   BREVO_API_KEY          — Brevo API キー
 *   BREVO_SENDER_EMAIL     — 送信元メールアドレス（Brevo認証済み）
 *   BREVO_SENDER_NAME      — 送信元名
 *   SITE_ORIGIN            — サイトURL（例: https://kensetsu-tools.com）
 */

import Stripe from "stripe";

export async function onRequestPost({ request, env }) {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const sig = request.headers.get("stripe-signature");
  const body = await request.text(); // 生 body 必須（署名検証のため改変不可）

  let event;
  try {
    // Workers/Edge では async 版を使う（crypto.subtle 使用）
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;

    // 非同期決済（銀行振込等）で payment_status が unpaid の場合はメール送信しない
    if (s.payment_status !== "paid") return new Response("ok", { status: 200 });

    const email = s.customer_details?.email || s.customer_email;
    const dlUrl = `${env.SITE_ORIGIN}/api/download?session_id=${encodeURIComponent(s.id)}`;

    if (email) {
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
          subject: "【シンプル工事台帳】ダウンロードのご案内",
          htmlContent: `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#1e293b;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0F2557;padding:16px 24px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-weight:bold;font-size:18px">建設業ツール工房</span>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:32px 24px">
    <p>この度は「シンプル工事台帳 ライト版」をご購入いただき、ありがとうございます。</p>
    <p>下記のボタンから Excel ファイルをダウンロードしてください。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dlUrl}"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        シンプル工事台帳 ライト版をダウンロード
      </a>
    </div>
    <p style="font-size:13px;color:#64748b">
      ※このリンクはご購入者専用です。第三者への転送はご遠慮ください。<br>
      ※ダウンロードリンクは購入から30日間有効です。
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:13px;color:#64748b">
      うまくダウンロードできない場合や、ご不明点がございましたら<br>
      <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">contact@kensetsu-tools.com</a>
      までお気軽にご連絡ください。<br>
      （営業日2〜3日以内に返信いたします）
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

  // 2xx を返さないと Stripe が再送し続けるため必ず返す
  return new Response("ok", { status: 200 });
}
