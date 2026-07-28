/** Screenshot projects list: typo'd Meilisearch query + server-side sort click. */
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
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), await login("pm@bahr.local"));

try {
  await page.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Typo'd Arabic search (ة→ه) — Meilisearch should still match
  await page.getByPlaceholder("بحث بالعنوان أو الكود…").fill("شهاده");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "rt-shots/search-typo.png" });

  // Clear, then server-side sort by deadline
  await page.getByPlaceholder("بحث بالعنوان أو الكود…").fill("");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "موعد التسليم" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "rt-shots/sort-server.png" });

  console.log("done");
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
