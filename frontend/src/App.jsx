import React, { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import Sidebar from "./components/Sidebar.jsx";
import Overview from "./components/Overview.jsx";
import StatusBoard from "./components/StatusBoard.jsx";
import LogsPage from "./components/LogsPage.jsx";
import SettingsPage from "./components/SettingsPage.jsx";

const POLL_MS = 5000;

export default function App() {
  const [view, setView] = useState("dashboard");
  const [metrics, setMetrics] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [m, t, r, e, s] = await Promise.all([
        api.getMetrics(),
        api.getTasks(),
        api.getRuns(),
        api.getEvents(),
        api.getSettings(),
      ]);
      setMetrics(m);
      setTasks(t);
      setRuns(r);
      setEvents(e);
      setSettings(s);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await api.triggerRun();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} repoUrl={settings?.targetRepoUrl} />
      <main className="app__main">
        {error && <div className="banner banner--error">Error: {error}</div>}

        {view === "dashboard" && (
          <div className="page">
            <header className="page__header">
              <div>
                <h1>Dashboard</h1>
              </div>
              <button className="btn-primary" onClick={handleTrigger} disabled={triggering}>
                {triggering ? "Triggering\u2026" : "Trigger Run"}
              </button>
            </header>

            <section>
              <Overview metrics={metrics} />
            </section>

            <section>
              <h2>Issues</h2>
              <StatusBoard tasks={tasks} />
            </section>
          </div>
        )}

        {view === "logs" && <LogsPage runs={runs} events={events} />}

        {view === "settings" && (
          <SettingsPage settings={settings} onSaved={(s) => setSettings(s)} />
        )}
      </main>
    </div>
  );
}
