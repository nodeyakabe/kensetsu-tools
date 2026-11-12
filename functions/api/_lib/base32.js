/**
 * Base32 エンコード（RFC 4648 A-Z2-7、パディングなし）
 *
 * C# の Base32.cs・gen_license.mjs と同一仕様。
 * 3製品（KSBT/ADAN/PCKS）の Webhook で共用する。
 *
 * @param {Uint8Array} bytes
 * @returns {string} 大文字 A-Z2-7 のみで構成される文字列
 */
export function base32Encode(bytes) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}
