import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import runsRoutes from "./routes/runs.js";
import tasksRoutes from "./routes/tasks.js";
import metricsRoutes from "./routes/metrics.js";
import eventsRoutes from "./routes/events.js";
import settingsRoutes from "./routes/settings.js";
import webhooksRoutes from "./routes/webhooks.js";
import { startCron } from "./cron.js";
import { startPoller } from "./services/poller.js";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, "../../frontend/dist");

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", runsRoutes);
app.use("/api", tasksRoutes);
app.use("/api", metricsRoutes);
app.use("/api", eventsRoutes);
app.use("/api", settingsRoutes);
app.use("/api", webhooksRoutes);

app.use(express.static(FRONTEND_DIST));
app.get("*", (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"), (err) => {
    if (err) res.status(404).send("frontend build not found");
  });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  log.info(`backend listening on http://0.0.0.0:${port}`);
  startCron();
  startPoller();
});
