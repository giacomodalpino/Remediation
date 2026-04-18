import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, "../../data/.settings-key");

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.SETTINGS_ENCRYPTION_KEY;
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, "base64");
    if (buf.length !== 32) {
      throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes (base64)");
    }
    cachedKey = buf;
    return cachedKey;
  }
  if (existsSync(KEY_FILE)) {
    cachedKey = Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64");
    return cachedKey;
  }
  const generated = randomBytes(32);
  writeFileSync(KEY_FILE, generated.toString("base64"), { mode: 0o600 });
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    /* best-effort on filesystems that ignore mode */
  }
  cachedKey = generated;
  return cachedKey;
}

export function encrypt(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const key = loadKey();
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < 12 + 16) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function last4(plaintext) {
  if (!plaintext) return null;
  const s = String(plaintext);
  return s.length <= 4 ? s : s.slice(-4);
}
