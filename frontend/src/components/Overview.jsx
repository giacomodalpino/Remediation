import React from "react";

function Tile({ label, value, accent }) {
  return (
    <div className={`tile${accent ? " tile--" + accent : ""}`}>
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}

export default function Overview({ metrics }) {
  if (!metrics) return <div className="muted">loading metrics…</div>;
  const rate = metrics.successRate == null ? "—" : `${metrics.successRate}%`;
  return (
    <div className="tiles">
      <Tile label="Total Issues" value={metrics.detected} />
      <Tile label="In Progress" value={metrics.inProgress} accent="info" />
      <Tile label="Completed" value={metrics.completed} accent="success" />
      <Tile label="Failed" value={metrics.failed} accent="danger" />
      <Tile label="Success Rate" value={rate} />
      <Tile label="PRs Opened" value={metrics.prsOpened} accent="info" />
    </div>
  );
}
