/**
 * ライセンスキー生成テストスクリプト
 *
 * 目的:
 *   - Webhook が生成するキーが C# の IsValidKey() を通ることを手動検証するための10本を出力する
 *   - KSBT キーが ADAN の検証を通らないこと（鍵分離）も確認できる
 *
 * 実行方法（Node.js 18以上）:
 *   node apps/HP/tools/test-license-key.mjs
 *
 * 出力された各キーを、アプリ（建設番頭 / 安全台帳）のライセンス認証画面に入力して
 * 「有効」と判定されることを確認してください。
 *
 * 注意:
 *   ここに書かれた秘密鍵は開発・テスト用のハードコード値です。
 *   本番の KSBT_LICENSE_SECRET / ADAN_LICENSE_SECRET は
 *   Cloudflare Pages ダッシュボードの環境変数（Secret）に設定してください。
 *   このファイルをコミットしても秘密鍵がリポジトリに入らないよう注意してください。
 */

import { webcrypto } from 'node:crypto';
const { subtle, getRandomValues } = webcrypto;

const SECRETS = {
  KSBT: 'KensetsuBanto-License-Key-2025-Offline',
  ADAN: 'AnzenDaicho2024!SecretKey',
};

async function generateLicenseKey(prefix, secret) {
  const bytes = new Uint8Array(6);
  getRandomValues(bytes);
  const data = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  const enc = new TextEncoder();
  const key = await subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await subtle.sign('HMAC', key, enc.encode(data));
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  const checksum = hex.slice(0, 4);

  const full = prefix + data + checksum;
  return `${full.slice(0,4)}-${full.slice(4,8)}-${full.slice(8,12)}-${full.slice(12,16)}-${full.slice(16,20)}`;
}

async function main() {
  const COUNT = 10;

  console.log('=== 建設番頭（KSBT）ライセンスキー ===');
  console.log('以下の各キーを 建設番頭.exe で認証し、全て「有効」になることを確認してください。\n');
  for (let i = 0; i < COUNT; i++) {
    const key = await generateLicenseKey('KSBT', SECRETS.KSBT);
    console.log(`  KSBT-${String(i + 1).padStart(2, '0')}: ${key}`);
  }

  console.log('\n=== シンプル安全台帳（ADAN）ライセンスキー ===');
  console.log('以下の各キーを AnzenDaicho.App.exe で認証し、全て「有効」になることを確認してください。\n');
  for (let i = 0; i < COUNT; i++) {
    const key = await generateLicenseKey('ADAN', SECRETS.ADAN);
    console.log(`  ADAN-${String(i + 1).padStart(2, '0')}: ${key}`);
  }

  console.log('\n=== 鍵分離テスト ===');
  console.log('以下の KSBT キーを AnzenDaicho.App.exe に入力し、「無効」と判定されることを確認してください。');
  console.log('（「KSBT で作ったキーが ADAN を通らない」ことの証明）\n');
  const crossKey = await generateLicenseKey('KSBT', SECRETS.KSBT);
  console.log(`  交差テスト用KSBT: ${crossKey}`);
  console.log('  → 安全台帳に入力した場合は「無効」となるはず\n');
}

main().catch(console.error);
