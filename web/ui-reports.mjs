/** Screenshot reports page + live export flow (Excel export → realtime "جاهز"). */
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
const token = await login("pm@bahr.local");

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

try {
  await page.goto("http://localhost:3000/reports", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "rt-shots/reports-translators.png" });

  // Switch to monthly tab
  await page.getByRole("button", { name: "التقرير الشهري" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "rt-shots/reports-monthly.png" });

  // Trigger an Excel export and wait for the realtime "جاهز" badge (queue + bell)
  await page.getByRole("button", { name: "تصدير Excel" }).click();
  await page.getByText("جاهز", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "rt-shots/reports-export-done.png" });

  console.log("PASS export flow reached جاهز via realtime");
} catch (err) {
  console.error("FAIL:", err.message);
  await page.screenshot({ path: "rt-shots/reports-fail.png" });
  process.exitCode = 1;
} finally {
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
  await browser.close();
}
