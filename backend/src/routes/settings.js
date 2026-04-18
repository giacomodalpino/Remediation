import { Router } from "express";
import { getPublicSettings, updateSettings } from "../services/settings.js";

const router = Router();

router.get("/settings", async (_req, res) => {
  try {
    res.json(await getPublicSettings());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { targetRepoUrl, devinApiKey, githubToken } = req.body || {};
    const updated = await updateSettings({ targetRepoUrl, devinApiKey, githubToken });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
