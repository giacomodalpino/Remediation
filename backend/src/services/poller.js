import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";
import { log } from "../logger.js";
import { getSession, extractPrUrl, isTerminalStatus } from "./devin.js";
import {
  markTaskPrOpened,
  markTaskCompleted,
  markTaskFailed,
  dispatchQueued,
} from "./orchestrator.js";

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = path.resolve(__dirname, "../../data/session-dumps");

async function dumpSession(sessionId, response) {
  if (process.env.DEVIN_SESSION_DUMP !== "1") return;
  try {
    await mkdir(DUMP_DIR, { recursive: true });
    await writeFile(
      path.join(DUMP_DIR, `${sessionId}.json`),
      JSON.stringify(response, null, 2)
    );
  } catch (err) {
    log.warn(`session dump failed for ${sessionId}: ${err.message}`);
  }
}
let timer = null;
let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const tasks = await prisma.remediationTask.findMany({
      where: {
        status: { in: ["devin_running", "pr_opened"] },
        devinSessionId: { not: null },
      },
      take: 50,
    });
    for (const task of tasks) {
      try {
        const session = await getSession(task.devinSessionId);
        await dumpSession(task.devinSessionId, session);
        const prUrl = extractPrUrl(session);
        if (prUrl && !task.prUrl) {
          await markTaskPrOpened(task.id, prUrl);
          task.prUrl = prUrl;
          task.status = "pr_opened";
        }
        if (isTerminalStatus(session)) {
          if (task.prUrl || prUrl) {
            await markTaskCompleted(task.id);
          } else {
            await markTaskFailed(
              task.id,
              "Devin session ended without producing a PR URL"
            );
          }
        }
      } catch (err) {
        log.warn(`poll failed for task ${task.id}: ${err.message}`);
      }
    }
    // After progressing in-flight tasks, fill freed slots from the queue.
    await dispatchQueued();
  } catch (err) {
    log.error("poller tick failed", err);
  } finally {
    inFlight = false;
  }
}

export function startPoller() {
  if (timer) return;
  log.info(`starting Devin poller (every ${INTERVAL_MS}ms)`);
  timer = setInterval(tick, INTERVAL_MS);
  // Run one immediate tick so demos don't wait for the first interval.
  tick().catch(() => {});
}

export function stopPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}
