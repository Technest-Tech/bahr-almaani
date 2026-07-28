/**
 * Realtime wow-demo: two translators side by side on /portal.
 *  1. PM publishes a project → the card APPEARS live on both screens.
 *  2. translator1 claims it   → the card VANISHES from translator2's screen.
 * No reloads, no polling — pure Reverb websockets. Screenshots in rt-shots/.
 *
 * Usage: node rt-demo.mjs <project_id> <pm_token>
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const API = "http://localhost:8000/api/v1";
const APP = "http://localhost:3000";
const TITLE = "ترجمة شهادة ميلاد — بث مباشر";
const [projectId, pmToken] = process.argv.slice(2);

mkdirSync("rt-shots", { recursive: true });

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return (await res.json()).token;
}

async function openPortal(browser, token, label, errors) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ar",
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${label}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  await page.goto(`${APP}/portal`, { waitUntil: "networkidle" });
  await page.getByText("الملفات المتاحة").waitFor({ timeout: 15000 });
  return page;
}

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });

try {
  const [t1Token, t2Token] = await Promise.all([
    login("translator1@bahr.local"),
    login("translator2@bahr.local"),
  ]);
  const page1 = await openPortal(browser, t1Token, "t1", errors);
  const page2 = await openPortal(browser, t2Token, "t2", errors);
  await page1.waitForTimeout(2500); // let websockets settle
  await page1.screenshot({ path: "rt-shots/01-t1-before.png" });
  await page2.screenshot({ path: "rt-shots/01-t2-before.png" });

  // ── Act 1: PM publishes → card appears live on BOTH screens ──────────
  const publishedAt = Date.now();
  const pub = await fetch(`${API}/projects/${projectId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pmToken}`, Accept: "application/json" },
  });
  if (!pub.ok) throw new Error(`publish failed: ${pub.status} ${await pub.text()}`);

  await Promise.all([
    page1.getByText(TITLE).first().waitFor({ timeout: 8000 }),
    page2.getByText(TITLE).first().waitFor({ timeout: 8000 }),
  ]);
  const appearMs = Date.now() - publishedAt;
  await page1.waitForTimeout(1200); // let the queued toast land too
  await page1.screenshot({ path: "rt-shots/02-t1-published.png" });
  await page2.screenshot({ path: "rt-shots/02-t2-published.png" });

  // ── Act 2: t1 claims → card vanishes from t2's screen ────────────────
  const card = page1.locator("div.group").filter({ hasText: TITLE });
  const claimedAt = Date.now();
  await card.getByRole("button", { name: "استلام الملف" }).click();
  await page2
    .locator("div.group")
    .filter({ hasText: TITLE })
    .waitFor({ state: "detached", timeout: 8000 });
  const vanishMs = Date.now() - claimedAt;

  await page1.getByText("ملفك الحالي").waitFor({ timeout: 8000 });
  await page1.waitForTimeout(800);
  await page1.screenshot({ path: "rt-shots/03-t1-claimed.png" });
  await page2.screenshot({ path: "rt-shots/03-t2-vanished.png" });

  console.log(`PASS appear=${appearMs}ms (incl. queue hop) vanish=${vanishMs}ms (incl. click+API)`);
} catch (err) {
  console.error("FAIL:", err.message);
  process.exitCode = 1;
} finally {
  if (errors.length) console.error("CONSOLE ERRORS:\n" + errors.join("\n"));
  else console.log("no console errors");
  await browser.close();
}
