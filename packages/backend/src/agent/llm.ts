import OpenAI from "openai";
import { ZodSchema } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/store.js";

function getClient(): OpenAI {
  return new OpenAI({
    // Many OpenAI-compatible endpoints (and local servers) ignore the key, but
    // the SDK requires a non-empty string, so fall back to a placeholder.
    apiKey: config.llm.apiKey || "not-needed",
    baseURL: config.llm.baseUrl,
  });
}

// Some OpenAI-compatible providers reject unknown request fields. Only send the
// Cerebras/OpenAI-style prompt_cache_key to providers known to accept it.
function supportsPromptCacheKey(provider: string): boolean {
  return !["deepseek", "gemini", "kimi"].includes(provider);
}

export interface LlmCallOptions<T> {
  systemPrompt: string;
  userPrompt: string;
  imageBase64?: string; // data:image/jpeg;base64,...
  schema?: ZodSchema<T>;
  temperature?: number;
  maxTokens?: number;
  cacheKey?: string;
  imageDetail?: "low" | "high" | "auto";
  runId?: string;
  stepIndex?: number;
}

export interface LlmResponse<T> {
  data: T;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

let mockCallCount = 0;

function getMockAction() {
  mockCallCount += 1;
  if (mockCallCount === 1) {
    return {
      type: "scroll",
      direction: "down",
      reasoning: "Mock: scroll down to see more content",
    };
  }
  return {
    type: "terminate",
    status: "success",
    summary: "Mock exploration completed successfully.",
    reasoning: "Mock: enough steps for testing",
  };
}

function buildMessages(
  systemPrompt: string,
  userPrompt: string,
  imageBase64?: string,
  imageDetail?: "low" | "high" | "auto"
): Array<{ role: string; content: unknown }> {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: string } }
  > = [{ type: "text", text: userPrompt }];

  if (imageBase64) {
    content.push({
      type: "image_url",
      image_url: { url: imageBase64, detail: imageDetail ?? "high" },
    });
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content },
  ];
}

function loggableRequestBody(body: { messages?: Array<{ role: string; content: unknown }> }) {
  const copy = JSON.parse(JSON.stringify(body));
  if (Array.isArray(copy.messages)) {
    for (const msg of copy.messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
            const url = part.image_url.url;
            part.image_url.url = `${url.slice(0, 80)}…(${url.length} chars)`;
          }
        }
      }
    }
  }
  return copy;
}

function persistDebugLog(
  runId: string | undefined,
  stepIndex: number | undefined,
  type: "request" | "response" | "error",
  content: string
): void {
  if (!runId) return;
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO debug_log (id, run_id, step_index, type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), runId, stepIndex ?? null, type, content, new Date().toISOString());
  } catch (err) {
    console.error("[llm] failed to persist debug log:", err);
  }
}

function parseAssistantOutput(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/`/g, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function callLlm<T = unknown>(
  options: LlmCallOptions<T>,
  maxRetries = 2
): Promise<LlmResponse<T>> {
  if (process.env.MOCK_LLM === "true") {
    const data = options.schema ? options.schema.parse(getMockAction()) : (getMockAction() as T);
    return {
      data,
      tokensUsed: 100,
      promptTokens: 80,
      completionTokens: 20,
      cachedTokens: 0,
    };
  }

  if (!config.llm.apiKey) {
    throw new Error("No LLM API key configured. Set LLM_API_KEY or add one in Settings.");
  }

  let messages = buildMessages(
    options.systemPrompt,
    options.userPrompt,
    options.imageBase64,
    options.imageDetail
  );
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const requestBody = {
      model: config.llm.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.cacheKey && supportsPromptCacheKey(config.llm.provider)
        ? { prompt_cache_key: options.cacheKey }
        : {}),
    };

    const loggableRequest = loggableRequestBody(requestBody);
    console.log("[llm] request:", JSON.stringify(loggableRequest, null, 2));
    persistDebugLog(options.runId, options.stepIndex, "request", JSON.stringify(loggableRequest, null, 2));

    const completion = await getClient().chat.completions.create(requestBody as any);

    const response = completion as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: {
        total_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };

    if (!Array.isArray(response.choices) || response.choices.length === 0) {
      throw new Error("LLM response contained no choices");
    }

    const raw = response.choices[0]?.message?.content ?? "";
    console.log("[llm] response content:", raw.slice(0, 400));

    let parsed: unknown;
    try {
      parsed = parseAssistantOutput(raw);
    } catch (err) {
      lastError = new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
      persistDebugLog(options.runId, options.stepIndex, "error", lastError.message);
      if (attempt < maxRetries) {
        messages = [
          ...messages,
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "That was not valid JSON. Return ONLY a single raw JSON object matching the schema. Do not wrap it in Markdown code blocks. Make sure every required field, including 'reasoning', is present.",
          },
        ];
        console.log(`[llm] retry ${attempt + 1}/${maxRetries}: invalid JSON`);
        continue;
      }
      throw lastError;
    }

    if (options.schema) {
      const result = options.schema.safeParse(parsed);
      if (!result.success) {
        lastError = new Error(`LLM output failed schema validation: ${result.error.message}`);
        persistDebugLog(options.runId, options.stepIndex, "error", lastError.message);
        if (attempt < maxRetries) {
          messages = [
            ...messages,
            { role: "assistant", content: raw },
            {
              role: "user",
              content: `That response failed schema validation: ${result.error.message}. Return ONLY a single raw JSON object matching the schema. Remember 'reasoning' is required for every action.`,
            },
          ];
          console.log(`[llm] retry ${attempt + 1}/${maxRetries}: schema validation failed`);
          continue;
        }
        throw lastError;
      }
      parsed = result.data;
    }

    persistDebugLog(options.runId, options.stepIndex, "response", raw);

    const usage = response.usage ?? {};
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      data: parsed as T,
      tokensUsed: usage.total_tokens ?? 0,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      cachedTokens,
    };
  }

  throw lastError ?? new Error("LLM call failed after retries");
}
