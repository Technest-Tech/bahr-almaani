/** Screenshot the activity-log page: list, diff dialog, dark mode. */
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
const token = await login("admin@bahr.local");

async function open(dark) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
  await page.goto("http://localhost:3000/activity", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { context, page };
}

try {
  const { context, page } = await open(false);
  await page.screenshot({ path: "rt-shots/activity-light.png" });

  // open the diff dialog on the first "updated" row if any, else first row
  const rows = page.locator("tbody tr");
  await rows.first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "rt-shots/activity-dialog.png" });
  await context.close();

  const { context: c2, page: p2 } = await open(true);
  await p2.screenshot({ path: "rt-shots/activity-dark.png" });
  await c2.close();

  console.log("done");
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
