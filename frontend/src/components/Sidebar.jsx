import React from "react";

function parseRepo(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.\s]+)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

const NAV = [
  { id: "dashboard", label: "Dashboard" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

export default function Sidebar({ view, onNavigate, repoUrl }) {
  const repo = parseRepo(repoUrl);
  return (
    <aside className="sidebar">
      <div className={`sidebar__repo ${repo ? "sidebar__repo--ok" : "sidebar__repo--missing"}`}>
        <span className="sidebar__repo-icon" aria-hidden="true">
          {repo ? "\u2713" : "!"}
        </span>
        <span className="sidebar__repo-label">
          {repo || "No repo configured"}
        </span>
      </div>
      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar__nav-item${view === item.id ? " sidebar__nav-item--active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">Devin Remediation</div>
    </aside>
  );
}
