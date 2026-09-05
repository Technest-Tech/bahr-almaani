/**
 * Walk the reworked translator preview flow (2026-09-05 complaints):
 * seal draggable in the PREVIEW dialog, bleed past the page edge allowed,
 * draft rendered inside the dialog, and «متابعة للتسليم» carrying the file +
 * seal position into the deliver dialog.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EXECUTABLE = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const API = "http://localhost:8000/api/v1";
const OUT = process.env.OUT ?? "rt-shots";
const UPLOAD = resolve("../api/storage/app/private/reports/2.pdf");
mkdirSync(OUT, { recursive: true });

const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });

const login = async (email) =>
  (await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password: "password" }),
  })).json()).token;

const token = await login("translator1@bahr.local");

// The current-file card only exists while holding a file — claim one if needed.
const current = await (await fetch(`${API}/portal/current`, { headers: headers(token) })).json();
if (!current.data) {
  const queue = await (await fetch(`${API}/portal/queue`, { headers: headers(token) })).json();
  const target = queue.data[0];
  if (!target) throw new Error("no available project to claim");
  await fetch(`${API}/portal/claim/${target.id}`, { method: "POST", headers: headers(token) });
  console.log("claimed:", target.code);
}

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

await page.goto("http://localhost:3000/portal", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// 1 — open the preview dialog, feed it the file and templates.
await page.getByRole("button", { name: "معاينة بالترويسة والختم" }).click();
await page.waitForTimeout(800);
await page.locator('[role="dialog"] input[type="file"]').setInputFiles(UPLOAD);
await page.getByText("ترويسة بحر المعاني الرسمية").first().click();
await page.getByText("ختم وتوقيع المترجم المعتمد").first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/preview-dialog.png` });

// 2 — the positioner, from INSIDE the preview dialog.
await page.getByRole("button", { name: "ضبط موضع الختم" }).click();
const seal = page.locator('[role="application"]');
await seal.waitFor({ timeout: 45000 });
await page.waitForTimeout(500);

// Drag the seal left past the old clamp — its box may now bleed off the sheet.
const surface = await page.locator('img[alt^="صفحة"]').boundingBox();
const box = await seal.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(surface.x - 40, box.y + box.height / 2 - 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);

const caption = await page.getByText("مم من اليسار").textContent();
console.log("caption:", caption?.trim());
await page.screenshot({ path: `${OUT}/seal-bleed.png` });

await page.getByRole("button", { name: "تثبيت الموضع" }).click();
await page.waitForTimeout(400);

// 3 — the draft renders inside the dialog, no new tab.
await page.getByRole("button", { name: "عرض المسودة" }).click();
await page.locator('iframe[title="مسودة المعاينة"]').waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/draft-inline.png` });

// 4 — the bridge: same file + position land in the deliver dialog.
await page.getByRole("button", { name: "متابعة للتسليم" }).click();
await page.getByText("تسليم الترجمة").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const custom = await page.getByText("موضع مخصّص").count();
console.log("deliver dialog shows custom position:", custom > 0);
await page.screenshot({ path: `${OUT}/deliver-bridged.png` });

// Leave without delivering — dev data stays where it was.
await page.getByRole("button", { name: "إلغاء" }).click();

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
