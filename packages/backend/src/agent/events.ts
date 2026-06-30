import { EventEmitter } from "events";

export interface ScreenshotEvent {
  type: "screenshot";
  screenshotType: "step" | "timeline";
  stepIndex?: number;
  url: string;
  timestamp: string;
}

export interface ActionEvent {
  type: "action";
  stepIndex: number;
  action: {
    type: string;
    reasoning?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

export interface ThoughtEvent {
  type: "thought";
  stepIndex?: number;
  text: string;
  timestamp: string;
}

export interface FrameNewEvent {
  type: "frame.new";
  frameIndex: number;
  url: string;
  title?: string;
  timestamp: string;
}

export interface LookZoomEvent {
  type: "look.zoom";
  frameIndex: number;
  lookIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  screenshotUrl: string;
  timestamp: string;
}

export interface LookPanEvent {
  type: "look.pan";
  frameIndex: number;
  lookIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  screenshotUrl: string;
  timestamp: string;
}

export interface LookZoomOutEvent {
  type: "look.zoom_out";
  frameIndex: number;
  lookIndex: number;
  timestamp: string;
}

export interface LookClickEvent {
  type: "look.click";
  frameIndex: number;
  lookIndex: number;
  x?: number;
  y?: number;
  timestamp: string;
}

export interface LookCommentEvent {
  type: "look.comment";
  frameIndex: number;
  lookIndex: number;
  text: string;
  x?: number;
  y?: number;
  timestamp: string;
}

export interface RubricStartEvent {
  type: "rubric.start";
  rubricId: string;
  rubricName: string;
  timestamp: string;
}

export interface RubricScoreEvent {
  type: "rubric.score";
  rubricId: string;
  rubricName: string;
  category: string;
  score: number;
  maxScore: number;
  severity: string;
  title: string;
  description: string;
  timestamp: string;
}

export interface RunStartedEvent {
  type: "run.started";
  runId: string;
  timestamp: string;
}

export interface RunCompletedEvent {
  type: "run.completed";
  runId: string;
  finalStatus: string;
  summary: string;
  timestamp: string;
}

export interface RunFailedEvent {
  type: "run.failed";
  runId: string;
  error: string;
  timestamp: string;
}

export interface ConnectedEvent {
  type: "connected";
  runId: string;
  timestamp: string;
}

export type RunEvent =
  | ScreenshotEvent
  | ActionEvent
  | ThoughtEvent
  | FrameNewEvent
  | LookZoomEvent
  | LookPanEvent
  | LookZoomOutEvent
  | LookClickEvent
  | LookCommentEvent
  | RubricStartEvent
  | RubricScoreEvent
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | ConnectedEvent;

const emitters = new Map<string, EventEmitter>();

export function getRunEmitter(runId: string): EventEmitter {
  if (!emitters.has(runId)) {
    emitters.set(runId, new EventEmitter());
  }
  return emitters.get(runId)!;
}

export function emitRunEvent(runId: string, event: RunEvent): void {
  const emitter = getRunEmitter(runId);
  emitter.emit("event", event);
}

export function removeRunEmitter(runId: string): void {
  const emitter = emitters.get(runId);
  if (emitter) {
    emitter.removeAllListeners();
    emitters.delete(runId);
  }
}
