import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  listRuns,
  getSettings,
  getPlaywrightStatus,
  Run,
  Settings,
  PlaywrightStatus,
} from "../api.js";

export default function Home() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pwStatus, setPwStatus] = useState<PlaywrightStatus | null>(null);

  async function refresh() {
    try {
      const [runsData, settingsData, pw] = await Promise.all([
        listRuns(),
        getSettings(),
        getPlaywrightStatus(),
      ]);
      setRuns(runsData.runs);
      setSettings(settingsData.settings);
      setPwStatus(pw);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const apiReady =
    !!settings &&
    settings.llmApiKeySource !== "unset" &&
    settings.llmApiKey.length > 0;
  const playwrightReady = !!pwStatus?.available;
  const ready = apiReady && playwrightReady;

  let statusText = "Ready to run audits";
  let statusClass = "status-ready";
  if (!apiReady) {
    statusText = "LLM API key not set";
    statusClass = "status-error";
  } else if (!playwrightReady) {
    statusText = "Playwright browsers missing";
    statusClass = "status-error";
  }

  return (
    <div className="home">
      <div className="home-hero">
        <h1>TARDIGRADE</h1>
        <p className="home-tagline">Automated UX audits with a patient agent.</p>
      </div>

      <div className="home-grid">
        <div className="card home-stat">
          <span className="home-stat-label">Runs done</span>
          <span className="home-stat-value">
            {loading ? "—" : runs.length}
          </span>
          <Link to="/runs" className="home-stat-link">
            View all runs →
          </Link>
        </div>

        <div className="card home-actions">
          <h2>Start a new audit</h2>
          <p>Enter a URL, pick browsers and screen sizes, and let the agent explore.</p>
          <button
            onClick={() => navigate("/new")}
            disabled={loading || !ready}
          >
            New Run
          </button>
          {!ready && !loading && (
            <p className="home-actions-hint">
              {apiReady
                ? "Install Playwright browsers before running an audit."
                : "Add your LLM API key in Settings to get started."}
            </p>
          )}
        </div>

        <div className="card home-status">
          <h2>System status</h2>
          <div className={`status-pill ${statusClass}`}>
            <span className="status-dot" />
            {statusText}
          </div>
          <ul className="status-list">
            <li className={apiReady ? "ok" : "missing"}>
              LLM API key {apiReady ? "set" : "not set"}
            </li>
            <li className={playwrightReady ? "ok" : "missing"}>
              Playwright browsers {playwrightReady ? "installed" : "missing"}
            </li>
          </ul>
          {!ready && (
            <Link to="/settings" className="home-status-link">
              Go to Settings →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
