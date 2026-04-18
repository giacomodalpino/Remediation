import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

router.get("/tasks", async (req, res) => {
  const where = {};
  if (typeof req.query.status === "string") {
    where.status = req.query.status;
  }
  if (typeof req.query.runId === "string") {
    where.runId = req.query.runId;
  }
  const tasks = await prisma.remediationTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(tasks);
});

export default router;
