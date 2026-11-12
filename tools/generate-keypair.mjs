#!/usr/bin/env node
/**
 * ECDSA P-256 鍵ペア生成スクリプト
 *
 * 使い方:
 *   node generate-keypair.mjs <ラベル>
 *
 * 例:
 *   node generate-keypair.mjs KSBT          # 建設番頭 本番用
 *   node generate-keypair.mjs ADAN          # 安全台帳 本番用
 *   node generate-keypair.mjs PCKS          # PC点検 本番用
 *   node generate-keypair.mjs TEST_KSBT     # 建設番頭 テスト用（秘密鍵をテストコードに書く）
 *   node generate-keypair.mjs TEST_ADAN     # 安全台帳 テスト用
 *   node generate-keypair.mjs TEST_PCKS     # PC点検 テスト用
 *
 * 出力はすべて標準出力のみです。ファイルへの書き出しは行いません。
 * 秘密鍵が画面に表示されます。保管が済んだらこの画面を閉じてください。
 *
 * Node.js 18 以上が必要です（globalThis.crypto が使えること）。
 */

const label = process.argv[2];

if (!label) {
  console.error('エラー: ラベルを指定してください。');
  console.error('');
  console.error('使い方: node generate-keypair.mjs <ラベル>');
  console.error('例:     node generate-keypair.mjs KSBT');
  console.error('        node generate-keypair.mjs ADAN');
  console.error('        node generate-keypair.mjs PCKS');
  console.error('        node generate-keypair.mjs TEST_KSBT');
  process.exit(1);
}

const isTest = label.startsWith('TEST_');
const upper  = label.toUpperCase();

// ECDSA P-256 鍵ペアを生成
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,        // extractable: true にしないとエクスポートできない
  ['sign', 'verify']
);

// 公開鍵を SPKI 形式でエクスポート
const spkiBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
const spkiBytes  = new Uint8Array(spkiBuffer);
const publicKeyB64 = Buffer.from(spkiBuffer).toString('base64');

// 秘密鍵を PKCS#8 形式でエクスポート
const pkcs8Buffer  = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
const privateKeyB64 = Buffer.from(pkcs8Buffer).toString('base64');

/**
 * C# の byte[] リテラル形式に変換する。
 * 例: new byte[] { 0x30, 0x59, ... }
 * 見やすさのため 16 バイトごとに改行する。
 */
function toCSharpByteArray(bytes, indent = '    ') {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = Array.from(bytes.slice(i, i + 16))
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(', ');
    const comma = (i + 16 < bytes.length) ? ',' : '';
    lines.push(indent + chunk + comma);
  }
  return 'new byte[]\n{\n' + lines.join('\n') + '\n}';
}

const HR = '─'.repeat(60);

console.log('');
console.log(HR);
console.log(`  ECDSA P-256 鍵ペア生成 — ${upper}`);
if (isTest) {
  console.log('  ※ テスト用の鍵ペアです。本番には使わないでください。');
}
console.log(HR);
console.log('');

// ── 公開鍵 ──────────────────────────────────────────────────
console.log('▼ 公開鍵（SPKI / Base64）');
if (isTest) {
  console.log('  テストコード内の PublicKeyForTest 定数として貼り付けます。');
} else {
  console.log('  LicenseService.cs の PublicKey 定数として貼り付けます。');
  console.log('  公開鍵はコミットしてかまいません。');
}
console.log('');
console.log(publicKeyB64);
console.log('');

console.log('▼ 公開鍵（C# byte 配列形式）');
console.log('  LicenseService.cs にそのまま貼り付けられます。');
console.log('');
console.log(toCSharpByteArray(spkiBytes));
console.log('');

// ── 秘密鍵 ──────────────────────────────────────────────────
console.log(HR);
if (isTest) {
  console.log('  ▲ ここまでが公開鍵です。');
  console.log('');
  console.log('  以下はテスト用の秘密鍵です。');
  console.log('  テストコード内に貼り付けてかまいませんが、');
  console.log('  本番用ではないことを必ずコメントで明記してください。');
} else {
  console.log('  ⚠  以下は秘密鍵です。');
  console.log('  今すぐパスワード管理ツールに保管し、保管が済んだらこの画面を閉じてください。');
  console.log('  ファイルには保存しないでください。');
  console.log('  リポジトリのフォルダ内に置かないでください。');
}
console.log(HR);
console.log('');

console.log('▼ 秘密鍵（PKCS#8 / Base64）');
if (!isTest) {
  const envName = `${upper}_ECDSA_PRIVATE_KEY_B64`;
  console.log(`  Cloudflare 環境変数「${envName}」に設定します。`);
  console.log('  値を暗号化（Encrypt）してから保存してください。');
}
console.log('');
console.log(privateKeyB64);
console.log('');

console.log(HR);
if (isTest) {
  console.log('  テスト用の秘密鍵の表示が終わりました。');
} else {
  console.log('  ⚠  秘密鍵の保管が済んだら、この画面を閉じてください。');
  console.log('  ターミナルのスクロールバックにも残ります。閉じることを忘れずに。');
}
console.log(HR);
console.log('');
