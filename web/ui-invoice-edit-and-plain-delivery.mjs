/**
 * Visual check for the two office requests of 2026-09-07:
 *   1. correcting an invoice after it was issued
 *   2. approving a project with no letterhead at all
 *
 *   BASE=http://localhost:3000 TOKEN=… node ui-invoice-edit-and-plain-delivery.mjs
 */
import { chromium } from "playwright-core";
import { globSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const EXECUTABLE =
  process.env.CHROME ??
  globSync(`${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`).pop();
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "invoice-edit-shots";
const TOKEN = process.env.TOKEN;
const PROJECT_ID = process.env.PROJECT_ID;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const problems = [];

async function ctx(theme) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
  await c.addInitScript(([t, s]) => {
    localStorage.setItem("bahr_token", t);
    localStorage.setItem("theme", s);
  }, [TOKEN, theme]);
  return c;
}

function watch(page, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && errors.push(m.text()));
  return () => {
    if (errors.length) problems.push(`${label}: ${errors[0].slice(0, 100)}`);
    return errors.length === 0;
  };
}

// ---- 1. Invoice edit ----------------------------------------------------
for (const theme of ["light", "dark"]) {
  const c = await ctx(theme);
  const page = await c.newPage();
  const clean = watch(page, `invoices-${theme}`);
  await page.goto(`${BASE}/invoices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/invoices-list-${theme}.png`, fullPage: true });

  await page.getByTitle("تعديل الفاتورة").first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/invoice-edit-${theme}.png`, fullPage: true });

  const title = await page.getByText(/تعديل الفاتورة INV-/).count();
  const clientLocked = await page.locator("#inv-client[data-disabled], #inv-client[disabled]").count();
  const checked = await page.locator('input[type="checkbox"]:checked').count();
  console.log(`edit dialog (${theme})  title=${title ? "ok" : "MISSING"}  client locked=${clientLocked ? "ok" : "NOT LOCKED"}  pre-checked rows=${checked}`);
  if (!title) problems.push(`${theme}: edit dialog title missing`);
  if (!clientLocked) problems.push(`${theme}: client picker not locked on edit`);
  if (!checked) problems.push(`${theme}: invoice's own projects not pre-checked`);
  clean();
  await c.close();
}

// ---- 2. Save an actual correction ---------------------------------------
{
  const c = await ctx("light");
  const page = await c.newPage();
  const clean = watch(page, "invoice-save");
  await page.goto(`${BASE}/invoices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByTitle("تعديل الفاتورة").first().click();
  await page.waitForTimeout(2500);

  const before = await page.locator('input[type="checkbox"]:checked').count();
  // Add one more project and change the rate.
  await page.locator('input[type="checkbox"]:not(:checked)').first().click();
  await page.locator("#inv-unit").fill("175");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/invoice-edit-modified.png`, fullPage: true });
  await page.getByRole("button", { name: "حفظ التعديلات" }).click();
  await page.waitForTimeout(3500);
  const toast = await page.getByText(/حُدّثت الفاتورة/).count();
  console.log(`save correction        rows ${before} -> ${before + 1}, toast=${toast ? "ok" : "MISSING"}`);
  if (!toast) problems.push("no success toast after saving the correction");
  await page.screenshot({ path: `${OUT}/invoice-after-save.png`, fullPage: true });
  clean();
  await c.close();
}

// ---- 3. Approve with no letterhead --------------------------------------
if (PROJECT_ID) {
  const c = await ctx("light");
  const page = await c.newPage();
  const clean = watch(page, "approve");
  await page.goto(`${BASE}/projects/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const approve = page.getByRole("button", { name: /اعتماد/ }).first();
  if (await approve.count()) {
    await approve.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/approve-dialog-fresh.png`, fullPage: true });

    const submit = page.getByRole("button", { name: "اعتماد وإنهاء" });
    const disabledBefore = await submit.isDisabled();
    await page.getByRole("button", { name: "بدون ترويسة" }).click();
    await page.waitForTimeout(500);
    const disabledAfter = await submit.isDisabled();
    await page.screenshot({ path: `${OUT}/approve-no-letterhead.png`, fullPage: true });
    console.log(`approve dialog         submit disabled before=${disabledBefore} after «بدون ترويسة»=${disabledAfter}`);
    if (!disabledBefore) problems.push("approve was submittable with nothing chosen");
    if (disabledAfter) problems.push("«بدون ترويسة» did not enable approval");
    const hint = await page.getByText(/بدون ترويسة وبدون ختم/).count();
    console.log(`plain-delivery hint    ${hint ? "ok" : "MISSING"}`);
  } else {
    console.log("approve dialog         no approve button on this project — skipped");
  }
  clean();
  await c.close();
}

await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n- ${problems.join("\n- ")}` : "\nAll checks clean.");
