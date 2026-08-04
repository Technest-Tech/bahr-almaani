/**
 * Visual check for the open portal queue (every file to every translator).
 *
 * Drives the real portal as a translator: the unfiltered queue, a priority
 * filter, and the "أزواج لغاتي" toggle — light, dark and mobile.
 *
 *   BASE=https://bahralmaani.com TOKEN=… SHOTS=./shots node ui-portal-open.mjs
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const BASE = process.env.BASE ?? "https://bahralmaani.com";
const OUT = process.env.SHOTS ?? "portal-shots";
const TOKEN = process.env.TOKEN;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXECUTABLE });

async function open(label, { width, height, theme, isMobile = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  await ctx.addInitScript(
    ([t, s]) => {
      localStorage.setItem("bahr_token", t);
      localStorage.setItem("theme", s);
    },
    [TOKEN, theme],
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const cards = await page.locator("h3").count();
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: !isMobile });
  console.log(`${label.padEnd(22)} cards=${cards} ${errors.length ? "ERRORS: " + errors[0].slice(0, 70) : "no console errors"}`);
  return { ctx, page };
}

const { ctx: c1, page } = await open("portal-light", { width: 1440, height: 1000, theme: "light" });

// Filter to urgent only, then back — the counts should move.
const beforeFilter = await page.locator("h3").count();
await page.getByText("كل الأولويات").click();
await page.waitForTimeout(400);
await page.getByRole("option", { name: "عاجل" }).click();
await page.waitForTimeout(1800);
const afterFilter = await page.locator("h3").count();
await page.screenshot({ path: `${OUT}/portal-filtered-urgent.png`, fullPage: true });
console.log(`filter urgent           ${beforeFilter} -> ${afterFilter} cards`);

// "أزواج لغاتي" narrows back to registered pairs.
await page.getByRole("button", { name: /أزواج لغاتي/ }).click();
await page.waitForTimeout(1800);
const afterMine = await page.locator("h3").count();
await page.screenshot({ path: `${OUT}/portal-my-pairs.png`, fullPage: true });
console.log(`my-pairs toggle         ${afterFilter} -> ${afterMine} cards`);
await c1.close();

const { ctx: c2 } = await open("portal-dark", { width: 1440, height: 1000, theme: "dark" });
await c2.close();
const { ctx: c3 } = await open("portal-mobile", { width: 390, height: 844, theme: "light", isMobile: true });
await c3.close();

await browser.close();
