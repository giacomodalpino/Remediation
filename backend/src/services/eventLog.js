import { prisma } from "../db.js";
import { log } from "../logger.js";

export async function writeEvent(type, message, taskId = null) {
  try {
    await prisma.activityEvent.create({
      data: { type, message, taskId },
    });
    log.info(`event ${type}${taskId ? ` task=${taskId}` : ""}: ${message}`);
  } catch (err) {
    log.error("failed to write event", err);
  }
}
