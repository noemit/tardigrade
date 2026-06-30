import dotenv from "dotenv";
import path from "path";
import os from "os";
import fs from "fs";

// Load .env from the repo root if it exists.
const rootDir = path.resolve(import.meta.dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";
const DEFAULT_MODEL = "gemma-4-31b";

// Controls how many vision tokens a run spends by tuning the screenshots sent
// to the model on each agent turn:
//   high     – full-detail screenshot every step (best accuracy, most tokens)
//   balanced – low-detail screenshot every step (one image per action, cheaper)
//   minimal  – low-detail screenshot only on the first step and after the page
//              changes; text-only (accessibility tree) otherwise (fewest tokens)
// Note: this only affects images sent to the LLM. The per-second replay frames
// saved to disk are unaffected and never sent to the model.
export type ImageMode = "high" | "balanced" | "minimal";
const IMAGE_MODES: ImageMode[] = ["high", "balanced", "minimal"];
const DEFAULT_IMAGE_MODE: ImageMode = "high";

function getUserDataDir(): string {
  const dir = path.join(os.homedir(), ".tardigrade");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export const userDataDir = getUserDataDir();

const configFilePath = path.join(userDataDir, "config.json");

export interface UserSettings {
  // Provider-neutral settings.
  llmProvider?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  imageMode?: ImageMode;
  defaultBrowser?: "chromium" | "firefox" | "webkit";
  // Legacy fields kept readable so existing config.json files keep working.
  cerebrasApiKey?: string;
  cerebrasModel?: string;
}

function loadUserSettings(): UserSettings {
  if (!fs.existsSync(configFilePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configFilePath, "utf-8")) as UserSettings;
  } catch {
    return {};
  }
}

export function saveUserSettings(settings: UserSettings): void {
  fs.writeFileSync(configFilePath, JSON.stringify(settings, null, 2));
}

export function getUserSettings(): UserSettings {
  return loadUserSettings();
}

// The OpenAI-compatible SDK appends paths like /chat/completions to the base
// URL (it does NOT add /v1 the way the old Cerebras SDK did). Normalize so a
// bare host such as https://api.cerebras.ai or https://api.deepseek.com still
// resolves to the /v1 root. URLs that already carry a path (e.g. OpenAI's
// /v1 or Gemini's /v1beta/openai) are left untouched.
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return `${trimmed}/v1`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

function resolveProvider(settings: UserSettings): string {
  return settings.llmProvider || process.env.LLM_PROVIDER || "";
}

function resolveApiKey(settings: UserSettings): string {
  return (
    settings.llmApiKey ||
    settings.cerebrasApiKey ||
    process.env.LLM_API_KEY ||
    process.env.CEREBRAS_API_KEY ||
    ""
  );
}

function resolveBaseUrl(settings: UserSettings): string {
  return normalizeBaseUrl(
    settings.llmBaseUrl ||
      process.env.LLM_BASE_URL ||
      process.env.CEREBRAS_BASE_URL ||
      DEFAULT_BASE_URL
  );
}

function resolveModel(settings: UserSettings): string {
  return (
    settings.llmModel ||
    settings.cerebrasModel ||
    process.env.LLM_MODEL ||
    process.env.CEREBRAS_MODEL ||
    DEFAULT_MODEL
  );
}

export function resolveImageMode(settings: UserSettings): ImageMode {
  const raw = settings.imageMode || process.env.LLM_IMAGE_MODE || DEFAULT_IMAGE_MODE;
  return (IMAGE_MODES as string[]).includes(raw) ? (raw as ImageMode) : DEFAULT_IMAGE_MODE;
}

const userSettings = loadUserSettings();

export const config = {
  port: parseInt(process.env.BACKEND_PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  userDataDir,
  dbPath: path.join(userDataDir, "tardigrade.db"),
  configFilePath,
  defaults: {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    imageMode: DEFAULT_IMAGE_MODE,
  },
  llm: {
    provider: resolveProvider(userSettings),
    apiKey: resolveApiKey(userSettings),
    baseUrl: resolveBaseUrl(userSettings),
    model: resolveModel(userSettings),
  },
  vision: {
    imageMode: resolveImageMode(userSettings),
  },
} as const;

export function reloadConfig(): void {
  const settings = loadUserSettings();
  (config.llm as { provider: string }).provider = resolveProvider(settings);
  (config.llm as { apiKey: string }).apiKey = resolveApiKey(settings);
  (config.llm as { baseUrl: string }).baseUrl = resolveBaseUrl(settings);
  (config.llm as { model: string }).model = resolveModel(settings);
  (config.vision as { imageMode: ImageMode }).imageMode = resolveImageMode(settings);
}
