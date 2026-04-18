import React from "react";

const ORDER = {
  queued: 0,
  devin_running: 1,
  pr_opened: 2,
  completed: 3,
  failed: 4,
};

function StatusPill({ status }) {
  return <span className={`pill pill--${status}`}>{status}</span>;
}

function Card({ task }) {
  return (
    <div className={`status-card status-card--${task.status}`}>
      <div className="status-card__row">
        <span className="status-card__id">
          {task.issueUrl ? (
            <a href={task.issueUrl} target="_blank" rel="noreferrer">
              #{task.issueNumber}
            </a>
          ) : (
            "—"
          )}
        </span>
        <span className="status-card__pkg">{task.packageName}</span>
        <span className="status-card__links">
          {task.devinSessionUrl && (
            <a className="link-chip" href={task.devinSessionUrl} target="_blank" rel="noreferrer">
              Devin ↗
            </a>
          )}
          {task.prUrl && (
            <a className="link-chip" href={task.prUrl} target="_blank" rel="noreferrer">
              PR ↗
            </a>
          )}
        </span>
        <StatusPill status={task.status} />
      </div>
      <div className="status-card__title">{task.title}</div>
      {task.status === "failed" && task.failureReason && (
        <div className="status-card__reason">{task.failureReason}</div>
      )}
    </div>
  );
}

export default function StatusBoard({ tasks }) {
  if (!tasks?.length) {
    return (
      <div className="status-board__empty">
        No remediation tasks yet. Trigger a run or wait for the cron to find open issues.
      </div>
    );
  }

  const sorted = [...tasks].sort((a, b) => {
    const oa = ORDER[a.status] ?? 99;
    const ob = ORDER[b.status] ?? 99;
    if (oa !== ob) return oa - ob;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return (
    <div className="status-board">
      {sorted.map((t) => (
        <Card key={t.id} task={t} />
      ))}
    </div>
  );
}
