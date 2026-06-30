import type { AgentAction } from "./actions.js";

export interface LookRecord {
  lookIndex: number;
  frameIndex: number;
  action: AgentAction;
  url: string;
  title: string;
}

export interface SessionMemory {
  runId: string;
  goal: string;
  url: string;
  maxTurns: number;
  history: LookRecord[];
  totalTokens: number;
  cachedTokens: number;
  llmCallCount: number;
}

export function createMemory(runId: string, url: string, goal: string, maxTurns = 20): SessionMemory {
  return {
    runId,
    goal,
    url,
    maxTurns,
    history: [],
    totalTokens: 0,
    cachedTokens: 0,
    llmCallCount: 0,
  };
}

export function addLook(memory: SessionMemory, record: LookRecord): void {
  memory.history.push(record);
  memory.llmCallCount += 1;
}

export function addTokens(memory: SessionMemory, tokens: number): void {
  memory.totalTokens += tokens;
}

export function addCachedTokens(memory: SessionMemory, tokens: number): void {
  memory.cachedTokens += tokens;
}

export function formatHistory(memory: SessionMemory): string {
  if (memory.history.length === 0) return "No previous actions.";
  return memory.history
    .map((look) => {
      const action = JSON.stringify(look.action);
      return `Frame ${look.frameIndex}, Look ${look.lookIndex}: ${action}\n  → ${look.title} (${look.url})`;
    })
    .join("\n");
}
