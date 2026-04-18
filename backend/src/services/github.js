import { getSetting } from "./settings.js";
import { log } from "../logger.js";

const ISSUE_LABEL = process.env.ISSUE_LABEL || "security";

export function parseRepoUrl(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Extract structured fix hint from an issue title. Supports two forms:
 *   1. "Bump <package> from <old> to <new> (...)"         (canonical)
 *   2. "<package> <old> → <new> (...)"  or  "-> <new>"    (arrow form)
 *
 * Returns null for titles that don't match either — those are still queued,
 * just without the structured hint. Devin works from the issue body then.
 */
export function parseIssueTitle(title) {
  const s = String(title || "").trim();

  // 1. Canonical: "Bump <pkg> from <old> to <new>"
  let m = s.match(/^bump\s+([\w.\-]+)\s+from\s+(\S+)\s+to\s+(\S+)/i);
  if (m) return { package: m[1], installedVersion: m[2], fixVersion: m[3] };

  // 2. Arrow form: "<pkg> <old> → <new>" or "<pkg> <old> -> <new>".
  //    Version segments must start with a digit so we don't accidentally
  //    match random words as versions.
  m = s.match(/^([\w.\-]+)\s+([\d][\w.\-]*)\s*(?:→|->)\s*([\d][\w.\-]*)/i);
  if (m) return { package: m[1], installedVersion: m[2], fixVersion: m[3] };

  return null;
}

/**
 * Fetch open issues with the configured label on the target repo.
 * Excludes pull requests (the /issues endpoint also returns PRs — filter them out).
 */
export async function fetchOpenLabeledIssues() {
  const targetUrl = await getSetting("targetRepoUrl");
  if (!targetUrl) {
    throw new Error("Target repo URL is not configured");
  }
  const parsed = parseRepoUrl(targetUrl);
  if (!parsed) {
    throw new Error(`Could not parse owner/repo from ${targetUrl}`);
  }
  const { owner, repo } = parsed;
  const token = await getSetting("githubToken");

  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent(
    ISSUE_LABEL
  )}&per_page=100`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "devin-remediation-control-plane",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${body.slice(0, 400)}`);
  }
  const all = await res.json();
  const issues = all
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      url: i.html_url,
      title: i.title,
      body: i.body || "",
      labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    }));
  log.info(`github: ${issues.length} open issues labeled "${ISSUE_LABEL}" on ${owner}/${repo}`);
  return { owner, repo, label: ISSUE_LABEL, issues };
}
