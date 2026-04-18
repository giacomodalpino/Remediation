const API_BASE = "/api";

async function fetchJSON(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ? `: ${body.error}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`${opts?.method || "GET"} ${path} -> ${res.status}${detail}`);
  }
  return res.json();
}

export const api = {
  getMetrics: () => fetchJSON("/metrics"),
  getTasks: () => fetchJSON("/tasks"),
  getRuns: () => fetchJSON("/runs"),
  getEvents: () => fetchJSON("/events"),
  triggerRun: () => fetchJSON("/run", { method: "POST" }),
  getSettings: () => fetchJSON("/settings"),
  saveSettings: (patch) =>
    fetchJSON("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
};
