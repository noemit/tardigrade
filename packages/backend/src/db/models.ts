export interface Viewport {
  width: number;
  height: number;
}

export interface Run {
  id: string;
  url: string;
  status: "pending" | "running" | "completed" | "failed";
  rubricSetId?: string;
  goal?: string;
  browser?: string;
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

export interface Session {
  id: string;
  runId: string;
  stepIndex: number;
  action: string;
  screenshotPath?: string;
  domSnapshotPath?: string;
  consoleLogs?: string;
  networkErrors?: string;
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

export interface FindingEvidence {
  type: "screenshot" | "console" | "network" | "dom" | "text";
  path?: string;
  content?: string;
}

export interface TimelineCapture {
  id: string;
  runId: string;
  stepIndex?: number;
  screenshotPath?: string;
  capturedAt: string;
}

export interface Frame {
  id: string;
  runId: string;
  frameIndex: number;
  screenshotPath: string;
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

export interface RubricSet {
  id: string;
  name: string;
  description: string;
  rubrics: Rubric[];
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
