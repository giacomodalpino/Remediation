import React from "react";

function relativeTime(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export default function ActivityFeed({ events }) {
  if (!events?.length) return <div className="muted">no activity yet</div>;
  return (
    <ul className="feed">
      {events.map((e) => (
        <li key={e.id} className="feed__item">
          <span className={`feed__type feed__type--${e.type}`}>{e.type}</span>
          <span className="feed__msg">{e.message}</span>
          <span className="feed__time">{relativeTime(e.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
