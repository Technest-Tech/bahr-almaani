/** Palette: empty nav group must not render; Arabic spelling variants must match nav. */
import { chromium } from "playwright-core";
import { homedir } from "node:os";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1148/chrome-mac/headless_shell`;
const API = "http://localhost:8000/api/v1";
const token = (await (await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ email: "admin@bahr.local", password: "password" }),
})).json()).token;

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

async function probe(text, shot) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(500);
  await page.keyboard.type(text, { delay: 50 });
  await page.waitForTimeout(1600);
  const groups = await page.locator("[cmdk-group-heading]").allInnerTexts();
  const items = await page.locator("[cmdk-item]").count();
  console.log(`"${text}" → groups=[${groups.join(", ")}] items=${items}`);
  if (shot) await page.screenshot({ path: `rt-shots/${shot}` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

try {
  await probe("ترجمه عقد", "palette-typo.png"); // ه for ة — no nav match expected
  await probe("ترويسه");                        // ه for ة — should reach الترويسات والأختام
  await probe("التقارير", "palette-nav.png");
  await probe("zzzznothing");
} finally {
  await browser.close();
  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
}
