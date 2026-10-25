/**
 * 桌面安装包种子：AES-256-GCM 加密（防随手打开；仍可被专业逆向，勿当绝对保密）。
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
/** 派生密钥材料（与 productName / appId 绑定，勿单独外传 seed.bin） */
const MATERIAL = 'ltd.babyworld.app::desktop-seed::v1::2026';

function deriveKey() {
  return crypto.createHash('sha256').update(MATERIAL).digest();
}

/** @param {object} payload */
function encryptSeed(payload) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('BWS1'), iv, tag, enc]);
}

/** @param {Buffer} buf */
function decryptSeed(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 + 12 + 16) {
    throw new Error('seed 文件无效');
  }
  if (buf.subarray(0, 4).toString('utf8') !== 'BWS1') {
    throw new Error('seed 魔数不匹配');
  }
  const key = deriveKey();
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const enc = buf.subarray(32);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = { encryptSeed, decryptSeed };
