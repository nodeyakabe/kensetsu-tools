/**
 * POST /api/contact
 * お問い合わせフォーム受信 → Brevo でメール送信
 *
 * 必要な環境変数（Cloudflare Pages Secrets）:
 *   BREVO_API_KEY          - Brevo の API キー
 *   TURNSTILE_SECRET_KEY   - Cloudflare Turnstile シークレットキー
 */

export async function onRequestPost({ request, env }) {
  // ----- body パース -----
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const {
    turnstileToken,
    honeypot,        // ハニーポット（Botなら値が入る）
    inquiryType,
    name,
    email,
    product,
    purchaseEmail,
    environment,
    message,
    privacyAgreed,
  } = body;

  // ----- ハニーポット -----
  if (honeypot) {
    // Botからの送信は黙って捨てる（200を返してBotに気づかせない）
    return json({ ok: true });
  }

  // ----- サーバー側バリデーション -----
  if (!inquiryType || !name?.trim() || !email?.trim() || !message?.trim() || !privacyAgreed) {
    return json({ error: 'missing_required_fields' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'invalid_email' }, 400);
  }
  // 長さ制限（スパム対策）
  if (message.length > 5000 || name.length > 100) {
    return json({ error: 'input_too_long' }, 400);
  }

  // ----- Turnstile 検証 -----
  if (!turnstileToken) {
    return json({ error: 'turnstile_missing' }, 403);
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: turnstileToken,
      remoteip: ip,
    }),
  }).then(r => r.json()).catch(() => ({ success: false }));

  if (!tsRes.success) {
    return json({ error: 'turnstile_failed' }, 403);
  }

  // ----- 運営者宛メール本文 -----
  const subject = `【${inquiryType}】${product ? product + '／' : ''}${name}様`;
  const textContent = [
    'お問い合わせが届きました。',
    '',
    `種　類　：${inquiryType}`,
    `お名前　：${name}`,
    `返信先　：${email}`,
    `対象商品：${product || '（未記入）'}`,
    `購入情報：${purchaseEmail || '（未記入）'}`,
    `利用環境：${environment || '（未記入）'}`,
    '',
    '-------- お問い合わせ内容 --------',
    message,
    '----------------------------------',
    '',
    '※ このメールに直接返信すると送信者宛に届きます（Reply-To 設定済み）。',
  ].join('\n');

  // ----- Brevo 送信（運営者宛） -----
  const operatorRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: '建設業ツール工房 フォーム', email: 'contact@kensetsu-tools.com' },
      to: [{ email: 'contact@kensetsu-tools.com', name: '建設業ツール工房' }],
      replyTo: { email: email.trim(), name: name.trim() },
      subject,
      textContent,
    }),
  });

  if (!operatorRes.ok) {
    // Brevo エラーはログに出すが PII（email/name）は出さない
    const errBody = await operatorRes.text().catch(() => '');
    console.error('Brevo operator send failed:', operatorRes.status, errBody.slice(0, 200));
    return json({ error: 'send_failed' }, 500);
  }

  // ----- Brevo 送信（送信者への自動受付返信） -----
  const autoReply = [
    `${name} 様`,
    '',
    'この度はお問い合わせいただき、ありがとうございます。',
    '建設業ツール工房です。',
    '',
    'お問い合わせを受け付けました。',
    '数日以内のご返信を心がけています（個人運営のため前後する場合があります）。',
    '',
    'しばらく返信がない場合は、迷惑メールフォルダをご確認いただくか、',
    'contact@kensetsu-tools.com まで直接ご連絡ください。',
    '',
    '──────────────────────',
    '建設業ツール工房',
    'https://kensetsu-tools.com',
    'contact@kensetsu-tools.com',
    '──────────────────────',
    '',
    '※ このメールは自動送信です。ご返信いただいた場合も確認しております。',
  ].join('\n');

  // 自動返信は失敗しても本体の成功に影響させない
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: '建設業ツール工房', email: 'contact@kensetsu-tools.com' },
      to: [{ email: email.trim(), name: name.trim() }],
      subject: '【建設業ツール工房】お問い合わせを受け付けました',
      textContent: autoReply,
    }),
  }).catch(() => {});

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
