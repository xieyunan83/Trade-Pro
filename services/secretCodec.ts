/**
 * 密钥编解码：v2 混淆（非服务端 KMS；比纯 Base64 强一档，兼容旧数据）。
 * 格式：v2.<b64(xor(utf8))>
 */

const OBFUSCATION_SEED = 'trade-pro-v2-key-obfuscation-2026';

const xorBytes = (data: Uint8Array, key: Uint8Array): Uint8Array => {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
};

const toB64 = (bytes: Uint8Array): string => {
  let s = '';
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
};

const fromB64 = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const seedKey = (): Uint8Array => new TextEncoder().encode(OBFUSCATION_SEED);

/** 加密写入云端；始终写 v2 */
export const encodeSecret = (text: string): string => {
  if (!text) return '';
  try {
    const raw = new TextEncoder().encode(text);
    return `v2.${toB64(xorBytes(raw, seedKey()))}`;
  } catch {
    return text;
  }
};

/** 解密：支持 v2 / 旧 Base64 / 明文回退 */
export const decodeSecret = (encrypted: string): string => {
  if (!encrypted) return '';
  try {
    if (encrypted.startsWith('v2.')) {
      const body = encrypted.slice(3);
      return new TextDecoder().decode(xorBytes(fromB64(body), seedKey()));
    }
    // legacy base64
    try {
      const plain = atob(encrypted);
      // 若像合法 API key（可打印），采用
      if (/^[\x20-\x7E]+$/.test(plain) && plain.length >= 8) return plain;
    } catch {
      /* fallthrough */
    }
    return encrypted;
  } catch {
    return encrypted;
  }
};
