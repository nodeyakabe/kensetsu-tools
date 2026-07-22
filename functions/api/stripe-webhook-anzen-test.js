/**
 * Cloudflare Pages Function: POST /api/stripe-webhook-anzen-test
 * シンプル安全台帳 テストモード専用 Webhook
 *
 * ⚠️ テスト専用エンドポイント。
 *    Stripe テストモードのダッシュボードでこのURLを登録すること。
 *    本番 Webhook（/api/stripe-webhook-anzen）は完全に別ファイルで無変更。
 *
 * livemode チェック（二重安全策）:
 *   Stripe が送ってくるイベントの livemode フラグが true（本番）なら即 200 で無視する。
 *   テスト用署名シークレット（STRIPE_WEBHOOK_SECRET_ANZEN_TEST）での署名検証に加えて、
 *   この livemode チェックにより本番イベントが誤処理されることを防ぐ。
 *
 * 環境変数（本番変数とは別に Cloudflare Pages で追加設定が必要）:
 *   STRIPE_SECRET_KEY_TEST           — テストモードシークレットキー（sk_test_...）
 *   STRIPE_WEBHOOK_SECRET_ANZEN_TEST — テスト用 Webhook 署名シークレット（whsec_...）
 *   STRIPE_PRICE_ID_ANZEN_TEST       — テストモードの安全台帳単品 price ID
 *   ADAN_LICENSE_SECRET              — ライセンスキー生成シークレット（本番と共用）
 *   BREVO_API_KEY                    — Brevo API キー（本番と共用）
 *   BREVO_SENDER_EMAIL               — 送信元メールアドレス（本番と共用）
 *   BREVO_SENDER_NAME                — 送信元名（本番と共用）
 *   SITE_ORIGIN                      — サイトURL（本番と共用）
 */

import Stripe from "stripe";

/** ライセンスキー生成（本番 webhook と同一アルゴリズム） */
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
  if (!env.STRIPE_SECRET_KEY_TEST || !env.STRIPE_WEBHOOK_SECRET_ANZEN_TEST) {
    return new Response("test_not_configured", { status: 503 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY_TEST);
  const sig  = request.headers.get("stripe-signature");
  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET_ANZEN_TEST
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  // 二重安全策: 本番イベントが誤って届いても処理しない
  if (event.livemode === true) {
    console.warn("stripe-webhook-anzen-test: received livemode=true event, ignoring");
    return new Response("ok", { status: 200 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;

    if (s.payment_status !== "paid") return new Response("ok", { status: 200 });

    const fullSession = await stripe.checkout.sessions.retrieve(s.id, {
      expand: ["line_items"],
    });
    const items = fullSession.line_items?.data || [];

    const isSingle = env.STRIPE_PRICE_ID_ANZEN_TEST &&
      items.some(li => li.price?.id === env.STRIPE_PRICE_ID_ANZEN_TEST);

    if (!isSingle) return new Response("ok", { status: 200 });

    // 冪等性チェック
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

    const adanKey = await generateLicenseKey('ADAN', env.ADAN_LICENSE_SECRET);

    if (s.payment_intent) {
      try {
        await stripe.paymentIntents.update(s.payment_intent, {
          metadata: {
            adan_license_key: adanKey,
            product: 'ADAN_安全台帳単品_TEST',
            issued_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        console.error("Stripe metadata update error:", e);
      }
    }

    const email = s.customer_details?.email || s.customer_email;
    const dlUrl = `${env.SITE_ORIGIN}/api/download-anzen-test?session_id=${encodeURIComponent(s.id)}`;

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
            name:  env.BREVO_SENDER_NAME,
          },
          to: [{ email }],
          subject: "【テスト】シンプル安全台帳 ライセンスキーのご案内",
          htmlContent: `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#1e293b;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#92400e;padding:12px 24px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-weight:bold;font-size:16px">【テストモード】建設業ツール工房</span>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:32px 24px">
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 16px;margin-bottom:20px;font-size:13px;color:#92400e">
      ⚠️ これはテスト決済によるメールです。実際の課金は発生していません。
    </div>
    <p>テスト購入を受け付けました。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dlUrl}"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        シンプル安全台帳をダウンロード（.zip）
      </a>
    </div>
    <div style="background:#F0FDF4;border:2px solid #16A34A;border-radius:8px;padding:20px 24px;margin:24px 0">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#15803D">ライセンスキー（テスト発行）</p>
      <p style="margin:0 0 12px;font-family:monospace;font-size:24px;font-weight:bold;letter-spacing:0.18em;color:#1e293b;text-align:center;word-break:break-all">${adanKey}</p>
      <p style="margin:0;font-size:12px;color:#64748b">
        このキーを実アプリ（AnzenDaicho.App.exe）のライセンス認証画面に入力して動作確認してください。
      </p>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#374151">テスト確認手順</p>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.8">
        <li>上のボタンからzipをダウンロードできるか確認</li>
        <li>AnzenDaicho.App.exe を起動し、上のADANキーを入力</li>
        <li>「有効化」ボタンでライセンスが通ることを確認</li>
        <li>Stripeテストダッシュボードで決済メタデータにキーが記録されているか確認</li>
      </ol>
    </div>
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
