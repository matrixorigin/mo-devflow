import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface TokenEncryptionConfig {
  key: Buffer;
  keyVersion: string;
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

const encryptionKeyMessage =
  "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters.";

export function tokenEncryptionConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): TokenEncryptionConfig | null {
  const raw = env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return null;
  }
  const key = decodeEncryptionKey(raw);
  return {
    key,
    keyVersion: env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY_VERSION?.trim() || "v1"
  };
}

export function encryptSecret(plaintext: string, config: TokenEncryptionConfig): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: config.keyVersion
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

function decodeEncryptionKey(raw: string): Buffer {
  const value = raw.startsWith("base64:") || raw.startsWith("hex:") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const encoding = raw.startsWith("hex:") || /^[a-f0-9]{64}$/i.test(raw) ? "hex" : "base64";
  const key = Buffer.from(value, encoding);
  if (key.length !== 32) {
    throw new Error(encryptionKeyMessage);
  }
  return key;
}
