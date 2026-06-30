# LLM Prompts

This document records the prompts sent to the LLM. They are the most important levers for improving audit quality.

## 1. Agent action prompt

**File:** `packages/backend/src/agent/loop.ts` (`SYSTEM_PROMPT`)

**Purpose:** Decide the next browser action given a screenshot and semantic DOM snapshot.

**Output schema:**

```json
{
  "type": "navigate" | "click" | "type" | "scroll" | "wait" | "terminate",
  "reasoning": "string",
  "url": "string",
  "selector": "string",
  "value": "string",
  "direction": "up" | "down",
  "milliseconds": 1000,
  "status": "success" | "failure" | "stuck",
  "summary": "string"
}
```

**Key instructions:**

- Prefer clicking real interactive elements using semantic selectors or accessible names.
- Do not fill sensitive forms (passwords, credit cards, SSN).
- Terminate with `stuck` if the page is not changing.
- Terminate with `success` after meaningful exploration.
- Respond with strict JSON; no markdown code fences.

**Iteration notes:**

- If the agent clicks invisible or non-interactive elements, tighten the selector guidance or add an explicit "verify the element is visible" instruction.
- If the agent terminates too early, increase `maxSteps` or ask for a minimum number of interactions.
- If actions fail frequently, ask the model to prefer `data-testid` or `role` attributes over CSS classes.

## 2. Evaluator prompt

**File:** `packages/backend/src/evaluator/scorer.ts` (`EVALUATOR_SYSTEM_PROMPT`)

**Purpose:** Score a recorded session against a single rubric criterion.

**Input context:**

- The rubric (name, category, criteria, scoring type)
- A summary of the session: URLs visited, actions taken, console logs, network errors
- Paths to screenshots and DOM snapshots

**Output schema:**

```json
{
  "score": 0,
  "maxScore": 1,
  "severity": "critical" | "high" | "medium" | "low" | "info",
  "title": "string",
  "description": "string",
  "evidence": [
    { "type": "screenshot" | "console" | "network" | "dom" | "text", "stepIndex": 0, "explanation": "string" }
  ]
}
```

**Key instructions:**

- `pass/fail` → score 1 or 0
- `present/absent` → score 1 or 0
- `1-5` → score 1–5
- Severity must map to impact: critical (blocks goal), high (broken primary flow), medium (noticeable issue), low (polish), info (observation)
- Every claim must cite evidence from the session.

**Iteration notes:**

- If scores feel inflated, ask the model to be stricter or require multiple evidence points for a pass.
- If evidence references are vague, ask for the exact step index and visible text/element in the screenshot.

## 3. Rubric generation prompt

**File:** `packages/backend/src/rubrics/system-prompts/rubric-to-json.txt`

**Purpose:** Convert a plain-English rubric description into the structured JSON rubric format.

**Output schema:**

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "rubrics": [
    {
      "id": "string",
      "name": "string",
      "category": "ux" | "functional" | "conversion" | "accessibility" | "custom",
      "weight": 1.0,
      "criteria": "string",
      "requiredEvidence": ["screenshot"],
      "scoringType": "pass/fail" | "1-5" | "present/absent"
    }
  ]
}
```

**Key instructions:**

- Generate 1–5 criteria from the description.
- Criteria must be observable by a synthetic user.
- Weights should average ~1.0 each.
- Required evidence should be the minimal set needed.
- Output only valid JSON.

**Iteration notes:**

- If generated rubrics are too vague, add examples of good criteria to the prompt.
- If categories are wrong, add a short definition for each category.

## Prompt engineering checklist

When iterating on any prompt:

1. Keep the output schema explicit and complete.
2. Add 1–2 concrete examples if the model drifts.
3. Run the same URL before/after the change and diff the findings.
4. Watch token usage; vision prompts are expensive.
5. Test with `MOCK_LLM=true` for UI/pipeline changes, then verify with a real model.
