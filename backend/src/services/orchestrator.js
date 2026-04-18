import { prisma } from "../db.js";
import { log } from "../logger.js";
import { writeEvent } from "./eventLog.js";
import { fetchOpenLabeledIssues, parseIssueTitle } from "./github.js";
import { createSession } from "./devin.js";
import { getSetting } from "./settings.js";

function buildPrompt(issue, target) {
  const parsed = parseIssueTitle(issue.title);
  const hint = parsed
    ? `\nStructured hint from the issue title:
- Package: ${parsed.package}
- Current version: ${parsed.installedVersion}
- Target fix version: ${parsed.fixVersion}\n`
    : "";
  const body = String(issue.body || "").trim().slice(0, 6000);
  const labels = issue.labels || [];
  const isBreaking =
    labels.some((l) => /breaking.?upgrade/i.test(l)) ||
    /breaking[- ]upgrade/i.test(`${issue.title} ${body}`);

  const discoveryRules = `Discovery (do this before editing any files):
- Find every file in the repo that pins the affected package. The file the issue mentions is a starting point, not the full list. Use \`grep\` / \`rg\` for the package name across the repo. Common locations: sibling requirements files (requirements/*.txt, requirements-*.txt), lockfiles (uv.lock, poetry.lock, Pipfile.lock, requirements.lock), constraint files (constraints*.txt), pyproject.toml, setup.py, setup.cfg, Dockerfile, .github/workflows/*.yml, .circleci/config.yml.
- Look for a README or CONTRIBUTING near those files (e.g. requirements/README.md). Repos frequently document version-consistency rules -- "all version numbers for a shared library should fully match at all times" is a real example -- or require going through a regeneration script (scripts/uv-pip-compile.sh, tools/gen-requirements.sh, make compile-requirements). If such a script exists, run it instead of hand-editing pins. If a pyproject.toml plus lockfile pair exists, regenerate the lockfile (uv lock, poetry lock, pip-compile) rather than editing it manually.
- Enumerate every file you intend to touch BEFORE making changes. A remediation that bumps the version in one requirements file but leaves another file pinning the vulnerable version will be rejected in review.`;

  const scopeRules = isBreaking
    ? `This is a BREAKING upgrade. You are authorized to modify application code -- not just the requirements files -- to make the upgrade compile and tests pass.

Scope rules:
- Apply the fix version consistently across every file discovered above, using the repo's regeneration tooling when available.
- Only touch application code that directly imports, calls, or references the upgraded package. Do not refactor unrelated code.
- If the repo contains generated code (e.g. protobuf *_pb2.py files), regenerate it with the matching toolchain version rather than editing it by hand.
- If tests fail after the upgrade, investigate and fix the root cause. Do not skip or xfail tests. Do not pin back to the vulnerable version.
- If a downstream library also pinned in the requirements turns out to be incompatible with the new version, bump it too (smallest version that satisfies compatibility) and mention it in the PR body.`
    : `Make the minimal change required to remediate the vulnerability.

Scope rules:
- Apply the fix version consistently across every file discovered above. A partial update is a bug.
- If the repo provides a regeneration script for pinned dependencies, run it rather than editing pins by hand.
- Do not change application code unless the package's own API actually changed and the code stops working. If uncertain, prefer not to touch code and call out the uncertainty in the PR body.`;

  return `You are remediating a vulnerability described in GitHub issue #${issue.number} of ${target}.

Issue title: ${issue.title}
Issue URL: ${issue.url}
Issue labels: ${labels.join(", ") || "(none)"}

Issue body:
---
${body || "(empty)"}
---
${hint}
${discoveryRules}

${scopeRules}

Workflow:
1. Clone the repo. Push access is provided via the GITHUB_TOKEN session secret -- configure git to use it for HTTPS auth to github.com.
2. Run the discovery rules above. List every file you will touch before editing any of them.
3. Apply the remediation per the scope rules. Prefer the repo's own regeneration tooling (pip-compile, uv lock, poetry lock, project scripts) over hand-editing lockfiles or sibling requirements files.
4. If the repo has a runnable test suite and it is reasonable to execute it in your environment, run it after making changes. Iterate until it passes, within the scope rules. If the suite is too large or slow to run fully, run the subset most relevant to the upgrade -- tests in files that import the upgraded package, plus any tests the changelog calls out.
5. Create a branch named devin/fix-issue-${issue.number}.
6. Commit with message: "Fix #${issue.number}: ${issue.title}". A single commit is fine even if the change spans many files.
7. Push the branch and open a pull request against the default branch with title "Fix #${issue.number}: ${issue.title}". In the PR description:
   - Include "Fixes #${issue.number}" so the issue auto-closes on merge.
   - Include the issue URL (${issue.url}).
   - List every file you updated and a one-line reason for each (requirements pin, lockfile regeneration, API migration, etc.).
   - For breaking upgrades: one bullet per category of downstream change (API migrations, regenerated files, secondary bumps).
   - Note test results: passing, skipped with reason, or still failing with reasoning.
8. Reply with the PR URL once opened.`;
}

async function rollupRun(runId) {
  const tasks = await prisma.remediationTask.findMany({ where: { runId } });
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const allTerminal =
    tasks.length > 0 && tasks.every((t) => ["completed", "failed"].includes(t.status));
  await prisma.remediationRun.update({
    where: { id: runId },
    data: {
      tasksCompleted: completed,
      tasksFailed: failed,
      completedAt: allTerminal ? new Date() : null,
    },
  });
  if (allTerminal) {
    await writeEvent(
      "run_completed",
      `Run ${runId} finished: ${completed} completed, ${failed} failed`
    );
  }
}

export async function markTaskPrOpened(taskId, prUrl) {
  const task = await prisma.remediationTask.update({
    where: { id: taskId },
    data: { status: "pr_opened", prUrl },
  });
  await writeEvent("pr_opened", `PR opened: ${prUrl}`, taskId);
  await rollupRun(task.runId);
}

export async function markTaskCompleted(taskId) {
  const task = await prisma.remediationTask.update({
    where: { id: taskId },
    data: { status: "completed", completedAt: new Date() },
  });
  await writeEvent(
    "task_completed",
    `Task completed${task.prUrl ? ` (${task.prUrl})` : ""}`,
    taskId
  );
  await rollupRun(task.runId);
}

/**
 * Ingest a single issue from a GitHub webhook payload. Creates a run + task
 * synchronously and kicks the dispatcher asynchronously. Idempotent via
 * issueNumber — if a task already exists for this issue, returns without
 * queueing a duplicate. Same downstream flow as poll-sourced tasks.
 */
export async function ingestIssueFromWebhook(issue) {
  const existing = await prisma.remediationTask.findFirst({
    where: { issueNumber: issue.number },
    select: { id: true },
  });
  if (existing) {
    return { created: false, reason: "duplicate", taskId: existing.id };
  }
  const run = await prisma.remediationRun.create({
    data: { findingsCount: 1, tasksCreated: 1 },
  });
  await writeEvent("run_started", `Remediation run ${run.id} started (webhook)`);
  const parsed = parseIssueTitle(issue.title);
  const task = await prisma.remediationTask.create({
    data: {
      runId: run.id,
      title: issue.title.slice(0, 200),
      packageName: parsed?.package || "unknown",
      severity: "high",
      status: "queued",
      issueNumber: issue.number,
      issueUrl: issue.url,
      findingJson: JSON.stringify(issue),
    },
  });
  await writeEvent(
    "issue_queued_via_webhook",
    `Issue #${issue.number} (webhook): ${issue.title}`.slice(0, 280),
    task.id
  );
  dispatchQueued().catch((err) =>
    log.error("dispatch after webhook failed", err)
  );
  return { created: true, runId: run.id, taskId: task.id };
}

export async function markTaskFailed(taskId, reason) {
  const task = await prisma.remediationTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      failureReason: reason?.slice(0, 1000),
      completedAt: new Date(),
    },
  });
  await writeEvent("task_failed", `Task failed: ${reason}`, taskId);
  await rollupRun(task.runId);
}

/**
 * Creates the run row + first event synchronously, then kicks off the rest
 * of the pipeline in the background. Returns the run id immediately so the
 * caller (POST /api/run, cron) can respond fast.
 */
export async function startRemediationRun() {
  const run = await prisma.remediationRun.create({ data: {} });
  await writeEvent("run_started", `Remediation run ${run.id} started`);
  executeRun(run.id).catch((err) => log.error(`run ${run.id} crashed`, err));
  return run.id;
}

async function executeRun(runId) {
  let issues = [];
  let label = null;
  try {
    const fetched = await fetchOpenLabeledIssues();
    issues = fetched.issues;
    label = fetched.label;
  } catch (err) {
    log.error("issue fetch failed", err);
    await writeEvent("run_failed", `Issue fetch failed: ${err.message}`);
    await prisma.remediationRun.update({
      where: { id: runId },
      data: { completedAt: new Date() },
    });
    return;
  }

  await writeEvent(
    "issues_checked",
    `Found ${issues.length} open issues labeled "${label}"`
  );

  // Skip issues that already have a task in our DB (idempotent polling).
  const existing =
    issues.length > 0
      ? await prisma.remediationTask.findMany({
          where: { issueNumber: { in: issues.map((i) => i.number) } },
          select: { issueNumber: true },
        })
      : [];
  const existingNumbers = new Set(existing.map((t) => t.issueNumber));
  const newIssues = issues.filter((i) => !existingNumbers.has(i.number));

  await prisma.remediationRun.update({
    where: { id: runId },
    data: { findingsCount: issues.length, tasksCreated: newIssues.length },
  });

  if (newIssues.length === 0) {
    await prisma.remediationRun.update({
      where: { id: runId },
      data: { completedAt: new Date() },
    });
    await writeEvent("run_completed", `Run ${runId} finished: no new issues`);
    return;
  }

  for (const issue of newIssues) {
    const parsed = parseIssueTitle(issue.title);
    const task = await prisma.remediationTask.create({
      data: {
        runId,
        title: issue.title.slice(0, 200),
        packageName: parsed?.package || "unknown",
        severity: "high",
        status: "queued",
        issueNumber: issue.number,
        issueUrl: issue.url,
        findingJson: JSON.stringify(issue),
      },
    });
    await writeEvent(
      "issue_queued",
      `Issue #${issue.number}: ${issue.title}`.slice(0, 280),
      task.id
    );
  }

  dispatchQueued().catch((err) => log.error("dispatch on run finish failed", err));
}

const MAX_CONCURRENT = Math.max(
  1,
  Math.min(10, Number(process.env.MAX_CONCURRENT_DEVIN_SESSIONS || 2))
);

let dispatchInFlight = false;

/**
 * Pulls queued tasks and invokes Devin until we reach the concurrency cap.
 * Safe to call from anywhere; uses a module-level lock so two callers can't
 * double-invoke the same task.
 */
export async function dispatchQueued() {
  if (dispatchInFlight) return;
  dispatchInFlight = true;
  try {
    const active = await prisma.remediationTask.count({
      where: { status: { in: ["devin_running", "pr_opened"] } },
    });
    let slots = MAX_CONCURRENT - active;
    if (slots <= 0) return;

    const queued = await prisma.remediationTask.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: slots,
    });

    for (const task of queued) {
      let issue;
      try {
        issue = JSON.parse(task.findingJson || "{}");
        if (!issue?.number) throw new Error("stored issue payload missing number");
      } catch {
        await markTaskFailed(task.id, "Stored issue payload could not be parsed");
        continue;
      }
      try {
        const target = await getSetting("targetRepoUrl");
        const githubToken = await getSetting("githubToken");
        const prompt = buildPrompt(issue, target);
        const sessionSecrets = githubToken
          ? [
              {
                key: "GITHUB_TOKEN",
                value: githubToken,
                sensitive: true,
              },
            ]
          : [];
        const session = await createSession({
          prompt,
          title: `Fix #${issue.number}: ${issue.title}`.slice(0, 200),
          sessionSecrets,
        });
        await prisma.remediationTask.update({
          where: { id: task.id },
          data: {
            status: "devin_running",
            devinSessionId: session.session_id,
            devinSessionUrl: session.url,
          },
        });
        await writeEvent(
          "devin_invoked",
          `Devin session ${session.session_id} created`,
          task.id
        );
      } catch (err) {
        log.error(`task ${task.id} failed during invoke`, err);
        await markTaskFailed(task.id, err.message);
      }
    }
  } finally {
    dispatchInFlight = false;
  }
}
