import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createRun,
  listRuns,
  getPlaywrightStatus,
  Run,
  PlaywrightStatus,
  SupportedBrowser,
  Viewport,
} from "../api.js";

const BROWSERS: { id: SupportedBrowser; label: string }[] = [
  { id: "chromium", label: "Chromium" },
  { id: "firefox", label: "Firefox" },
  { id: "webkit", label: "WebKit" },
];

const VIEWPORT_PRESETS: { id: string; label: string; viewport: Viewport }[] = [
  { id: "desktop", label: "Desktop (1280×800)", viewport: { width: 1280, height: 800 } },
  { id: "laptop", label: "Laptop (1440×900)", viewport: { width: 1440, height: 900 } },
  { id: "large", label: "Large Desktop (1920×1080)", viewport: { width: 1920, height: 1080 } },
  { id: "tablet", label: "Tablet (768×1024)", viewport: { width: 768, height: 1024 } },
  { id: "mobile", label: "Mobile (375×667)", viewport: { width: 375, height: 667 } },
];

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Already has a scheme.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Looks like localhost or an IP with optional port.
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Default to https for everything else.
  return `https://${trimmed}`;
}

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(normalizeUrl(input));
    return url.hostname.length > 0;
  } catch {
    return false;
  }
}

export default function NewAudit() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [selectedBrowsers, setSelectedBrowsers] = useState<SupportedBrowser[]>(["chromium"]);
  const [selectedViewports, setSelectedViewports] = useState<string[]>(["desktop"]);
  const [maxDurationSeconds, setMaxDurationSeconds] = useState<number | null>(60);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [pwStatus, setPwStatus] = useState<PlaywrightStatus | null>(null);
  const [showTaskClipboard, setShowTaskClipboard] = useState(false);
  const clipboardRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [runsData, pw] = await Promise.all([listRuns(), getPlaywrightStatus()]);
    setRuns(runsData.runs);
    setPwStatus(pw);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  // Close task clipboard when clicking outside.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clipboardRef.current && !clipboardRef.current.contains(e.target as Node)) {
        setShowTaskClipboard(false);
      }
    }
    if (showTaskClipboard) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showTaskClipboard]);

  const previousTasks = useMemo(() => {
    const tasks = new Set<string>();
    for (const run of runs) {
      if (run.goal && run.goal.trim()) {
        tasks.add(run.goal.trim());
      }
    }
    return Array.from(tasks).slice(0, 20);
  }, [runs]);

  const recentUrls = useMemo(() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const run of runs) {
      const trimmed = run.url.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        urls.push(trimmed);
      }
      if (urls.length >= 8) break;
    }
    return urls;
  }, [runs]);

  function toggleBrowser(browser: SupportedBrowser) {
    setSelectedBrowsers((prev) =>
      prev.includes(browser) ? prev.filter((b) => b !== browser) : [...prev, browser]
    );
  }

  function toggleViewport(id: string) {
    setSelectedViewports((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !isValidUrl(url)) return;
    if (selectedBrowsers.length === 0 || selectedViewports.length === 0) return;

    setLoading(true);
    try {
      const viewports = VIEWPORT_PRESETS.filter((p) =>
        selectedViewports.includes(p.id)
      ).map((p) => p.viewport);
      const { runs } = await createRun({
        url: normalizeUrl(url),
        goal: goal || undefined,
        browsers: selectedBrowsers,
        viewports,
        maxDurationSeconds: maxDurationSeconds ?? undefined,
      });
      if (runs.length > 0) {
        navigate(`/runs/${runs[0].id}`);
      }
      setUrl("");
      setGoal("");
      setSelectedBrowsers(["chromium"]);
      setSelectedViewports(["desktop"]);
      setMaxDurationSeconds(60);
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  const normalizedUrl = normalizeUrl(url);
  const canSubmit =
    url && isValidUrl(url) && selectedBrowsers.length > 0 && selectedViewports.length > 0 && pwStatus?.available;

  return (
    <div className="new-audit">
      <h1 className="page-title">
        <span className="page-title-dot" />
        New Audit
      </h1>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <label htmlFor="url">URL to audit</label>
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com or http://localhost:3000"
            required
          />
          {url && !isValidUrl(url) && (
            <p className="error">Please enter a valid URL.</p>
          )}
          {url && isValidUrl(url) && normalizedUrl !== url.trim() && (
            <p className="success">Will audit {normalizedUrl}</p>
          )}

          {recentUrls.length > 0 && (
            <div className="recent-urls">
              <span className="recent-urls-label">Recent URLs</span>
              <div className="recent-urls-chips">
                {recentUrls.map((recentUrl) => (
                  <button
                    key={recentUrl}
                    type="button"
                    className="recent-url-chip"
                    onClick={() => setUrl(recentUrl)}
                  >
                    {recentUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label htmlFor="goal">Task / goal for the agent</label>
          <div className="task-input-wrap" ref={clipboardRef}>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              placeholder="Example: Explore the site and the blog and tell me what it's about and who it's for. You are a 42 year old female from Wisconsin."
            />
            <button
              type="button"
              className="task-clipboard-button"
              onClick={() => setShowTaskClipboard((s) => !s)}
              title="Previous tasks"
              aria-label="Open previous tasks"
            >
              📝
            </button>
            {showTaskClipboard && (
              <div className="task-clipboard-popover">
                {previousTasks.length === 0 ? (
                  <p className="task-clipboard-empty">No previous tasks yet.</p>
                ) : (
                  <ul className="task-clipboard-list">
                    {previousTasks.map((task, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => {
                            setGoal(task);
                            setShowTaskClipboard(false);
                          }}
                        >
                          {task}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <fieldset className="checkbox-group">
            <legend>Browsers</legend>
            <div className="checkbox-row">
              {BROWSERS.map((browser) => (
                <label key={browser.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedBrowsers.includes(browser.id)}
                    onChange={() => toggleBrowser(browser.id)}
                  />
                  {browser.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="checkbox-group">
            <legend>Screen dimensions</legend>
            <div className="checkbox-row">
              {VIEWPORT_PRESETS.map((preset) => (
                <label key={preset.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedViewports.includes(preset.id)}
                    onChange={() => toggleViewport(preset.id)}
                  />
                  {preset.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label htmlFor="duration">Expected test length</label>
          <select
            id="duration"
            value={maxDurationSeconds ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setMaxDurationSeconds(value === "" ? null : parseInt(value, 10));
            }}
          >
            <option value="">N/A — run until max steps</option>
            <option value={60}>1 minute</option>
            <option value={180}>3 minutes</option>
            <option value={300}>5 minutes</option>
            <option value={600}>10 minutes</option>
            <option value={900}>15 minutes</option>
            <option value={1200}>20 minutes</option>
          </select>

          <button type="submit" disabled={loading || !canSubmit}>
            {loading ? "Starting..." : "Start Audit"}
          </button>
        </form>
      </div>
    </div>
  );
}
