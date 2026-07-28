/** Screenshot the Sprint 4 dashboard: PM light + dark + tooltip hover, translator home. */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const API = "http://localhost:8000/api/v1";
mkdirSync("rt-shots", { recursive: true });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });

async function shoot(email, path, { dark = false, hover = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[${path}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${path}] ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), await login(email));
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  if (hover) {
    const bars = page.locator("button[aria-label]");
    const count = await bars.count();
    if (count > 3) await bars.nth(20).hover();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `rt-shots/${path}`, fullPage: true });
  await context.close();
}

try {
  await shoot("pm@bahr.local", "dash-light.png");
  await shoot("pm@bahr.local", "dash-dark.png", { dark: true });
  await shoot("pm@bahr.local", "dash-hover.png", { hover: true });
  await shoot("translator1@bahr.local", "dash-translator.png");
  console.log("done");
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
