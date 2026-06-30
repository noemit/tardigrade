let backendUrl: string | null = null;

async function getBackendUrl(): Promise<string> {
  if (backendUrl) return backendUrl;
  if (window.electronAPI) {
    backendUrl = await window.electronAPI.getBackendUrl();
  } else {
    backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
  }
  return backendUrl;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await getBackendUrl();
  return fetch(`${base}${path}`, init);
}

export async function artifactUrl(relativePath: string | null | undefined): Promise<string | undefined> {
  if (!relativePath) return undefined;
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  const base = await getBackendUrl();
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${base}${path}`;
}

export interface PlaywrightStatus {
  available: boolean;
  browser?: string;
  version?: string;
  error?: string;
}

export async function getPlaywrightStatus(): Promise<PlaywrightStatus> {
  const res = await apiFetch("/playwright-status");
  return res.json();
}

export interface Viewport {
  width: number;
  height: number;
}

export type SupportedBrowser = "chromium" | "firefox" | "webkit";

export interface Run {
  id: string;
  url: string;
  status: string;
  rubricSetId?: string;
  goal?: string;
  browser?: SupportedBrowser;
  viewport?: Viewport;
  maxDurationSeconds?: number;
  batchId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  tokenCount?: number;
  llmCallCount?: number;
  cachedTokens?: number;
  evaluationSummary?: string;
}

export async function listRuns(): Promise<{ runs: Run[] }> {
  const res = await apiFetch("/runs");
  return res.json();
}

export async function getRun(id: string): Promise<{ run: Run }> {
  const res = await apiFetch(`/runs/${id}`);
  return res.json();
}

export interface CreateRunOptions {
  url: string;
  goal?: string;
  browsers?: SupportedBrowser[];
  viewports?: Viewport[];
  maxDurationSeconds?: number;
}

export async function createRun(options: CreateRunOptions): Promise<{ runs: Run[]; batchId: string }> {
  const res = await apiFetch("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: options.url,
      goal: options.goal,
      browsers: options.browsers,
      viewports: options.viewports,
      maxDurationSeconds: options.maxDurationSeconds,
    }),
  });
  return res.json();
}

export interface Session {
  id: string;
  runId: string;
  stepIndex: number;
  action: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  domSnapshotPath?: string;
  domSnapshotUrl?: string;
  consoleLogs?: string;
  networkErrors?: string;
  createdAt: string;
}

export interface FindingEvidence {
  type: "screenshot" | "console" | "network" | "dom" | "text";
  path?: string;
  url?: string;
  content?: string;
}

export interface TimelineCapture {
  id: string;
  runId: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  capturedAt: string;
}

export interface Frame {
  id: string;
  runId: string;
  frameIndex: number;
  screenshotPath?: string;
  screenshotUrl?: string;
  url?: string;
  title?: string;
  createdAt: string;
}

export interface Look {
  id: string;
  frameId: string;
  runId: string;
  frameIndex: number;
  lookIndex: number;
  type: "zoom" | "pan" | "zoom_out" | "click" | "commentary" | "new_frame";
  screenshotPath?: string;
  screenshotUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  commentaryText?: string;
  action?: string;
  createdAt: string;
}

export interface Thought {
  id: string;
  runId: string;
  stepIndex: number;
  text: string;
  createdAt: string;
}

export interface DebugLogEntry {
  id: string;
  runId: string;
  stepIndex?: number;
  type: "request" | "response" | "error";
  content: string;
  createdAt: string;
}

export interface Finding {
  id: string;
  runId: string;
  rubricId: string;
  category: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  score: number;
  maxScore: number;
  evidence: FindingEvidence[];
  createdAt: string;
}

export async function getSessions(runId: string): Promise<{ sessions: Session[] }> {
  const res = await apiFetch(`/runs/${runId}/sessions`);
  return res.json();
}

export async function getFindings(runId: string): Promise<{ findings: Finding[] }> {
  const res = await apiFetch(`/runs/${runId}/findings`);
  return res.json();
}

export async function getTimeline(runId: string): Promise<{ timeline: TimelineCapture[] }> {
  const res = await apiFetch(`/runs/${runId}/timeline`);
  return res.json();
}

export async function getFrames(runId: string): Promise<{ frames: Frame[] }> {
  const res = await apiFetch(`/runs/${runId}/frames`);
  return res.json();
}

export async function getLooks(runId: string): Promise<{ looks: Look[] }> {
  const res = await apiFetch(`/runs/${runId}/looks`);
  return res.json();
}

export async function getThoughts(runId: string): Promise<{ thoughts: Thought[] }> {
  const res = await apiFetch(`/runs/${runId}/thoughts`);
  return res.json();
}

export async function getDebugLog(runId: string): Promise<{ entries: DebugLogEntry[] }> {
  const res = await apiFetch(`/runs/${runId}/debug-log`);
  return res.json();
}

export interface Rubric {
  id: string;
  name: string;
  category: "ux" | "functional" | "conversion" | "accessibility" | "custom";
  weight: number;
  criteria: string;
  requiredEvidence: ("screenshot" | "console" | "network" | "dom" | "reproduction")[];
  scoringType: "pass/fail" | "1-5" | "present/absent";
}

export interface RubricSet {
  id: string;
  name: string;
  description: string;
  rubrics: Rubric[];
}

export async function listRubricSets(): Promise<{ sets: RubricSet[] }> {
  const res = await apiFetch("/rubrics");
  return res.json();
}

export async function generateRubricSet(prompt: string): Promise<{ rubricSet: RubricSet }> {
  const res = await apiFetch("/rubrics/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return res.json();
}

export async function getRubricSet(id: string): Promise<{ rubricSet: RubricSet }> {
  const res = await apiFetch(`/rubrics/${id}`);
  return res.json();
}

export async function saveRubricSet(rubricSet: RubricSet): Promise<{ rubricSet: RubricSet }> {
  const res = await apiFetch("/rubrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rubricSet),
  });
  return res.json();
}

export interface Settings {
  llmProvider: string;
  llmApiKey: string;
  llmApiKeySource?: "saved" | "env" | "unset";
  llmBaseUrl: string;
  llmBaseUrlSource?: "saved" | "env" | "default";
  llmModel: string;
  llmModelSource?: "saved" | "env" | "default";
  imageMode: "high" | "balanced" | "minimal";
  defaultBrowser: "chromium" | "firefox" | "webkit";
}

export async function getSettings(): Promise<{ settings: Settings }> {
  const res = await apiFetch("/settings");
  return res.json();
}

export async function updateSettings(settings: Partial<Settings>): Promise<{ settings: Settings }> {
  const res = await apiFetch("/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return res.json();
}
