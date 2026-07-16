/**
 * Cloudflare Pages Function: POST /api/stripe-webhook-anzen
 * シンプル安全台帳（単品）・セット購入 共用 Webhook
 * checkout.session.completed を受信し、ライセンスキーを生成してBrevoでメールを送信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY           — Stripe シークレットキー
 *   STRIPE_WEBHOOK_SECRET_ANZEN — Webhook 署名シークレット（本エンドポイント専用）
 *   STRIPE_PRICE_ID_ANZEN       — シンプル安全台帳 単品 price ID
 *   STRIPE_PRICE_ID_SET         — セット（工事台帳＋安全台帳）price ID
 *   ADAN_LICENSE_SECRET         — ライセンスキー生成用シークレット（HMAC-SHA256）
 *   BREVO_API_KEY               — Brevo API キー
 *   BREVO_SENDER_EMAIL          — 送信元メールアドレス（Brevo認証済み）
 *   BREVO_SENDER_NAME           — 送信元名
 *   SITE_ORIGIN                 — サイトURL（例: https://kensetsu-tools.com）
 */

import Stripe from "stripe";

/**
 * ライセンスキー生成
 * アルゴリズムはアプリ側 IsValidKey() と完全一致であること。
 * 出力形式: XXXX-XXXX-XXXX-XXXX-XXXX（全uppercase・ハイフン含む24文字）
 *
 * 大文字規則（事故要因・厳守）:
 *   data12     → uppercase hex
 *   HMAC msg   → data12 を uppercase のまま渡す（lowercase変換しない）
 *   checksum4  → uppercase hex 先頭4文字
 */
async function generateLicenseKey(prefix, secret) {
  if (!secret) throw new Error(`LICENSE_SECRET for "${prefix}" is not configured`);
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const data  = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const hex  = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  const checksum = hex.slice(0, 4);

  const full = prefix + data + checksum;
  return `${full.slice(0,4)}-${full.slice(4,8)}-${full.slice(8,12)}-${full.slice(12,16)}-${full.slice(16,20)}`;
}

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
    const items = fullSession.line_items?.data || [];

    const isSet    = env.STRIPE_PRICE_ID_SET   && items.some(li => li.price?.id === env.STRIPE_PRICE_ID_SET);
    const isSingle = env.STRIPE_PRICE_ID_ANZEN && items.some(li => li.price?.id === env.STRIPE_PRICE_ID_ANZEN);

    // 本 Webhook が担当しない商品なら何もしない
    if (!isSet && !isSingle) return new Response("ok", { status: 200 });

    // 冪等性チェック: 既にキーを発行済みなら処理をスキップ（Stripe リトライ対策）
    if (s.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(s.payment_intent);
        if (pi.metadata?.adan_license_key) {
          return new Response("ok", { status: 200 });
        }
      } catch (e) {
        console.error("Idempotency check error:", e);
      }
    }

    // ADAN ライセンスキーを生成（単品・セットともに ADAN キーが必要）
    // セットは工事台帳ライト版（Excel）+ 安全台帳 → Excel にキー不要なので ADAN の1本
    const adanKey = await generateLicenseKey('ADAN', env.ADAN_LICENSE_SECRET);

    // 発行キーを Stripe payment_intent メタデータに記録
    // → 「キーをなくした」問い合わせ時に購入者メールから追跡可能にする
    if (s.payment_intent) {
      try {
        await stripe.paymentIntents.update(s.payment_intent, {
          metadata: {
            adan_license_key: adanKey,
            product: isSet ? 'SET_工事台帳ライト+安全台帳' : 'ADAN_安全台帳単品',
            issued_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        console.error("Stripe metadata update error:", e);
        // metadata 記録失敗はメール送信を止めない
      }
    }

    const email = s.customer_details?.email || s.customer_email;
    const dlAnzenUrl = `${env.SITE_ORIGIN}/api/download-anzen?session_id=${encodeURIComponent(s.id)}`;
    const dlSetUrl   = `${env.SITE_ORIGIN}/api/download-set?session_id=${encodeURIComponent(s.id)}`;

    if (email) {
      const subject = isSet
        ? "【建設業ツール工房】シンプル工事台帳＋安全台帳セット ダウンロードのご案内"
        : "【シンプル安全台帳】ダウンロードのご案内";

      const greeting = isSet
        ? "この度は「シンプル工事台帳 ライト版＋シンプル安全台帳 セット」をご購入いただき、ありがとうございます。"
        : "この度は「シンプル安全台帳」をご購入いただき、ありがとうございます。";

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

      const licenseSection = `
    <div style="background:#F0FDF4;border:2px solid #16A34A;border-radius:8px;padding:20px 24px;margin:24px 0">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#15803D">ライセンスキー（大切に保管してください）</p>
      <p style="margin:0 0 12px;font-family:monospace;font-size:24px;font-weight:bold;letter-spacing:0.18em;color:#1e293b;text-align:center;word-break:break-all">${adanKey}</p>
      <p style="margin:0;font-size:12px;color:#64748b;line-height:1.8">
        このキーは初回起動時に一度だけ入力します。入力後はこのメールを削除しても問題ありません。<br>
        キーをなくしてしまった場合は、ご購入時のメールアドレスで <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">お問い合わせ</a> ください。
      </p>
    </div>`;

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
    ${licenseSection}
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#374151">シンプル安全台帳 ご利用開始の手順</p>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.8">
        <li>ダウンロードした <strong>AnzenDaicho.App.exe</strong> をダブルクリック</li>
        <li>上記のライセンスキーを入力して有効化</li>
        <li>すぐにお使いいただけます</li>
      </ol>
    </div>
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
