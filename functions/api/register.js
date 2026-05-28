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

const ALLOWED_ORIGINS = [
  'https://kensetsu-tools.com',
  'https://www.kensetsu-tools.com',
  'https://kensetsu-tools.pages.dev',
];

function isOriginAllowed(origin) {
  if (!origin) return true; // 直接アクセス（curl等）は許可
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // preview deploy: *.kensetsu-tools.pages.dev
  if (/^https:\/\/[a-z0-9-]+\.kensetsu-tools\.pages\.dev$/.test(origin)) return true;
  return false;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 外部からの直接呼び出し防止
  const origin = request.headers.get('Origin') ?? '';
  if (!isOriginAllowed(origin)) {
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
  const listId = Number(env.BREVO_LIST_ID) || 0;
  const senderEmail = env.BREVO_SENDER_EMAIL ?? 'contact@kensetsu-tools.com';
  const senderName = env.BREVO_SENDER_NAME ?? '建設業ツール工房';

  if (!apiKey) {
    console.error('BREVO_API_KEY が設定されていません');
    return jsonResponse({ ok: false, message: 'サーバー設定エラー。管理者にお問い合わせください。' }, 500);
  }

  if (!listId) {
    console.warn('BREVO_LIST_ID が設定されていません。コンタクトはリストなしで登録されます。');
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

    // 201: 新規登録成功, 204: 既存コンタクト更新成功
    if (!contactRes.ok && contactRes.status !== 204) {
      const err = await contactRes.text();
      console.error('Brevo contact error:', contactRes.status, err);
      return jsonResponse({ ok: false, message: '登録処理に失敗しました。しばらく時間をおいて再度お試しください。' }, 502);
    }
  } catch (e) {
    console.error('Brevo contact fetch failed:', e);
    return jsonResponse({ ok: false, message: '登録処理に失敗しました。しばらく時間をおいて再度お試しください。' }, 502);
  }

  // 2. 確認メールを送信（失敗しても登録自体は成功なのでエラーを返さない）
  try {
    const safeGreeting = name ? `${escapeHtml(name)} 様` : 'ご登録者様';
    const emailPayload = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email }],
      subject: '【建設業ツール工房】特典PDFをお届けします',
      htmlContent: `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#1e293b;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0F2557;padding:16px 24px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-weight:bold;font-size:18px">建設業ツール工房</span>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:32px 24px">
    <p>${safeGreeting}</p>
    <p>ご登録ありがとうございます。</p>
    <p>ご登録特典「一人親方の確定申告チェックリスト（PDF）」を下記からダウンロードいただけます。</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://kensetsu-tools.com/pdf/kakutei-shinkoku-checklist.pdf"
         style="display:inline-block;background:#F59E0B;color:#fff;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px">
        PDFをダウンロードする
      </a>
    </div>
    <p style="font-size:13px;color:#64748b">確定申告の準備に、ぜひお役立てください。</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:13px;color:#64748b">なお、現在開発中の「シンプル工事台帳」がリリースされましたら、改めてお知らせいたします。</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:12px;color:#94a3b8">
      このメールは <a href="https://kensetsu-tools.com" style="color:#0F2557">建設業ツール工房</a> への登録を受け付けたことをお知らせするものです。<br>
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
