import fs from "fs";
import path from "path";
import { z } from "zod";
import { callLlm } from "../agent/llm.js";
import { getDb } from "../db/store.js";
import type { RubricSet } from "../db/models.js";

const EvidenceTypeSchema = z.enum(["screenshot", "console", "network", "dom", "reproduction"]);

const RubricSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["ux", "functional", "conversion", "accessibility", "custom"]),
  weight: z.number().min(0).max(2),
  criteria: z.string(),
  requiredEvidence: z.array(EvidenceTypeSchema),
  scoringType: z.enum(["pass/fail", "1-5", "present/absent"]),
});

const RubricSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  rubrics: z.array(RubricSchema),
});

export type ValidatedRubricSet = z.infer<typeof RubricSetSchema>;

const BUILT_IN_SETS: Record<string, string[]> = {
  default: ["ux.json", "functional.json", "conversion.json"],
  ux: ["ux.json"],
  functional: ["functional.json"],
  conversion: ["conversion.json"],
};

function getRubricsDir(): string {
  return path.resolve(import.meta.dirname, "../rubrics");
}

function getSystemPromptPath(): string {
  return path.join(getRubricsDir(), "system-prompts", "rubric-to-json.txt");
}

export function loadRubricFile(filename: string): RubricSet {
  const filePath = path.join(getRubricsDir(), filename);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const parsed = RubricSetSchema.parse(raw);
  return parsed;
}

export function loadRubricSet(id: string): RubricSet {
  // Custom sets saved by users take precedence.
  const custom = loadCustomRubricSet(id);
  if (custom) return custom;

  const files = BUILT_IN_SETS[id];
  if (!files) {
    throw new Error(`Unknown rubric set: ${id}`);
  }

  const sets = files.map(loadRubricFile);
  const combinedRubrics = sets.flatMap((s) => s.rubrics);

  return {
    id,
    name: id === "default" ? "Default Starter Pack" : sets.map((s) => s.name).join(" + "),
    description: sets.map((s) => s.description).join(" "),
    rubrics: combinedRubrics,
  };
}

export function loadCustomRubricSet(id: string): RubricSet | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, description, rubrics FROM rubric_sets WHERE id = ?`)
    .get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rubrics: JSON.parse(row.rubrics),
  };
}

export function listRubricSets(): Array<{ id: string; name: string; description: string }> {
  const builtIn = Object.keys(BUILT_IN_SETS).map((id) => {
    const set = loadRubricSet(id);
    return { id: set.id, name: set.name, description: set.description };
  });

  const db = getDb();
  const rows = db
    .prepare(`SELECT id, name, description FROM rubric_sets ORDER BY created_at DESC`)
    .all() as any[];
  const custom = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
  }));

  return [...builtIn, ...custom];
}

export function saveRubricSet(set: RubricSet): RubricSet {
  const db = getDb();
  db.prepare(
    `INSERT INTO rubric_sets (id, name, description, rubrics, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       rubrics = excluded.rubrics`
  ).run(
    set.id,
    set.name,
    set.description,
    JSON.stringify(set.rubrics),
    new Date().toISOString()
  );
  return set;
}

export function validateRubricSet(data: unknown): RubricSet {
  return RubricSetSchema.parse(data);
}

export async function generateRubricSetFromPrompt(prompt: string): Promise<RubricSet> {
  if (process.env.MOCK_LLM === "true") {
    return {
      id: "generated",
      name: "Generated Rubric",
      description: prompt,
      rubrics: [
        {
          id: "generated-1",
          name: "Generated criterion",
          category: "custom",
          weight: 1,
          criteria: prompt,
          requiredEvidence: ["screenshot"],
          scoringType: "pass/fail",
        },
      ],
    };
  }

  const systemPrompt = fs.readFileSync(getSystemPromptPath(), "utf-8");

  const response = await callLlm<RubricSet>({
    systemPrompt,
    userPrompt: `Describe the rubric you want to create:\n\n${prompt}`,
    schema: RubricSetSchema,
    temperature: 0.2,
    maxTokens: 2048,
  });

  return response.data;
}
