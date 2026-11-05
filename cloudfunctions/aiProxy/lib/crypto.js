'use strict';

const crypto = require('crypto');

/**
 * 用户 Provider Key 的加解密。
 *
 * - 算法：AES-256-GCM（有认证标签，篡改会被发现）
 * - 主密钥：只来自云函数环境变量 PROVIDER_KEY_SECRET，不落库、不出云函数
 * - 密文格式：v1.<iv_b64>.<tag_b64>.<ciphertext_b64>
 */

const VERSION = 'v1';
const SALT = 'fridge-buddy/provider-key/v1';

function deriveKey(secret) {
  if (!secret || String(secret).length < 16) {
    throw new Error('PROVIDER_KEY_SECRET 未配置或过短（至少 16 字符）');
  }
  // 用 scrypt 把任意长度的口令拉成 32 字节，避免直接 sha256(secret)
  return crypto.scryptSync(String(secret), SALT, 32);
}

function encrypt(plain, secret) {
  if (typeof plain !== 'string' || !plain) throw new Error('待加密的 Key 为空');
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

function decrypt(payload, secret) {
  if (typeof payload !== 'string' || !payload) return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('密文格式无法识别');
  const key = deriveKey(secret);
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** 只用于界面展示的尾号，例：sk-…a1b2 */
function hint(plain) {
  const s = String(plain || '');
  if (s.length <= 8) return '••••';
  return '••••' + s.slice(-4);
}

module.exports = { encrypt, decrypt, hint, deriveKey };
