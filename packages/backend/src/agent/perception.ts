import { Page } from "playwright";
import fs from "fs";
import path from "path";
import { config } from "../config.js";

export interface PerceptionResult {
  screenshotPath: string;
  domSnapshotPath: string;
  screenshotBase64: string; // data:image/jpeg;base64,... for LLM
  domSnapshot: string;
  url: string;
  title: string;
}

export interface CaptureOptions {
  runId: string;
  stepIndex: number;
}

export interface FrameCaptureOptions {
  runId: string;
  frameIndex: number;
}

export interface ClipCaptureOptions {
  runId: string;
  frameIndex: number;
  lookIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function ensureArtifactsDir(runId: string): string {
  const dir = path.join(config.userDataDir, "artifacts", runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface SemanticNode {
  tag?: string;
  role?: string;
  name?: string;
  type?: string;
  href?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: SemanticNode[];
}

export async function buildSemanticSnapshot(page: Page): Promise<SemanticNode> {
  // We pass the browser-side code as a string to avoid tsx/esbuild injecting
  // helper functions (like __name) that do not exist in the page context.
  const snapshotScript = `
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      return true;
    };

    const isInViewport = (el) => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return (
        rect.top < vh &&
        rect.bottom > 0 &&
        rect.left < vw &&
        rect.right > 0
      );
    };

    const getName = (el) => {
      return (el.getAttribute("aria-label") || "").trim() ||
        (el.getAttribute("title") || "").trim() ||
        (el.textContent || "").trim();
    };

    const describeElement = (el) => {
      if (!isVisible(el) || !isInViewport(el)) return null;
      const tag = el.tagName.toLowerCase();
      const text = getName(el);
      const role = el.getAttribute("role") || undefined;
      const rect = el.getBoundingClientRect();
      const box = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      if (tag === "a") {
        return { tag, role: role || "link", name: text.slice(0, 120), href: el.href, ...box };
      }
      if (tag === "button") {
        return { tag, role: role || "button", name: text.slice(0, 120), ...box };
      }
      // Divs/spans/etc. that explicitly behave like buttons or links.
      if (role === "button" || role === "link" || role === "tab" || role === "menuitem") {
        return { tag, role, name: text.slice(0, 120), ...box };
      }
      // Elements with an explicit click handler but no semantic role.
      if (el.onclick || el.getAttribute("onclick")) {
        return { tag, role: "button", name: text.slice(0, 120), ...box };
      }
      if (tag === "input" || tag === "textarea" || tag === "select") {
        const input = el;
        const labelText = input.labels && input.labels.length > 0 ? input.labels[0].textContent.trim() : undefined;
        return {
          tag,
          role: role || (tag === "select" ? "combobox" : "textbox"),
          name: labelText || input.placeholder || input.name || text.slice(0, 120),
          type: input.type,
          ...box,
        };
      }
      if (/^h[1-6]$/.test(tag)) {
        return { tag, role: "heading", name: text.slice(0, 200), ...box };
      }
      if (["main", "nav", "header", "footer", "aside", "section", "article"].includes(tag)) {
        return { tag, role: role || tag, name: text.slice(0, 120), ...box };
      }
      return null;
    };

    const walk = (root) => {
      const nodes = [];
      Array.from(root.children).forEach((child) => {
        const described = describeElement(child);
        if (described) {
          const children = walk(child);
          if (children.length > 0) {
            described.children = children;
          }
          nodes.push(described);
        } else {
          nodes.push(...walk(child));
        }
      });
      return nodes;
    };

    return {
      tag: "document",
      role: "document",
      name: document.title,
      children: walk(document.body),
    };
  `;

  return page.evaluate((code) => {
    const fn = new Function(code);
    return fn();
  }, snapshotScript);
}

export async function capturePerception(page: Page, options: CaptureOptions): Promise<PerceptionResult> {
  const dir = ensureArtifactsDir(options.runId);
  const prefix = `step-${options.stepIndex.toString().padStart(3, "0")}`;

  const screenshotPath = path.join(dir, `${prefix}-screenshot.jpg`);
  const domSnapshotPath = path.join(dir, `${prefix}-dom.json`);

  // Capture JPEG screenshot at reduced quality to keep token cost down.
  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 60,
    fullPage: false,
  });
  fs.writeFileSync(screenshotPath, screenshotBuffer);

  // Capture semantic DOM snapshot.
  const semanticTree = await buildSemanticSnapshot(page);
  const domSnapshot = JSON.stringify(semanticTree, null, 2);
  fs.writeFileSync(domSnapshotPath, domSnapshot);

  const screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;

  return {
    screenshotPath,
    domSnapshotPath,
    screenshotBase64,
    domSnapshot,
    url: page.url(),
    title: await page.title(),
  };
}

export interface TimelineCaptureOptions {
  runId: string;
  index: number;
}

export async function captureTimelineScreenshot(page: Page, options: TimelineCaptureOptions): Promise<string> {
  const dir = ensureArtifactsDir(options.runId);
  const prefix = `timeline-${options.index.toString().padStart(4, "0")}`;
  const screenshotPath = path.join(dir, `${prefix}-screenshot.jpg`);

  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 60,
    fullPage: false,
  });
  fs.writeFileSync(screenshotPath, screenshotBuffer);
  return screenshotPath;
}

export interface FrameCaptureResult {
  screenshotPath: string;
  screenshotBase64: string;
}

export async function captureFrame(page: Page, options: FrameCaptureOptions): Promise<FrameCaptureResult> {
  const dir = ensureArtifactsDir(options.runId);
  const prefix = `frame-${options.frameIndex.toString().padStart(3, "0")}`;
  const screenshotPath = path.join(dir, `${prefix}-screenshot.jpg`);

  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 70,
    fullPage: false,
  });
  fs.writeFileSync(screenshotPath, screenshotBuffer);

  return {
    screenshotPath,
    screenshotBase64: `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`,
  };
}

export interface ClipCaptureResult {
  screenshotPath: string;
  screenshotBase64: string;
}

export async function captureFrameBase64(page: Page): Promise<string> {
  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 70,
    fullPage: false,
  });
  return `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;
}

export async function captureClippedBase64(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<string> {
  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 80,
    fullPage: false,
    clip,
  });
  return `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;
}

export async function captureClippedScreenshot(page: Page, options: ClipCaptureOptions): Promise<ClipCaptureResult> {
  const dir = ensureArtifactsDir(options.runId);
  const prefix = `frame-${options.frameIndex.toString().padStart(3, "0")}-look-${options.lookIndex.toString().padStart(3, "0")}`;
  const screenshotPath = path.join(dir, `${prefix}-clip.jpg`);

  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 80,
    fullPage: false,
    clip: {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    },
  });
  fs.writeFileSync(screenshotPath, screenshotBuffer);

  return {
    screenshotPath,
    screenshotBase64: `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`,
  };
}
