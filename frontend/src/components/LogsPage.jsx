import React from "react";
import RunsTable from "./RunsTable.jsx";
import ActivityFeed from "./ActivityFeed.jsx";

export default function LogsPage({ runs, events }) {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Logs</h1>
          <div className="page__sub">Run history and raw activity events</div>
        </div>
      </header>

      <section>
        <h2>Recent Runs</h2>
        <RunsTable runs={runs} />
      </section>

      <section>
        <h2>Activity Feed</h2>
        <ActivityFeed events={events} />
      </section>
    </div>
  );
}
