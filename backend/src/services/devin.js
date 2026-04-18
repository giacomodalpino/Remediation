import { log } from "../logger.js";
import { getSetting } from "./settings.js";

const BASE_URL = process.env.DEVIN_API_BASE || "https://api.devin.ai/v1";

async function getApiKey() {
  const key = await getSetting("devinApiKey");
  if (!key) {
    throw new Error("Devin API key is not configured (set it in Settings or via DEVIN_API_KEY)");
  }
  return key;
}

async function devinFetch(pathname, init = {}) {
  const url = `${BASE_URL}${pathname}`;
  const headers = {
    Authorization: `Bearer ${await getApiKey()}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `Devin API ${init.method || "GET"} ${pathname} failed: ${res.status} ${
        res.statusText
      } ${typeof body === "object" ? JSON.stringify(body) : body}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * @param {{prompt:string, title?:string, sessionSecrets?:Array<{key:string,value:string,sensitive?:boolean}>}} args
 * @returns {Promise<{session_id:string, url:string, is_new_session?:boolean}>}
 */
export async function createSession({ prompt, title, sessionSecrets }) {
  const payload = { prompt };
  if (title) payload.title = title;
  if (sessionSecrets && sessionSecrets.length > 0) {
    payload.session_secrets = sessionSecrets.map((s) => ({
      key: s.key,
      value: s.value,
      sensitive: s.sensitive ?? true,
    }));
  }
  log.info(`devin: creating session "${title || prompt.slice(0, 60)}"`);
  return devinFetch("/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function getSession(sessionId) {
  return devinFetch(`/sessions/${encodeURIComponent(sessionId)}`);
}

const PR_REGEX = /https?:\/\/github\.com\/[^\s"')<>]+\/pull\/\d+/i;
const TERMINAL_STATUSES = new Set([
  "finished",
  "stopped",
  "expired",
  "completed",
  "blocked",
  "archived",
  "failed",
]);

function collectStrings(value, out) {
  if (value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

/**
 * Best-effort extraction; the public Devin response shape is not fully
 * documented. We probe known fields then fall back to scanning every
 * string-typed field for a github.com PR URL.
 */
export function extractPrUrl(sessionResponse) {
  if (!sessionResponse) return null;
  const direct =
    sessionResponse.pull_request?.url ||
    sessionResponse.pull_request_url ||
    sessionResponse.pr_url ||
    sessionResponse.output?.pr_url ||
    sessionResponse.structured_output?.pr_url;
  if (typeof direct === "string" && PR_REGEX.test(direct)) {
    return direct.match(PR_REGEX)[0];
  }
  const haystack = [];
  collectStrings(sessionResponse, haystack);
  for (const s of haystack) {
    const m = s.match(PR_REGEX);
    if (m) return m[0];
  }
  return null;
}

export function isTerminalStatus(sessionResponse) {
  if (!sessionResponse) return false;
  const candidates = [
    sessionResponse.status_enum,
    sessionResponse.status,
    sessionResponse.state,
    sessionResponse.session_status,
  ]
    .filter((v) => typeof v === "string")
    .map((v) => v.toLowerCase());
  return candidates.some((c) => TERMINAL_STATUSES.has(c));
}
