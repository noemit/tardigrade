import { useEffect, useRef } from "react";

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

export interface UseRunEventsOptions {
  onEvent?: (event: RunEvent) => void;
  onConnected?: () => void;
  onError?: (error: Event) => void;
}

export function useRunEvents(runId: string | undefined, options: UseRunEventsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!runId) return;

    let eventSource: EventSource | null = null;

    async function connect() {
      let base: string;
      if (window.electronAPI) {
        base = await window.electronAPI.getBackendUrl();
      } else {
        base = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
      }
      eventSource = new EventSource(`${base}/runs/${runId}/stream`);

      eventSource.onopen = () => {
        optionsRef.current.onConnected?.();
      };

      eventSource.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as RunEvent;
          optionsRef.current.onEvent?.(event);
        } catch {
          // Ignore malformed events.
        }
      };

      eventSource.onerror = (error) => {
        optionsRef.current.onError?.(error);
      };
    }

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [runId]);
}
