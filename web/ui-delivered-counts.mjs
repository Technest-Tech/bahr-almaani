/**
 * Screenshot the delivered-counts surfaces (client request 2026-09-05):
 * project tiles (pages first, delivered over source), the projects list's
 * صفحات / كلمات column, and the reports that now state translated figures.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const API = "http://localhost:8000/api/v1";
const OUT = process.env.OUT ?? "rt-shots";
mkdirSync(OUT, { recursive: true });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const token = await login("pm@bahr.local");

// A project that actually has delivered totals, so the tiles show both bases.
const projects = (await (await fetch(`${API}/projects?per_page=50`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
})).json()).data;
const withDelivered = projects.find((p) => p.delivered_pages !== null) ?? projects[0];
console.log("project:", withDelivered.code, {
  delivered_pages: withDelivered.delivered_pages,
  delivered_words: withDelivered.delivered_words,
  total_pages: withDelivered.total_pages,
  total_words: withDelivered.total_words,
});

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

  await page.goto(`http://localhost:3000/projects/${withDelivered.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/project-${theme}.png` });

  if (theme === "light") {
    await page.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/projects-list-${theme}.png` });

    await page.goto("http://localhost:3000/reports", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    // Dev deliveries are July/August; widen the range so rows actually render.
    await page.locator('input[type="date"]').first().fill("2026-07-01");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/reports-translators-${theme}.png` });

    await page.getByRole("button", { name: "مديرو المشاريع" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/reports-pms-${theme}.png` });

    await page.getByRole("button", { name: "التقرير الشهري" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/reports-monthly-${theme}.png` });
  }

  await context.close();
}

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
