import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listRuns, Run } from "../api.js";

export default function Runs() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const data = await listRuns();
    setRuns(data.runs);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="runs-page">
      <h1 className="page-title">
        <span className="page-title-dot" />
        Runs
      </h1>

      {loading ? (
        <p>Loading runs...</p>
      ) : runs.length === 0 ? (
        <p>No runs yet.</p>
      ) : (
        <ul className="run-list">
          {runs.map((run) => (
            <li key={run.id} className="run-item">
              <Link to={`/runs/${run.id}`}>
                <strong>{run.url}</strong>
                <span className={`badge ${run.status}`}>{run.status}</span>
                {run.browser && <span className="badge">{run.browser}</span>}
                {run.viewport && (
                  <span className="badge">
                    {run.viewport.width}×{run.viewport.height}
                  </span>
                )}
                <span className="meta">{new Date(run.createdAt).toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
