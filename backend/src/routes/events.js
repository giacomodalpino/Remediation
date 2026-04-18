import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

router.get("/events", async (_req, res) => {
  const events = await prisma.activityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(events);
});

export default router;
