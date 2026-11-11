import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Native local-app investigation: DOM, network failures, console errors, and screenshots. */
export async function inspectBrowser(workspace: string, url: string) {
  const target = new URL(url); if (!['127.0.0.1','localhost','[::1]'].includes(target.hostname) || !['http:','https:'].includes(target.protocol)) throw new Error('Browser investigation is scoped to local development servers');
  const { chromium } = await import('@playwright/test');
  const root = join(workspace, '.tmp', 'browser'); await mkdir(root, { recursive: true });
  const context = await chromium.launchPersistentContext(join(root,'profile'), { headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors: string[] = []; const network: { url: string; status: number }[] = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('response', r => { if (r.status() >= 400) network.push({ url: r.url(), status: r.status() }); });
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); const screenshot = join(root,'inspection.png'); await page.screenshot({ path: screenshot, fullPage: false, timeout: 30000 }); return { title: await page.title(), text: (await page.locator('body').innerText()).slice(0,12000), errors, network, screenshot }; }
  finally { await context.close(); }
}
