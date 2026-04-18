import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const IN_PROGRESS = ["queued", "devin_running", "pr_opened"];

router.get("/metrics", async (_req, res) => {
  const grouped = await prisma.remediationTask.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));

  const detected = Object.values(counts).reduce((a, b) => a + b, 0);
  const inProgress = IN_PROGRESS.reduce((a, s) => a + (counts[s] || 0), 0);
  const completed = counts["completed"] || 0;
  const failed = counts["failed"] || 0;
  const successDenominator = completed + failed;
  const successRate = successDenominator
    ? Math.round((completed / successDenominator) * 1000) / 10
    : null;

  const prsOpened = await prisma.remediationTask.count({
    where: { prUrl: { not: null } },
  });

  const totalRuns = await prisma.remediationRun.count();

  res.json({
    detected,
    inProgress,
    completed,
    failed,
    successRate,
    prsOpened,
    totalRuns,
    byStatus: counts,
  });
});

export default router;
