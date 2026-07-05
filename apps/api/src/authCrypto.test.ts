import { describe, expect, test } from "vitest";
import {
  createSessionToken,
  decryptSecret,
  decryptSecretWithConfig,
  encryptSecret,
  hashSessionToken,
  tokenEncryptionConfigFromEnv
} from "./authCrypto";

describe("auth crypto", () => {
  test("loads a base64 encoded 32-byte token encryption key", () => {
    const rawKey = Buffer.alloc(32, 7).toString("base64");
    const config = tokenEncryptionConfigFromEnv({
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: rawKey,
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY_VERSION: "local-test"
    });

    expect(config?.key.length).toBe(32);
    expect(config?.keyVersion).toBe("local-test");
  });

  test("encrypts tokens with random IVs and decrypts with the configured key", () => {
    const config = tokenEncryptionConfigFromEnv({
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: `hex:${Buffer.alloc(32, 3).toString("hex")}`
    });
    expect(config).not.toBeNull();

    const first = encryptSecret("example-personal-token-value", config!);
    const second = encryptSecret("example-personal-token-value", config!);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decryptSecret(first, config!.key)).toBe("example-personal-token-value");
    expect(decryptSecret(second, config!.key)).toBe("example-personal-token-value");
    expect(decryptSecretWithConfig(first, config!)).toBe("example-personal-token-value");
  });

  test("decrypts stored tokens by key version during encryption key rotation", () => {
    const oldKey = `hex:${Buffer.alloc(32, 1).toString("hex")}`;
    const newKey = `hex:${Buffer.alloc(32, 2).toString("hex")}`;
    const oldConfig = tokenEncryptionConfigFromEnv({
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: oldKey,
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY_VERSION: "v1"
    });
    const rotatedConfig = tokenEncryptionConfigFromEnv({
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: newKey,
      MO_DEVFLOW_TOKEN_ENCRYPTION_KEY_VERSION: "v2",
      MO_DEVFLOW_TOKEN_ENCRYPTION_PREVIOUS_KEYS: `v1=${oldKey}`
    });
    expect(oldConfig).not.toBeNull();
    expect(rotatedConfig).not.toBeNull();

    const oldSecret = encryptSecret("stored-before-rotation", oldConfig!);
    const newSecret = encryptSecret("stored-after-rotation", rotatedConfig!);

    expect(decryptSecretWithConfig(oldSecret, rotatedConfig!)).toBe("stored-before-rotation");
    expect(decryptSecretWithConfig(newSecret, rotatedConfig!)).toBe("stored-after-rotation");
  });

  test("rejects missing or malformed encryption keys", () => {
    expect(tokenEncryptionConfigFromEnv({})).toBeNull();
    expect(() => tokenEncryptionConfigFromEnv({ MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: "too-short" })).toThrow("32 bytes");
    expect(() =>
      tokenEncryptionConfigFromEnv({
        MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        MO_DEVFLOW_TOKEN_ENCRYPTION_PREVIOUS_KEYS: "malformed"
      })
    ).toThrow("version=key");
  });

  test("creates opaque session tokens and stable hashes", () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);

    expect(token).not.toContain(".");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hash);
  });
});
