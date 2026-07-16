/**
 * Cloudflare Pages Function: POST /api/stripe-webhook-banto
 * 建設番頭（単品）・建設番頭＋安全台帳セット 共用 Webhook
 * checkout.session.completed を受信し、ライセンスキーを生成してBrevoでメールを送信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY            — Stripe シークレットキー
 *   STRIPE_WEBHOOK_SECRET_BANTO  — Webhook 署名シークレット（本エンドポイント専用）
 *   STRIPE_PRICE_ID_BANTO        — 建設番頭 単品 price ID（Stripe登録後に設定）
 *   STRIPE_PRICE_ID_BANTO_SET    — 建設番頭＋安全台帳セット price ID（Stripe登録後に設定）
 *   KSBT_LICENSE_SECRET          — 建設番頭ライセンスキー生成用シークレット（HMAC-SHA256）
 *   ADAN_LICENSE_SECRET          — 安全台帳ライセンスキー生成用シークレット（セット購入時に使用）
 *   BREVO_API_KEY                — Brevo API キー
 *   BREVO_SENDER_EMAIL           — 送信元メールアドレス（Brevo認証済み）
 *   BREVO_SENDER_NAME            — 送信元名
 *   SITE_ORIGIN                  — サイトURL（例: https://kensetsu-tools.com）
 *
 * Stripe Webhook 登録:
 *   エンドポイントURL: https://kensetsu-tools.com/api/stripe-webhook-banto
 *   受信イベント: checkout.session.completed
 *   シークレット: STRIPE_WEBHOOK_SECRET_BANTO に設定
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
      env.STRIPE_WEBHOOK_SECRET_BANTO
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

    const isSet    = env.STRIPE_PRICE_ID_BANTO_SET && purchasedPriceId === env.STRIPE_PRICE_ID_BANTO_SET;
    const isSingle = env.STRIPE_PRICE_ID_BANTO     && purchasedPriceId === env.STRIPE_PRICE_ID_BANTO;

    // 本 Webhook が担当しない商品なら何もしない
    if (!isSet && !isSingle) return new Response("ok", { status: 200 });

    // KSBT ライセンスキーを生成（建設番頭）
    const ksbtKey = await generateLicenseKey('KSBT', env.KSBT_LICENSE_SECRET);

    // セット購入時は ADAN キーも生成（建設番頭＋安全台帳セット）
    const adanKey = isSet
      ? await generateLicenseKey('ADAN', env.ADAN_LICENSE_SECRET)
      : null;

    // 発行キーを Stripe payment_intent メタデータに記録
    // → 「キーをなくした」問い合わせ時に購入者メールから追跡可能にする
    if (s.payment_intent) {
      try {
        const metadata = {
          ksbt_license_key: ksbtKey,
          product: isSet ? 'SET_建設番頭+安全台帳' : 'KSBT_建設番頭単品',
          issued_at: new Date().toISOString(),
        };
        if (adanKey) metadata.adan_license_key = adanKey;

        await stripe.paymentIntents.update(s.payment_intent, { metadata });
      } catch (e) {
        console.error("Stripe metadata update error:", e);
        // metadata 記録失敗はメール送信を止めない
      }
    }

    const email = s.customer_details?.email || s.customer_email;
    const dlBantoUrl    = `${env.SITE_ORIGIN}/api/download-banto?session_id=${encodeURIComponent(s.id)}`;
    const dlBantoSetUrl = `${env.SITE_ORIGIN}/api/download-banto-set?session_id=${encodeURIComponent(s.id)}`;

    if (email) {
      const subject = isSet
        ? "【建設業ツール工房】建設番頭＋安全台帳セット ダウンロードのご案内"
        : "【建設番頭】ダウンロードのご案内";

      const greeting = isSet
        ? "この度は「建設番頭＋シンプル安全台帳 セット」をご購入いただき、ありがとうございます。"
        : "この度は「建設番頭」をご購入いただき、ありがとうございます。";

      const downloadSection = isSet
        ? `
    <p>下記のボタンからセット一括zipをダウンロードしてください。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dlBantoSetUrl}"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        建設番頭＋安全台帳セットをダウンロード（.zip）
      </a>
    </div>`
        : `
    <p>下記のボタンからアプリをダウンロードしてください。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dlBantoUrl}"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        建設番頭をダウンロード（.zip）
      </a>
    </div>`;

      // ライセンスキー表示（セット時は2本を明示）
      const licenseSection = isSet ? `
    <div style="background:#F0FDF4;border:2px solid #16A34A;border-radius:8px;padding:20px 24px;margin:24px 0">
      <p style="margin:0 0 12px;font-size:13px;font-weight:bold;color:#15803D">ライセンスキー（2本入りです。大切に保管してください）</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="border-bottom:1px solid #dcfce7">
          <td style="padding:8px 4px;color:#15803D;font-weight:bold;white-space:nowrap;vertical-align:top">建設番頭用</td>
          <td style="padding:8px 4px 8px 12px;font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:0.15em;color:#1e293b;word-break:break-all">${ksbtKey}</td>
        </tr>
        <tr>
          <td style="padding:8px 4px;color:#15803D;font-weight:bold;white-space:nowrap;vertical-align:top">安全台帳用</td>
          <td style="padding:8px 4px 8px 12px;font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:0.15em;color:#1e293b;word-break:break-all">${adanKey}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#64748b;line-height:1.8">
        それぞれのアプリの初回起動時に、対応するキーを入力してください。<br>
        キーをなくしてしまった場合は、ご購入時のメールアドレスで <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">お問い合わせ</a> ください。
      </p>
    </div>` : `
    <div style="background:#F0FDF4;border:2px solid #16A34A;border-radius:8px;padding:20px 24px;margin:24px 0">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#15803D">ライセンスキー（大切に保管してください）</p>
      <p style="margin:0 0 12px;font-family:monospace;font-size:24px;font-weight:bold;letter-spacing:0.18em;color:#1e293b;text-align:center;word-break:break-all">${ksbtKey}</p>
      <p style="margin:0;font-size:12px;color:#64748b;line-height:1.8">
        このキーは初回起動時に一度だけ入力します。入力後はこのメールを削除しても問題ありません。<br>
        キーをなくしてしまった場合は、ご購入時のメールアドレスで <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">お問い合わせ</a> ください。
      </p>
    </div>`;

      // 利用開始手順（セットは建設番頭の手順のみ記載。安全台帳も同様の手順のため）
      const stepsSection = isSet ? `
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#374151">ご利用開始の手順（2本とも同じ手順です）</p>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.8">
        <li>ダウンロードしたzipを解凍する</li>
        <li>各アプリの <strong>.exe</strong> ファイルをダブルクリック</li>
        <li>対応するライセンスキーを入力して有効化</li>
        <li>すぐにお使いいただけます</li>
      </ol>
    </div>` : `
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#374151">建設番頭 ご利用開始の手順</p>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.8">
        <li>ダウンロードしたzipを解凍する</li>
        <li><strong>KensetsuBanto.App.exe</strong> をダブルクリック</li>
        <li>上記のライセンスキーを入力して有効化</li>
        <li>すぐにお使いいただけます</li>
      </ol>
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
    ${stepsSection}
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
