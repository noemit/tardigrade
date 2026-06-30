import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getRun,
  getFindings,
  getFrames,
  getLooks,
  getThoughts,
  getDebugLog,
  artifactUrl,
  Run,
  Finding,
  Frame,
  Look,
  Thought,
  DebugLogEntry,
} from "../api.js";
import { useRunEvents, RunEvent } from "../hooks/useRunEvents.js";
import { formatCaption, formatThoughtCaption } from "../lib/caption.js";

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  interface CaptionLine {
    id: string;
    text: string;
    createdAt: number;
  }
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [headerCollapsed, setHeaderCollapsed] = useState(true);

  function pushCaption(text: string | null | undefined) {
    if (!text) return;
    const line: CaptionLine = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      createdAt: Date.now(),
    };
    setCaptions((prev) => [line, ...prev].slice(0, 4));
  }
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [expandedComments, setExpandedComments] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const userInteractedRef = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      const [runData, findingsData, framesData, looksData, thoughtsData, debugData] = await Promise.all([
        getRun(id!),
        getFindings(id!),
        getFrames(id!),
        getLooks(id!),
        getThoughts(id!),
        getDebugLog(id!),
      ]);
      setRun(runData.run);
      setFindings(findingsData.findings);
      setFrames(
        await Promise.all(
          framesData.frames.map(async (f) => ({
            ...f,
            screenshotUrl: await artifactUrl(f.screenshotUrl),
          }))
        )
      );
      setLooks(
        await Promise.all(
          looksData.looks.map(async (l) => ({
            ...l,
            screenshotUrl: await artifactUrl(l.screenshotUrl),
          }))
        )
      );
      setThoughts(thoughtsData.thoughts);
      setDebugLog(debugData.entries);
    }
    load();
  }, [id]);

  useRunEvents(id, {
    onEvent: async (event) => {
      if (!id) return;

      if (event.type === "frame.new") {
        const url = await artifactUrl(event.url);
        const newFrame: Frame = {
          id: `live-frame-${event.frameIndex}-${event.timestamp}`,
          runId: id,
          frameIndex: event.frameIndex,
          screenshotUrl: url,
          url: event.url,
          title: event.title,
          createdAt: event.timestamp,
        };
        setFrames((prev) => {
          const withoutDup = prev.filter((f) => f.frameIndex !== event.frameIndex);
          return [...withoutDup, newFrame].sort((a, b) => a.frameIndex - b.frameIndex);
        });
        if (!userInteractedRef.current) {
          setActiveFrameIndex(event.frameIndex);
        }
      }

      if (
        event.type === "look.zoom" ||
        event.type === "look.pan" ||
        event.type === "look.zoom_out" ||
        event.type === "look.click" ||
        event.type === "look.comment"
      ) {
        const look: Look = {
          id: `live-look-${event.frameIndex}-${event.lookIndex}-${event.timestamp}`,
          frameId:
            frames.find((f) => f.frameIndex === event.frameIndex)?.id ??
            `live-frame-${event.frameIndex}`,
          runId: id,
          frameIndex: event.frameIndex,
          lookIndex: event.lookIndex,
          type: event.type.replace("look.", "") as Look["type"],
          screenshotUrl:
            "screenshotUrl" in event && event.screenshotUrl
              ? await artifactUrl(event.screenshotUrl)
              : undefined,
          x: "x" in event ? event.x : undefined,
          y: "y" in event ? event.y : undefined,
          width: "width" in event ? event.width : undefined,
          height: "height" in event ? event.height : undefined,
          commentaryText: "text" in event ? event.text : undefined,
          createdAt: event.timestamp,
        };
        setLooks((prev) => {
          const withoutDup = prev.filter(
            (l) => !(l.frameIndex === event.frameIndex && l.lookIndex === event.lookIndex)
          );
          return [...withoutDup, look].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
      }

      if (event.type === "action") {
        const text = formatCaption(event.action);
        if (text) pushCaption(text);
      }

      if (event.type === "thought") {
        const thought: Thought = {
          id: `live-thought-${event.stepIndex}-${event.timestamp}`,
          runId: id,
          stepIndex: event.stepIndex ?? 0,
          text: event.text,
          createdAt: event.timestamp,
        };
        setThoughts((prev) => {
          const withoutDup = prev.filter((t) => t.stepIndex !== thought.stepIndex);
          return [...withoutDup, thought].sort((a, b) => a.stepIndex - b.stepIndex);
        });
        pushCaption(formatThoughtCaption(event.text));
      }

      if (event.type === "run.completed") {
        setRun((prev) => (prev ? { ...prev, status: "completed" } : prev));
        pushCaption("Run finished");
      }

      if (event.type === "run.failed") {
        setRun((prev) =>
          prev ? { ...prev, status: "failed", error: event.error } : prev
        );
        pushCaption(`Run failed: ${event.error.slice(0, 80)}`);
      }
    },
  });

  const activeFrame = frames[activeFrameIndex] ?? frames[frames.length - 1];
  const frameLooks = useMemo(
    () => looks.filter((l) => l.frameIndex === activeFrame?.frameIndex),
    [looks, activeFrame]
  );

  const frameCaption = useMemo(() => {
    if (!activeFrame) return null;
    const latestLook = frameLooks[frameLooks.length - 1];
    if (latestLook?.action) {
      try {
        const action = JSON.parse(latestLook.action);
        const cap = formatCaption(action);
        if (cap) return cap;
      } catch {
        // ignore malformed action JSON
      }
    }
    if (latestLook?.commentaryText) return latestLook.commentaryText;
    const frameThoughts = thoughts.filter((t) => t.stepIndex === activeFrame.frameIndex);
    const latestThought = frameThoughts[frameThoughts.length - 1];
    if (latestThought) return formatThoughtCaption(latestThought.text);
    return null;
  }, [activeFrame, frameLooks, thoughts]);

  const anchoredComments = useMemo(
    () => frameLooks.filter((l) => l.type === "commentary" && l.x !== undefined && l.y !== undefined),
    [frameLooks]
  );

  const floatingComments = useMemo(
    () => frameLooks.filter((l) => l.type === "commentary" && (l.x === undefined || l.y === undefined)),
    [frameLooks]
  );

  const clickLooks = useMemo(
    () => frameLooks.filter((l) => l.type === "click"),
    [frameLooks]
  );

  function handleImageLoad() {
    const img = imageRef.current;
    if (!img) return;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  }

  function pct(value: number, dimension: "width" | "height"): string {
    if (!imageSize) return "0%";
    return `${(value / imageSize[dimension]) * 100}%`;
  }

  if (!run) return <p>Loading...</p>;

  const isRunning = run.status === "running";

  return (
    <div className="run-detail">
      <div className="run-detail-topbar">
        <Link to="/runs" className="back-link">
          ← Back
        </Link>
        <div className={`run-status-pill ${isRunning ? "running" : "ended"}`}>
          {isRunning ? "Running" : "End"}
        </div>
      </div>

      <div
        className={`collapsible-header ${headerCollapsed ? "collapsed" : ""}`}
        onClick={() => setHeaderCollapsed((c) => !c)}
      >
        <div className="collapsible-summary">
          <strong>{run.url}</strong>
          <span>{headerCollapsed ? "▸ Details" : "▾ Details"}</span>
        </div>
        {!headerCollapsed && (
          <div className="collapsible-body">
            {run.goal && (
              <p>
                <strong>Task:</strong> {run.goal}
              </p>
            )}
            {run.evaluationSummary && (
              <div className="card">
                <strong>Summary:</strong>
                <p>{run.evaluationSummary}</p>
              </div>
            )}
            <div className="meta">
              <span className={`badge ${run.status}`}>{run.status}</span>
              {run.browser && <span className="badge">{run.browser}</span>}
              {run.viewport && (
                <span className="badge">
                  {run.viewport.width}×{run.viewport.height}
                </span>
              )}
              {run.maxDurationSeconds !== undefined && (
                <span className="badge">{run.maxDurationSeconds}s limit</span>
              )}
              <span>Created {new Date(run.createdAt).toLocaleString()}</span>
              {run.completedAt && (
                <span>Completed {new Date(run.completedAt).toLocaleString()}</span>
              )}
              {run.tokenCount !== undefined && <span>{run.tokenCount} tokens</span>}
              {run.cachedTokens !== undefined && run.cachedTokens > 0 && (
                <span>{run.cachedTokens} cached</span>
              )}
              {run.llmCallCount !== undefined && <span>{run.llmCallCount} LLM calls</span>}
            </div>
            {run.error && <p className="error">{run.error}</p>}
          </div>
        )}
      </div>

      <div className="frame-viewer">
        {activeFrame ? (
          <>
            <div className="frame-image-wrap">
              <img
                ref={imageRef}
                src={activeFrame.screenshotUrl}
                alt={`Frame ${activeFrame.frameIndex}`}
                onLoad={handleImageLoad}
                className="frame-image"
              />

              {imageSize && (
                <div className="frame-overlays">
                  {clickLooks.map((look) =>
                    look.x !== undefined && look.y !== undefined ? (
                      <div
                        key={look.id}
                        className="overlay-click"
                        style={{
                          left: `calc(${pct(look.x, "width")} - 6px)`,
                          top: `calc(${pct(look.y, "height")} - 6px)`,
                        }}
                        title={`Click ${look.lookIndex}`}
                      />
                    ) : null
                  )}

                  {anchoredComments.map((look, idx) =>
                    look.x !== undefined && look.y !== undefined ? (
                      <div
                        key={look.id}
                        className="overlay-comment"
                        style={{
                          left: `calc(${pct(look.x, "width")} + 8px)`,
                          top: `calc(${pct(look.y, "height")} - 8px)`,
                        }}
                      >
                        <button
                          className="comment-bubble"
                          onClick={() =>
                            setActiveCommentId(activeCommentId === look.id ? null : look.id)
                          }
                        >
                          {idx + 1}
                        </button>
                        {activeCommentId === look.id && (
                          <div className="comment-tooltip">{look.commentaryText}</div>
                        )}
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {floatingComments.length > 0 && (
                <div className={`floating-comments ${expandedComments ? "expanded" : ""}`}>
                  <button
                    className="floating-comments-toggle"
                    onClick={() => setExpandedComments((e) => !e)}
                  >
                    <span className="comment-counter">{floatingComments.length}</span>
                    <span className="toggle-label">
                      {expandedComments ? "Hide comments" : "Comments"}
                    </span>
                  </button>
                  {expandedComments && (
                    <div className="floating-comments-list">
                      {floatingComments.map((look, idx) => (
                        <p key={look.id}>
                          <strong>{idx + 1}.</strong> {look.commentaryText}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {captions.length > 0 ? (
              <div className="frame-caption" aria-live="polite">
                {captions.map((c) => (
                  <div key={c.id} className="frame-caption-line">
                    {c.text}
                  </div>
                ))}
              </div>
            ) : frameCaption ? (
              <div className="frame-caption" aria-live="polite">
                {frameCaption}
              </div>
            ) : null}

            <div className="overlay-legend">
              <span className="legend-item">
                <span className="legend-swatch legend-click" />
                Clicked here
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-comment" />
                LLM note
              </span>
            </div>

            <div className="frame-controls">
              <button
                onClick={() => {
                  userInteractedRef.current = true;
                  setActiveFrameIndex((i) => Math.max(0, i - 1));
                }}
                disabled={activeFrameIndex === 0}
              >
                ← Previous
              </button>
              <span>
                Frame {activeFrame.frameIndex + 1} of {frames.length}
              </span>
              <button
                onClick={() => {
                  userInteractedRef.current = true;
                  setActiveFrameIndex((i) => Math.min(frames.length - 1, i + 1));
                }}
                disabled={activeFrameIndex === frames.length - 1}
              >
                Next →
              </button>
            </div>

            <div className="frame-thumbnails">
              {frames.map((frame, idx) => (
                <button
                  key={frame.id}
                  className={`frame-thumb ${idx === activeFrameIndex ? "active" : ""}`}
                  onClick={() => {
                    userInteractedRef.current = true;
                    setActiveFrameIndex(idx);
                  }}
                  aria-label={`Go to frame ${idx + 1}`}
                  aria-current={idx === activeFrameIndex ? "true" : undefined}
                >
                  {frame.screenshotUrl ? (
                    <img src={frame.screenshotUrl} alt={`Frame ${idx + 1}`} loading="lazy" />
                  ) : (
                    <div className="frame-thumb-placeholder">{idx + 1}</div>
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p>Waiting for frames...</p>
        )}
      </div>

      <h2>Reasoning ({thoughts.length})</h2>
      {thoughts.length === 0 ? (
        <p>No reasoning captured yet.</p>
      ) : (
        <ol className="thought-list">
          {thoughts.map((t) => (
            <li key={t.id} className="thought">
              <span className="thought-step">Step {t.stepIndex + 1}</span>
              <p>{t.text}</p>
            </li>
          ))}
        </ol>
      )}

      <h2>Findings ({findings.length})</h2>
      {findings.length === 0 ? (
        <p>No findings yet.</p>
      ) : (
        <div className="finding-list">
          {findings.map((f) => (
            <div key={f.id} className={`finding severity-${f.severity}`}>
              <div className="finding-header">
                <h3>{f.title}</h3>
                <span className="score">
                  {f.score}/{f.maxScore}
                </span>
              </div>
              <p>{f.description}</p>
              <div className="meta">
                <span className={`badge ${f.category}`}>{f.category}</span>
                <span className={`badge severity-${f.severity}`}>{f.severity}</span>
              </div>
              {f.evidence.length > 0 && (
                <div className="evidence">
                  <h4>Evidence</h4>
                  {f.evidence.map((e, idx) => (
                    <div key={idx} className="evidence-item">
                      {e.type === "screenshot" && e.url && (
                        <img
                          src={e.url}
                          alt={`Evidence ${idx + 1}`}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "200px",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                          }}
                        />
                      )}
                      <p>
                        <strong>{e.type}:</strong> {e.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2>Debug Log ({debugLog.length})</h2>
      {debugLog.length === 0 ? (
        <p>No debug log entries yet.</p>
      ) : (
        <div className="debug-log">
          <div className="debug-log-toolbar">
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(
                  debugLog.map((e) => `[${e.type}] ${e.content}`).join("\n\n---\n\n")
                )
              }
            >
              Copy debug log
            </button>
            <button
              type="button"
              className="debug-log-toggle"
              onClick={() => setDebugExpanded((e) => !e)}
            >
              {debugExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <div className={`debug-log-console ${debugExpanded ? "expanded" : ""}`}>
            {debugLog.map((entry) => (
              <div key={entry.id} className={`debug-log-entry type-${entry.type}`}>
                <span className="debug-log-meta">
                  {entry.type}
                  {entry.stepIndex !== undefined && entry.stepIndex >= 0
                    ? ` · step ${entry.stepIndex + 1}`
                    : ""}
                </span>
                <pre>{entry.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
