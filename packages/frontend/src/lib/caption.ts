export interface ActionLike {
  type: string;
  [key: string]: unknown;
}

export function formatActionCaption(action: ActionLike): string | null {
  switch (action.type) {
    case "click_text": {
      const text = typeof action.text === "string" ? action.text : "";
      return text ? `Clicking “${text}”` : "Clicking";
    }
    case "click_at": {
      const x = typeof action.x === "number" ? action.x : 0;
      const y = typeof action.y === "number" ? action.y : 0;
      return `Clicking at (${x}, ${y})`;
    }
    case "type": {
      const selector = typeof action.selector === "string" ? action.selector : "";
      return selector ? `Typing into “${selector}”` : "Typing";
    }
    case "navigate": {
      const url = typeof action.url === "string" ? action.url : "";
      return url ? `Navigating to ${url}` : "Navigating";
    }
    case "wait":
      return "Waiting for page to settle";
    case "scroll": {
      const deltaY = typeof action.deltaY === "number" ? action.deltaY : 0;
      if (deltaY > 0) return "Scrolling down";
      if (deltaY < 0) return "Scrolling up";
      return "Scrolling";
    }
    case "commentary": {
      const text = typeof action.text === "string" ? action.text : "";
      return text || null;
    }
    case "terminate":
      return "Finishing up";
    default:
      return null;
  }
}

export function formatThoughtCaption(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 140) return trimmed;
  return trimmed.slice(0, 140) + "…";
}

export function formatCaption(action: ActionLike | null, thought?: string): string | null {
  if (action) {
    const actionCaption = formatActionCaption(action);
    if (actionCaption) return actionCaption;
  }
  if (thought) {
    return formatThoughtCaption(thought);
  }
  return null;
}
