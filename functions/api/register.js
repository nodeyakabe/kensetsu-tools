/**
 * Cloudflare Pages Function: POST /api/register
 * メールアドレスをBrevoのリストに追加し、確認メールを送信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   BREVO_API_KEY  — Brevo API キー
 *   BREVO_LIST_ID  — 登録先のコンタクトリストID（数値）
 *   BREVO_SENDER_EMAIL — 送信元メールアドレス（Brevo認証済み）
 *   BREVO_SENDER_NAME  — 送信元名
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS対応（同一オリジンのみ）
  const origin = request.headers.get('Origin') ?? '';
  if (origin && !origin.includes('kensetsu-tools.com') && !origin.includes('kensetsu-tools.pages.dev')) {
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: 'リクエスト形式が正しくありません。' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim().slice(0, 100);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, message: 'メールアドレスが正しくありません。' }, 400);
  }

  const apiKey = env.BREVO_API_KEY;
  const listId = Number(env.BREVO_LIST_ID);
  const senderEmail = env.BREVO_SENDER_EMAIL ?? 'contact@kensetsu-tools.com';
  const senderName = env.BREVO_SENDER_NAME ?? '建設業ツール工房';

  if (!apiKey) {
    // 開発環境フォールバック（本番では必ず設定すること）
    console.error('BREVO_API_KEY が設定されていません');
    return jsonResponse({ ok: false, message: 'サーバー設定エラー。管理者にお問い合わせください。' }, 500);
  }

  // 1. Brevo コンタクト登録
  try {
    const contactPayload = {
      email,
      attributes: name ? { FIRSTNAME: name } : {},
      listIds: listId ? [listId] : [],
      updateEnabled: true,
    };

    const contactRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contactPayload),
    });

    if (!contactRes.ok && contactRes.status !== 204) {
      const err = await contactRes.text();
      console.error('Brevo contact error:', contactRes.status, err);
    }
  } catch (e) {
    console.error('Brevo contact fetch failed:', e);
  }

  // 2. 確認メールを送信
  try {
    const greeting = name ? `${name} 様` : 'ご登録者様';
    const emailPayload = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email }],
      subject: '【建設業ツール工房】事前登録を受け付けました',
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
    <p>シンプル工事台帳 ライト版の事前登録をいただき、ありがとうございます。</p>
    <p>リリース時に、ご登録のメールアドレスへ最初にお知らせします。</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-weight:bold;color:#0F2557">特典について</p>
    <p>ご登録特典として、<strong>「一人親方の確定申告チェックリスト（PDF）」</strong>をリリース時に無料でお届けします。</p>
    <p style="font-size:13px;color:#64748b">※ PDFは商品リリースと同時にお届けします。しばらくお待ちください。</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:12px;color:#94a3b8">
      このメールは <a href="https://kensetsu-tools.com" style="color:#0F2557">建設業ツール工房</a> への事前登録を受け付けたことをお知らせするものです。<br>
      心当たりのない場合は、このメールを無視してください。<br>
      登録解除をご希望の場合は <a href="mailto:contact@kensetsu-tools.com" style="color:#0F2557">contact@kensetsu-tools.com</a> までご連絡ください。
    </p>
  </div>
</body>
</html>`,
    };

    const mailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!mailRes.ok) {
      const err = await mailRes.text();
      console.error('Brevo mail error:', mailRes.status, err);
    }
  } catch (e) {
    console.error('Brevo mail fetch failed:', e);
  }

  return jsonResponse({ ok: true });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
