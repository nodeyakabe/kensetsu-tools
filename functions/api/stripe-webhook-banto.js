/**
 * Cloudflare Pages Function: POST /api/stripe-webhook-banto
 * 建設番頭（単品）・建設番頭＋安全台帳セット 共用 Webhook
 * checkout.session.completed を受信し、ライセンスキーを生成してBrevoでメールを送信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   STRIPE_SECRET_KEY              — Stripe シークレットキー
 *   STRIPE_WEBHOOK_SECRET_BANTO    — Webhook 署名シークレット（本エンドポイント専用）
 *   STRIPE_PRICE_ID_BANTO          — 建設番頭 単品 price ID（Stripe登録後に設定）
 *   STRIPE_PRICE_ID_BANTO_SET      — 建設番頭＋安全台帳セット price ID（Stripe登録後に設定）
 *   KSBT_ECDSA_PRIVATE_KEY_B64     — 建設番頭ライセンスキー発行用 ECDSA P-256 秘密鍵（PKCS#8 DER の Base64）
 *   ADAN_ECDSA_PRIVATE_KEY_B64     — 安全台帳ライセンスキー発行用 ECDSA P-256 秘密鍵（セット購入時に使用）
 *   BREVO_API_KEY                  — Brevo API キー
 *   BREVO_SENDER_EMAIL             — 送信元メールアドレス（Brevo認証済み）
 *   BREVO_SENDER_NAME              — 送信元名
 *   SITE_ORIGIN                    — サイトURL（例: https://kensetsu-tools.com）
 *
 * Stripe Webhook 登録:
 *   エンドポイントURL: https://kensetsu-tools.com/api/stripe-webhook-banto
 *   受信イベント: checkout.session.completed
 *   シークレット: STRIPE_WEBHOOK_SECRET_BANTO に設定
 */

import Stripe from "stripe";
import { base32Encode } from "./_lib/base32.js";

/**
 * ECDSA P-256 ライセンスキー生成
 * アルゴリズムはアプリ側 LicenseService.IsValidKey() と完全一致であること。
 *
 * 出力形式（正規化）: {PREFIX}{Base32(nonce8+sig64)} = 120文字
 * 署名対象: UTF8(prefix) + nonce (12バイト)
 * 署名形式: IEEE P1363 (64バイト固定) — Web Crypto のデフォルト
 *
 * @param {string} prefix - 'KSBT' | 'ADAN' | 'PCKS'
 * @param {string} privateKeyB64 - PKCS#8 DER の Base64
 * @returns {{ key: string, nonce: Uint8Array }} key: 正規化120文字キー
 */
async function generateLicenseKey(prefix, privateKeyB64) {
  if (!privateKeyB64) throw new Error(`ECDSA_PRIVATE_KEY_B64 for "${prefix}" is not configured`);

  const pkcs8Bytes = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const nonce = crypto.getRandomValues(new Uint8Array(8));
  const prefixBytes = new TextEncoder().encode(prefix);
  const message = new Uint8Array(prefixBytes.length + nonce.length);
  message.set(prefixBytes, 0);
  message.set(nonce, prefixBytes.length);

  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    message
  );
  const sig = new Uint8Array(sigBuffer); // 64バイト固定 (IEEE P1363)

  const payload = new Uint8Array(nonce.length + sig.length); // 72バイト
  payload.set(nonce, 0);
  payload.set(sig, nonce.length);

  return {
    key: prefix + base32Encode(payload), // 120文字 (正規化)
    nonce,
  };
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
    const items = fullSession.line_items?.data || [];

    const isSet    = env.STRIPE_PRICE_ID_BANTO_SET && items.some(li => li.price?.id === env.STRIPE_PRICE_ID_BANTO_SET);
    const isSingle = env.STRIPE_PRICE_ID_BANTO     && items.some(li => li.price?.id === env.STRIPE_PRICE_ID_BANTO);

    // 本 Webhook が担当しない商品なら何もしない
    if (!isSet && !isSingle) return new Response("ok", { status: 200 });

    // 冪等性チェック: 既にキーを発行済みなら処理をスキップ（Stripe リトライ対策）
    if (s.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(s.payment_intent);
        if (pi.metadata?.ksbt_license_key) {
          return new Response("ok", { status: 200 });
        }
      } catch (e) {
        console.error("Idempotency check error:", e);
      }
    }

    // KSBT ライセンスキーを生成（建設番頭）
    const { key: ksbtKey, nonce: ksbtNonce } = await generateLicenseKey('KSBT', env.KSBT_ECDSA_PRIVATE_KEY_B64);

    // セット購入時は ADAN キーも生成（建設番頭＋安全台帳セット）
    let adanKey = null;
    let adanNonce = null;
    if (isSet) {
      const result = await generateLicenseKey('ADAN', env.ADAN_ECDSA_PRIVATE_KEY_B64);
      adanKey = result.key;
      adanNonce = result.nonce;
    }

    // 発行キーを Stripe payment_intent メタデータに記録
    // → 「キーをなくした」問い合わせ時に購入者メールから追跡可能にする
    // → nonce も記録（ECDSA 方式では nonce が一意の発行証跡になる）
    if (s.payment_intent) {
      try {
        const metadata = {
          ksbt_license_key: ksbtKey,
          ksbt_license_nonce: Array.from(ksbtNonce).map(b => b.toString(16).padStart(2,'0')).join(''),
          product: isSet ? 'SET_建設番頭+安全台帳' : 'KSBT_建設番頭単品',
          issued_at: new Date().toISOString(),
        };
        if (adanKey) {
          metadata.adan_license_key = adanKey;
          metadata.adan_license_nonce = Array.from(adanNonce).map(b => b.toString(16).padStart(2,'0')).join('');
        }

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
      // displayKey: XXXX-{116文字} = 121文字。メールでコピーしやすいようハイフンあり。
      const ksbtDisplay = ksbtKey.slice(0, 4) + '-' + ksbtKey.slice(4);
      const adanDisplay = adanKey ? adanKey.slice(0, 4) + '-' + adanKey.slice(4) : '';
      const licenseSection = isSet ? `
    <div style="background:#F0FDF4;border:2px solid #16A34A;border-radius:8px;padding:20px 24px;margin:24px 0">
      <p style="margin:0 0 12px;font-size:13px;font-weight:bold;color:#15803D">ライセンスキー（2本入りです。大切に保管してください）</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="border-bottom:1px solid #dcfce7">
          <td style="padding:8px 4px;color:#15803D;font-weight:bold;white-space:nowrap;vertical-align:top">建設番頭用</td>
          <td style="padding:8px 4px 8px 12px;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#1e293b;word-break:break-all">${ksbtDisplay}</td>
        </tr>
        <tr>
          <td style="padding:8px 4px;color:#15803D;font-weight:bold;white-space:nowrap;vertical-align:top">安全台帳用</td>
          <td style="padding:8px 4px 8px 12px;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#1e293b;word-break:break-all">${adanDisplay}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#64748b;line-height:1.8">
        それぞれのアプリの初回起動時に、対応するキーを入力してください。<br>
        キーをなくしてしまった場合は、ご購入時のメールアドレスで <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">お問い合わせ</a> ください。
      </p>
    </div>` : `
    <div style="background:#F0FDF4;border:2px solid #16A34A;border-radius:8px;padding:20px 24px;margin:24px 0">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#15803D">ライセンスキー（大切に保管してください）</p>
      <p style="margin:0 0 12px;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#1e293b;text-align:center;word-break:break-all">${ksbtDisplay}</p>
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
        <li><strong>建設番頭.exe</strong> をダブルクリック</li>
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
