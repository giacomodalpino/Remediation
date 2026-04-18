import { prisma } from "../db.js";
import { encrypt, decrypt, last4 } from "./secrets.js";

const SECRET_FIELDS = new Set(["devinApiKey", "githubToken"]);
const FIELDS = ["targetRepoUrl", "devinApiKey", "githubToken"];
const ENV_FALLBACK = {
  targetRepoUrl: "TARGET_REPO_URL",
  devinApiKey: "DEVIN_API_KEY",
  githubToken: "GITHUB_TOKEN",
};

async function readRow() {
  return prisma.settings.findUnique({ where: { id: 1 } });
}

/**
 * Resolve a single setting. DB wins if present; otherwise fall back to env.
 * Returns the plaintext value (decrypted for secrets) or null.
 */
export async function getSetting(field) {
  const row = await readRow();
  const stored = row?.[field];
  if (stored) {
    return SECRET_FIELDS.has(field) ? decrypt(stored) : stored;
  }
  const envVar = ENV_FALLBACK[field];
  return envVar ? process.env[envVar] || null : null;
}

/**
 * Public view for GET /api/settings. Never returns plaintext secrets.
 */
export async function getPublicSettings() {
  const row = await readRow();
  const result = {};
  for (const field of FIELDS) {
    const stored = row?.[field];
    const envVal = process.env[ENV_FALLBACK[field]] || null;
    if (SECRET_FIELDS.has(field)) {
      const plain = stored ? decrypt(stored) : envVal;
      result[field] = {
        set: Boolean(plain),
        last4: plain ? last4(plain) : null,
        source: stored ? "app" : envVal ? "env" : null,
      };
    } else {
      result[field] = stored || envVal || null;
    }
  }
  return result;
}

/**
 * Patch-style update. `undefined` leaves a field alone; empty string clears
 * it (falls back to env on next read).
 */
export async function updateSettings(patch) {
  const data = {};
  for (const field of FIELDS) {
    const val = patch[field];
    if (val === undefined) continue;
    if (val === "" || val === null) {
      data[field] = null;
      continue;
    }
    data[field] = SECRET_FIELDS.has(field) ? encrypt(val) : val;
  }
  if (Object.keys(data).length === 0) return getPublicSettings();
  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  return getPublicSettings();
}
