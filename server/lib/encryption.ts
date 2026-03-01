import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTION_VERSION = "aes-256-gcm:v1";

function getEncryptionKey(): Buffer {
  const rawKey = process.env.USER_AGENT_SECRET_KEY;
  if (!rawKey) {
    throw new Error("USER_AGENT_SECRET_KEY is not configured");
  }

  const normalized = rawKey.trim();

  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const base64Key = Buffer.from(normalized, "base64");
  if (base64Key.length === 32) {
    return base64Key;
  }

  throw new Error("USER_AGENT_SECRET_KEY must be a 32-byte base64 or 64-char hex value");
}

export function encryptText(plaintext: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: string;
} {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    version: ENCRYPTION_VERSION,
  };
}

export function decryptText(payload: { ciphertext: string; iv: string; authTag: string }): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

export function getEncryptionVersion(): string {
  return ENCRYPTION_VERSION;
}
