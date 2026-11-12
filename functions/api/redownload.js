/**
 * Cloudflare Pages Function: POST /api/redownload
 * ライセンスキーを ECDSA P-256 で検証し、R2 からアプリをストリーム配信する
 *
 * 環境変数（Cloudflare Pages ダッシュボードで設定）:
 *   TURNSTILE_SECRET_KEY           — Cloudflare Turnstile シークレットキー
 *   KSBT_ECDSA_PUBLIC_KEY_B64      — 建設番頭 ECDSA P-256 公開鍵（SPKI DER の Base64）
 *   ADAN_ECDSA_PUBLIC_KEY_B64      — 安全台帳 ECDSA P-256 公開鍵（SPKI DER の Base64）
 *   PCKS_ECDSA_PUBLIC_KEY_B64      — PC点検 ECDSA P-256 公開鍵（SPKI DER の Base64）
 *   PRODUCT_BUCKET                 — R2 バインディング名
 *   DOWNLOAD_OBJECT_KEY_BANTO      — R2 オブジェクトキー（建設番頭）
 *   DOWNLOAD_OBJECT_KEY_ANZEN      — R2 オブジェクトキー（安全台帳）
 *   DOWNLOAD_OBJECT_KEY_PCKS       — R2 オブジェクトキー（PC点検）
 */

import { base32Encode } from "./_lib/base32.js";

/** Base64 文字列を Uint8Array に変換 */
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** RFC 4648 Base32 (A-Z2-7) のデコード */
function base32Decode(str) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const upper = str.toUpperCase();
  const result = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < upper.length; i++) {
    const idx = ALPHABET.indexOf(upper[i]);
    if (idx === -1) return null; // 不正文字
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(result);
}

/**
 * ECDSA P-256 署名を検証する
 * @param {string} prefix
 * @param {Uint8Array} nonce
 * @param {Uint8Array} sig
 * @param {string} publicKeyB64 - SPKI DER の Base64
 * @returns {Promise<boolean>}
 */
async function verifySignature(prefix, nonce, sig, publicKeyB64) {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    b64ToBytes(publicKeyB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const prefixBytes = new TextEncoder().encode(prefix);
  const message = new Uint8Array(prefixBytes.length + nonce.length);
  message.set(prefixBytes, 0);
  message.set(nonce, prefixBytes.length);

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sig,
    message
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  // ─── 1. リクエスト解析 ─────────────────────────────────────────
  let licenseKey, turnstileToken;
  try {
    ({ licenseKey, turnstileToken } = await request.json());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (!licenseKey || typeof licenseKey !== 'string') {
    return json({ error: 'invalid_key' }, 400);
  }

  // ─── 2. Turnstile 検証 ─────────────────────────────────────────
  if (env.TURNSTILE_SECRET_KEY) {
    if (!turnstileToken) return json({ error: 'turnstile_missing' }, 403);

    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
      }),
    });
    const tsData = await tsRes.json();
    if (!tsData.success) return json({ error: 'turnstile_failed' }, 403);
  }

  // ─── 3. キー正規化（ハイフン・空白除去、大文字化） ───────────────
  const normalized = licenseKey.replace(/[-\s]/g, '').toUpperCase();

  // ─── 4. プレフィックス判定 ─────────────────────────────────────
  const PREFIX_MAP = {
    KSBT: { pubKeyEnv: 'KSBT_ECDSA_PUBLIC_KEY_B64', objKeyEnv: 'DOWNLOAD_OBJECT_KEY_BANTO', filename: 'kensetsu-banto.zip' },
    ADAN: { pubKeyEnv: 'ADAN_ECDSA_PUBLIC_KEY_B64', objKeyEnv: 'DOWNLOAD_OBJECT_KEY_ANZEN', filename: 'anzen-daicho.zip' },
    PCKS: { pubKeyEnv: 'PCKS_ECDSA_PUBLIC_KEY_B64', objKeyEnv: 'DOWNLOAD_OBJECT_KEY_PCKS', filename: 'pc-kensin.zip' },
  };

  const prefix = normalized.slice(0, 4);
  const entry = PREFIX_MAP[prefix];
  if (!entry) return json({ error: 'unknown_prefix' }, 400);

  // ─── 5. キー長チェック: PREFIX(4) + Base32(116) = 120文字 ───────
  if (normalized.length !== 120) return json({ error: 'invalid_key' }, 400);

  // ─── 6. Base32 デコード → nonce(8) + sig(64) ──────────────────
  const payload = base32Decode(normalized.slice(4)); // 116文字 → 72バイト
  if (!payload || payload.length !== 72) return json({ error: 'invalid_key' }, 400);

  const nonce = payload.slice(0, 8);
  const sig   = payload.slice(8);    // 64バイト

  // ─── 7. ECDSA 検証 ────────────────────────────────────────────
  const publicKeyB64 = env[entry.pubKeyEnv];
  if (!publicKeyB64) {
    console.error(`環境変数 ${entry.pubKeyEnv} が未設定`);
    return json({ error: 'server_error' }, 500);
  }

  let valid;
  try {
    valid = await verifySignature(prefix, nonce, sig, publicKeyB64);
  } catch (e) {
    console.error('ECDSA verify error:', e);
    return json({ error: 'server_error' }, 500);
  }

  if (!valid) return json({ error: 'invalid_key' }, 403);

  // ─── 8. R2 からファイルを配信 ──────────────────────────────────
  const objKey = env[entry.objKeyEnv];
  if (!objKey) {
    console.error(`環境変数 ${entry.objKeyEnv} が未設定`);
    return json({ error: 'server_error' }, 500);
  }

  const obj = await env.PRODUCT_BUCKET.get(objKey);
  if (!obj) return json({ error: 'file_not_found' }, 404);

  const encodedFilename = encodeURIComponent(entry.filename);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${entry.filename}"; filename*=UTF-8''${encodedFilename}`,
      'Cache-Control': 'no-store',
    },
  });
}
