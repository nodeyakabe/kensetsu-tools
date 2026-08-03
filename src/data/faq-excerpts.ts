/** products/index.astro と faq/index.astro の両方から参照する共通FAQ抜粋 */
export type FaqEntry = { q: string; a: string };

export const faqReceive: FaqEntry = {
  q: '購入後、どうやって受け取りますか？',
  a: 'カード決済（Stripe）が完了した直後に、ご登録のメールアドレスへダウンロードリンクが届きます。届かない場合は迷惑メールフォルダをご確認のうえ、お問い合わせフォームからご連絡ください。',
};

export const faqPayment: FaqEntry = {
  q: '支払方法は何が使えますか？',
  a: 'クレジットカード・デビットカード（Visa・Mastercard・American Express・JCB等）がご利用いただけます。決済はStripeの安全な画面で処理されます。銀行振込・代引きには対応していません。',
};

export const faqBugSupport: FaqEntry = {
  q: '不具合が見つかったときのサポートはありますか？',
  a: '購入後に不具合が発見された場合は、期限なく無償で修正版を提供します。お問い合わせはサイト内のお問い合わせフォームまたは contact@kensetsu-tools.com までご連絡ください。個人運営のため返答にお時間をいただく場合があります。',
};
