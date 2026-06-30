// Built-in provider presets for the Settings screen. Selecting one fills in the
// base URL and a sensible default model; every field stays editable, and
// "Custom" lets you point at any OpenAI-compatible endpoint (including local
// servers such as Ollama, LM Studio, or vLLM).
//
// Tardigrade drives the agent from screenshots, so the model must be
// multimodal. `supportsVision: false` presets are included for convenience but
// flagged in the UI because their default chat models cannot read images.

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  supportsVision: boolean;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    supportsVision: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    supportsVision: true,
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "gemma-4-31b",
    supportsVision: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    supportsVision: false,
    note: "DeepSeek's API chat models are text-only — they cannot read the screenshots Tardigrade sends.",
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.7",
    supportsVision: false,
    note: "Kimi K2 models are text-only and fix sampling params; use a Moonshot vision-preview model for screenshots. Model IDs change often — check platform.moonshot.ai.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    defaultModel: "",
    supportsVision: true,
    note: "Point at any OpenAI-compatible endpoint, including local servers such as Ollama, LM Studio, or vLLM.",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
