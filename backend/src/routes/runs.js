import { Router } from "express";
import { prisma } from "../db.js";
import { startRemediationRun } from "../services/orchestrator.js";

const router = Router();

router.post("/run", async (_req, res) => {
  try {
    const runId = await startRemediationRun();
    res.status(202).json({ ok: true, runId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/runs", async (_req, res) => {
  const runs = await prisma.remediationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  res.json(runs);
});

export default router;
