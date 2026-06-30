import { chromium, firefox, webkit, Browser, BrowserContext, Page, BrowserType } from "playwright";
import type { Viewport } from "../db/models.js";

export type SupportedBrowser = "chromium" | "firefox" | "webkit";

const BROWSERS: Record<SupportedBrowser, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

export interface PlaywrightStatus {
  available: boolean;
  browser?: string;
  version?: string;
  error?: string;
}

export async function checkPlaywrightAvailability(browserType: SupportedBrowser = "chromium"): Promise<PlaywrightStatus> {
  try {
    const browser = await BROWSERS[browserType].launch({ headless: true });
    const version = browser.version();
    await browser.close();
    return { available: true, browser: browserType, version };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createBrowserContext(
  browserType: SupportedBrowser = "chromium",
  viewport: Viewport = { width: 1280, height: 800 }
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await BROWSERS[browserType].launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  return { browser, context, page };
}
