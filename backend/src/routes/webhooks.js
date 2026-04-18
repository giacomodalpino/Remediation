import { Router } from "express";
import crypto from "node:crypto";
import { log } from "../logger.js";
import { ingestIssueFromWebhook } from "../services/orchestrator.js";

const ISSUE_LABEL = process.env.ISSUE_LABEL || "security";
const router = Router();

function verifySignature(rawBody, headerSig, secret) {
  if (!rawBody || !headerSig || !secret) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(headerSig));
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

router.post("/webhooks/github", async (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({
      ok: false,
      error: "GITHUB_WEBHOOK_SECRET is not configured",
    });
  }

  const sig = req.headers["x-hub-signature-256"];
  if (!verifySignature(req.rawBody, sig, secret)) {
    return res.status(401).json({ ok: false, error: "invalid signature" });
  }

  const event = req.headers["x-github-event"];
  if (event === "ping") {
    return res.json({ ok: true, pong: true });
  }
  if (event !== "issues") {
    return res.json({ ok: true, noop: `event: ${event}` });
  }

  const payload = req.body || {};
  if (payload.action !== "labeled") {
    return res.json({ ok: true, noop: `action: ${payload.action}` });
  }

  const labelName = payload.label?.name;
  if (labelName !== ISSUE_LABEL) {
    return res.json({ ok: true, noop: `label "${labelName}" not watched` });
  }

  const raw = payload.issue;
  if (!raw || raw.pull_request) {
    return res.json({ ok: true, noop: "no issue payload (or PR)" });
  }

  const issue = {
    number: raw.number,
    url: raw.html_url,
    title: raw.title || "",
    body: raw.body || "",
    labels: (raw.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
  };

  try {
    const result = await ingestIssueFromWebhook(issue);
    log.info(
      `webhook: issue #${issue.number} ${result.created ? "queued" : "deduped"}`
    );
    return res.json({ ok: true, ...result });
  } catch (err) {
    log.error("webhook ingest failed", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
