import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { generateRubricSet, saveRubricSet, RubricSet, Rubric } from "../api.js";

export default function RubricBuilder() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [rubricSet, setRubricSet] = useState<RubricSet | null>(null);
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSaved(false);
    try {
      const result = await generateRubricSet(prompt);
      setRubricSet(result.rubricSet);
      setJson(JSON.stringify(result.rubricSet, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleJsonChange(value: string) {
    setJson(value);
    setSaved(false);
    try {
      const parsed = JSON.parse(value) as RubricSet;
      setRubricSet(parsed);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON");
    }
  }

  function handleFieldChange<K extends keyof RubricSet>(field: K, value: RubricSet[K]) {
    setRubricSet((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      setJson(JSON.stringify(next, null, 2));
      return next;
    });
    setSaved(false);
  }

  function handleRubricChange(index: number, field: keyof Rubric, value: string | number | string[]) {
    setRubricSet((prev) => {
      if (!prev) return prev;
      const rubrics = [...prev.rubrics];
      rubrics[index] = { ...rubrics[index], [field]: value };
      const next = { ...prev, rubrics };
      setJson(JSON.stringify(next, null, 2));
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    if (!rubricSet) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Ensure a stable id before saving.
      const toSave: RubricSet = {
        ...rubricSet,
        id: rubricSet.id && !rubricSet.id.startsWith("generated") ? rubricSet.id : crypto.randomUUID(),
      };
      await saveRubricSet(toSave);
      setRubricSet(toSave);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rubric-builder">
      <Link to="/">← Back to runs</Link>
      <h1>Rubric Builder</h1>
      <p>
        Describe what you want to evaluate. Gemma 4 will turn your description into a structured,
        shareable rubric JSON.
      </p>

      <form onSubmit={handleGenerate}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="Example: Check that the pricing page clearly shows the most popular plan and that the CTA button is above the fold."
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Generating..." : "Generate Rubric JSON"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Rubric saved.</p>}

      {rubricSet && (
        <div className="card">
          <h2>Edit Rubric Set</h2>
          <label htmlFor="rubricName">Name</label>
          <input
            id="rubricName"
            type="text"
            value={rubricSet.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
          />

          <label htmlFor="rubricDescription">Description</label>
          <input
            id="rubricDescription"
            type="text"
            value={rubricSet.description}
            onChange={(e) => handleFieldChange("description", e.target.value)}
          />

          <h3>Rubrics</h3>
          {rubricSet.rubrics.map((rubric, idx) => (
            <div key={idx} className="card" style={{ marginBottom: "1rem" }}>
              <label>Name</label>
              <input
                type="text"
                value={rubric.name}
                onChange={(e) => handleRubricChange(idx, "name", e.target.value)}
              />

              <label>Category</label>
              <select
                value={rubric.category}
                onChange={(e) =>
                  handleRubricChange(idx, "category", e.target.value as Rubric["category"])
                }
              >
                <option value="ux">UX</option>
                <option value="functional">Functional</option>
                <option value="conversion">Conversion</option>
                <option value="accessibility">Accessibility</option>
                <option value="custom">Custom</option>
              </select>

              <label>Scoring type</label>
              <select
                value={rubric.scoringType}
                onChange={(e) =>
                  handleRubricChange(idx, "scoringType", e.target.value as Rubric["scoringType"])
                }
              >
                <option value="pass/fail">Pass/Fail</option>
                <option value="1-5">1-5</option>
                <option value="present/absent">Present/Absent</option>
              </select>

              <label>Weight</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={rubric.weight}
                onChange={(e) => handleRubricChange(idx, "weight", parseFloat(e.target.value))}
              />

              <label>Criteria</label>
              <textarea
                rows={3}
                value={rubric.criteria}
                onChange={(e) => handleRubricChange(idx, "criteria", e.target.value)}
              />

              <label>Required evidence</label>
              <select
                multiple
                value={rubric.requiredEvidence}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                  handleRubricChange(idx, "requiredEvidence", values);
                }}
              >
                <option value="screenshot">Screenshot</option>
                <option value="console">Console</option>
                <option value="network">Network</option>
                <option value="dom">DOM</option>
                <option value="reproduction">Reproduction</option>
              </select>
            </div>
          ))}

          <button onClick={handleSave} disabled={saving || !!error}>
            {saving ? "Saving..." : "Save rubric set"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={{ marginLeft: "0.75rem", background: "var(--surface-2)", color: "var(--text)" }}
          >
            Back to audits
          </button>
        </div>
      )}

      {json && (
        <div className="card">
          <h2>Generated JSON</h2>
          <textarea
            value={json}
            onChange={(e) => handleJsonChange(e.target.value)}
            rows={12}
            style={{ fontFamily: "monospace", width: "100%" }}
          />
        </div>
      )}
    </div>
  );
}
