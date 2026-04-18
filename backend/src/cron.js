import cron from "node-cron";
import { startRemediationRun } from "./services/orchestrator.js";
import { log } from "./logger.js";

export function startCron() {
  if (process.env.CRON_ENABLED === "false") {
    log.info("cron disabled (CRON_ENABLED=false)");
    return;
  }
  const schedule = process.env.CRON_SCHEDULE || "*/5 * * * *";
  log.info(`scheduling remediation runs: ${schedule}`);
  cron.schedule(schedule, () => {
    log.info("cron tick: starting remediation run");
    startRemediationRun().catch((err) => log.error("cron run failed", err));
  });
}
