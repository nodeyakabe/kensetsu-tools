#!/usr/bin/env node
/**
 * ECDSA P-256 ライセンスキー手動発行ツール
 *
 * 使い方:
 *   node gen_license.mjs <PREFIX> <秘密鍵のBase64>
 *
 * 例:
 *   node gen_license.mjs KSBT "MIGHAgEAMBMG..."
 *   node gen_license.mjs ADAN "MIGHAgEAMBMG..."
 *   node gen_license.mjs PCKS "MIGHAgEAMBMG..."
 *
 * 出力:
 *   {PREFIX}-{116文字Base32} という121文字のキーを標準出力のみに出力します。
 *   ファイルへの書き出しは行いません。
 *
 * 秘密鍵の形式:
 *   PKCS#8 DER の Base64（generate-keypair.mjs が出力する「秘密鍵 (Base64)」）
 *
 * Node.js 18 以上が必要です（globalThis.crypto が使えること）。
 */

// ─────────────────────────────────────────────────────────────
// 引数チェック
// ─────────────────────────────────────────────────────────────

const [prefix, privateKeyB64] = process.argv.slice(2);

if (!prefix || !privateKeyB64) {
  console.error('使い方: node gen_license.mjs <PREFIX> <秘密鍵のBase64>');
  console.error('例:     node gen_license.mjs KSBT "MIGHAgEAMBMG..."');
  process.exit(1);
}

const PREFIX_SET = new Set(['KSBT', 'ADAN', 'PCKS']);
if (!PREFIX_SET.has(prefix.toUpperCase())) {
  console.error(`エラー: PREFIX は KSBT / ADAN / PCKS のいずれかを指定してください。`);
  process.exit(1);
}

const normalizedPrefix = prefix.toUpperCase();

// ─────────────────────────────────────────────────────────────
// Base32 エンコード（RFC 4648 A-Z2-7、パディングなし）
// C# の Base32.cs と同一仕様
// ─────────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

// ─────────────────────────────────────────────────────────────
// キー生成
// ─────────────────────────────────────────────────────────────

// 秘密鍵をインポート
let privateKey;
try {
  const pkcs8Bytes = Buffer.from(privateKeyB64, 'base64');
  privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
} catch (e) {
  console.error(`エラー: 秘密鍵のインポートに失敗しました。`);
  console.error(`  ${e.message}`);
  console.error('秘密鍵が PKCS#8 形式の Base64 であることを確認してください。');
  process.exit(1);
}

// nonce (8バイト) をランダム生成
const nonce = crypto.getRandomValues(new Uint8Array(8));

// 署名対象: UTF8(prefix) + nonce
const prefixBytes = new TextEncoder().encode(normalizedPrefix);
const message = new Uint8Array(prefixBytes.length + nonce.length);
message.set(prefixBytes, 0);
message.set(nonce, prefixBytes.length);

// ECDSA P-256 / SHA-256 / IEEE P1363 (64バイト) で署名
const sigBuffer = await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  privateKey,
  message
);
const sig = new Uint8Array(sigBuffer); // 64バイト固定

// payload = nonce(8) + sig(64) = 72バイト → Base32 → 116文字
const payload = new Uint8Array(nonce.length + sig.length);
payload.set(nonce, 0);
payload.set(sig, nonce.length);

const normalizedKey = normalizedPrefix + base32Encode(payload); // 120文字
const displayKey    = normalizedKey.slice(0, 4) + '-' + normalizedKey.slice(4); // 121文字

console.log(displayKey);
