/**
 * kensetsu-tools-mail-check
 *
 * Cron: 毎月1日 9:00 JST（= UTC 0:00）
 * Brevo API で OWNER_EMAIL 宛てに動作確認メールを送信する。
 * 送信成功でキーの90日自動無効タイマーがリセットされる。
 *
 * 環境変数（Cloudflare Worker ダッシュボードで設定）:
 *   BREVO_API_KEY       — Secret: kensetsu-tools-prod キー
 *   BREVO_SENDER_EMAIL  — Text  : 送信元アドレス
 *   BREVO_SENDER_NAME   — Text  : 送信者名
 *   OWNER_EMAIL         — Text  : 受信先（管理者メール）
 */

export default {
  // fetch ハンドラは意図的に実装しない（外部からの直接呼び出しを防ぐ）
  async scheduled(_event, env, _ctx) {
    await sendCheckMail(env);
  },
};

async function sendCheckMail(env) {
  const now = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const payload = {
    sender: {
      name:  env.BREVO_SENDER_NAME  ?? '建設業ツール工房',
      email: env.BREVO_SENDER_EMAIL,
    },
    to: [{ email: env.OWNER_EMAIL }],
    subject: '【動作確認】購入メール経路 正常',
    htmlContent: `
      <p>Brevo 送信経路の月次動作確認メールです。</p>
      <p>送信日時（JST）: <strong>${now}</strong></p>
      <p>このメールが届いていれば、ライセンスキーの購入メール送信経路は正常です。</p>
      <hr>
      <p style="color:#888;font-size:12px">このメールは自動送信です。返信不要です。</p>
    `.trim(),
  };

  let res;
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`mail-check: fetch failed: ${err.message}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '(body unreadable)');
    // キーの値は出さない。ステータスとエラー本文のみログに残す
    console.error(`mail-check: Brevo error HTTP ${res.status}: ${body}`);
    return;
  }

  console.log(`mail-check: sent OK at ${now}`);
}
