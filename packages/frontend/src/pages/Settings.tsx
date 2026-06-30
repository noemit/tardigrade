import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getSettings,
  updateSettings,
  getPlaywrightStatus,
  Settings,
  PlaywrightStatus,
} from "../api.js";
import { PROVIDER_PRESETS, getPreset } from "../lib/providers.js";

const MASKED_KEY = "***";

const IMAGE_MODE_OPTIONS: {
  value: Settings["imageMode"];
  label: string;
  hint: string;
}[] = [
  {
    value: "high",
    label: "High — full-detail screenshot every step",
    hint: "Best visual accuracy, highest vision-token cost.",
  },
  {
    value: "balanced",
    label: "Balanced — low-detail screenshot every step",
    hint: "One cheaper image per agent action. Good cost/quality trade-off.",
  },
  {
    value: "minimal",
    label: "Minimal — low-detail, only when the page changes",
    hint: "Sends an image on the first step and after navigations; relies on the page's text otherwise. Fewest tokens.",
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    llmProvider: "custom",
    llmApiKey: "",
    llmApiKeySource: "unset",
    llmBaseUrl: "",
    llmBaseUrlSource: "default",
    llmModel: "",
    llmModelSource: "default",
    imageMode: "high",
    defaultBrowser: "chromium",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pwStatus, setPwStatus] = useState<PlaywrightStatus | null>(null);

  useEffect(() => {
    getSettings()
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));

    getPlaywrightStatus().then((status) => setPwStatus(status));
  }, []);

  function handleProviderChange(providerId: string) {
    const preset = getPreset(providerId);
    setSettings((s) => ({
      ...s,
      llmProvider: providerId,
      // Fill base URL + model from the preset (Custom clears them).
      llmBaseUrl: preset ? preset.baseUrl : s.llmBaseUrl,
      llmBaseUrlSource: "saved",
      llmModel: preset ? preset.defaultModel : s.llmModel,
      llmModelSource: "saved",
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      // Don't overwrite a stored key with the masked placeholder if untouched.
      const payload: Partial<Settings> = { ...settings };
      if (payload.llmApiKey === MASKED_KEY) {
        delete payload.llmApiKey;
      }
      const data = await updateSettings(payload);
      setSettings(data.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading settings...</p>;

  const activePreset = getPreset(settings.llmProvider);
  const activeImageMode = IMAGE_MODE_OPTIONS.find((o) => o.value === settings.imageMode);

  return (
    <div className="settings-page">
      <Link to="/runs">← Back to runs</Link>
      <h1>Settings</h1>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <p className="hint">
            Tardigrade audits from screenshots, so you must use a <strong>multimodal
            (vision)</strong> model. Text-only models (e.g. DeepSeek chat, Kimi K2)
            will fail to run.
          </p>

          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={settings.llmProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {activePreset?.note && <p className="hint">{activePreset.note}</p>}
          {activePreset && !activePreset.supportsVision && (
            <p className="error">
              ⚠ This provider's default model is text-only. Tardigrade sends
              screenshots, so pick a vision-capable model or another provider.
            </p>
          )}

          <label htmlFor="baseUrl">Base URL</label>
          <input
            id="baseUrl"
            type="text"
            value={settings.llmBaseUrl}
            onChange={(e) =>
              setSettings((s) => ({ ...s, llmBaseUrl: e.target.value, llmBaseUrlSource: "saved" }))
            }
            placeholder="https://api.openai.com/v1"
          />
          {settings.llmBaseUrlSource === "env" && (
            <p className="success">Base URL is set from the LLM_BASE_URL environment variable.</p>
          )}

          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            type="password"
            value={settings.llmApiKey}
            onChange={(e) =>
              setSettings((s) => ({ ...s, llmApiKey: e.target.value, llmApiKeySource: "saved" }))
            }
            placeholder="Paste your provider API key"
          />
          {settings.llmApiKeySource === "env" && (
            <p className="success">API key is set from the LLM_API_KEY environment variable.</p>
          )}
          {settings.llmApiKeySource === "unset" && (
            <p className="error">No API key configured. Set LLM_API_KEY or paste one here.</p>
          )}

          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            value={settings.llmModel}
            onChange={(e) =>
              setSettings((s) => ({ ...s, llmModel: e.target.value, llmModelSource: "saved" }))
            }
            placeholder="gpt-4o"
          />
          {settings.llmModelSource === "env" && (
            <p className="success">Model is set from the LLM_MODEL environment variable.</p>
          )}

          <label htmlFor="imageMode">Image usage (token cost)</label>
          <select
            id="imageMode"
            value={settings.imageMode}
            onChange={(e) =>
              setSettings((s) => ({ ...s, imageMode: e.target.value as Settings["imageMode"] }))
            }
          >
            {IMAGE_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {activeImageMode && <p className="hint">{activeImageMode.hint}</p>}

          <label htmlFor="browser">Default browser</label>
          <select
            id="browser"
            value={settings.defaultBrowser}
            onChange={(e) =>
              setSettings((s) => ({ ...s, defaultBrowser: e.target.value as Settings["defaultBrowser"] }))
            }
          >
            <option value="chromium">Chromium</option>
            <option value="firefox">Firefox</option>
            <option value="webkit">WebKit</option>
          </select>

          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        </form>

        {saved && <p className="success">Settings saved.</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card status-card">
        <h2>Playwright Status</h2>
        {pwStatus ? (
          pwStatus.available ? (
            <p className="success">
              ✅ {pwStatus.browser} {pwStatus.version} is installed.
            </p>
          ) : (
            <div>
              <p className="error">❌ Playwright browsers are missing.</p>
              <p>{pwStatus.error}</p>
              <pre>
                <code>npx playwright install chromium</code>
              </pre>
            </div>
          )
        ) : (
          <p>Checking...</p>
        )}
      </div>
    </div>
  );
}
