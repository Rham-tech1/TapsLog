const crypto = require('crypto');
require('dotenv').config();

const SECRET_KEY = Buffer.from(process.env.AES_SECRET_KEY, 'hex');
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts raw NFC Card UID (Hex string) using AES-256-GCM
 */
function encryptCardUid(rawCardUid) {
  const iv = crypto.randomBytes(12); // 12-byte IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);

  let encrypted = cipher.update(rawCardUid, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag,
  };
}

/**
 * Decrypts payload back to raw Card UID
 */
function decryptCardUid(encryptedData, ivHex, authTagHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encryptCardUid,
  decryptCardUid,
};