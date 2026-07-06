/** シンプル工事台帳 ライト版 の商品定数 */
export const PRODUCT = {
  name: 'シンプル工事台帳 ライト版',
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
