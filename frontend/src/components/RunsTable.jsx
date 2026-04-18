import React from "react";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function RunsTable({ runs }) {
  if (!runs?.length) return <div className="muted">no runs yet</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Findings</th>
            <th>Completed</th>
            <th>Failed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="small">{fmtDate(r.startedAt)}</td>
              <td>{r.findingsCount}</td>
              <td>{r.tasksCompleted}</td>
              <td>{r.tasksFailed}</td>
              <td>
                {r.completedAt ? (
                  <span className="pill pill--completed">closed</span>
                ) : (
                  <span className="pill pill--devin_running">open</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
