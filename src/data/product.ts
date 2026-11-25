/** シンプル工事台帳 の商品定数 */
export const PRODUCT = {
  name: 'シンプル工事台帳',
  price: 5980,
  priceSet: 13800,
  /** 主表示：¥5,980（税込・買い切り） */
  priceFull: '¥5,980（税込・買い切り）',
  currency: 'JPY',
  supportDays: 60,
  slug: '/products/koji-daicho/',
} as const;

/** シンプル安全台帳 の商品定数 */
export const ANZEN_DAICHO = {
  name: 'シンプル安全台帳',
  price: 9800,
  priceFull: '¥9,800（税込・買い切り）',
  currency: 'JPY',
  slug: '/products/anzen-daicho/',
} as const;

/** 建設番頭 の商品定数 */
export const KENSETSU_BANTO = {
  name: '建設番頭',
  price: 19800,
  priceFull: '¥19,800（税込・買い切り）',
  currency: 'JPY',
  slug: '/products/kensetsu-banto/',
} as const;

/** 体験版の設定 — available: false の間はボタン非表示 */
export type TrialConfig = {
  available: boolean;
  limits: string[];
  smartScreen: boolean;
  afterPurchase: string;
};

export const TRIALS: Record<'koji' | 'anzen' | 'pc-tenken', TrialConfig> = {
  koji: {
    available: false,
    limits: [], // 各ツールのスレッドが体験版の制限を決めたら1〜3行で入れる
    smartScreen: false,
    afterPurchase: '購入後は、製品版のファイルをメールでお届けします。',
  },
  anzen: {
    available: false,
    limits: [],
    smartScreen: true,
    afterPurchase: '購入後にメールで届くライセンスキーを入れると、同じファイルのまま製品版になります。',
  },
  'pc-tenken': {
    available: false,
    limits: [],
    smartScreen: true,
    afterPurchase: '購入後にメールで届くライセンスキーを入れると、同じファイルのまま製品版になります。',
  },
};
