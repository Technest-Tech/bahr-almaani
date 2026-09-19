/**
 * Visual check for the office request of 2026-09-19: every client reachable from
 * the invoice dialog (searchable, work-to-bill first), "select all" over a client's
 * billable files, and the client file listing every invoice with the files it bills.
 *
 *   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   BASE=http://localhost:3000 SHOTS=/tmp/shots node ui-invoice-select-all.mjs
 *
 * Read-only: it opens the dialog and ticks boxes but never issues an invoice.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { globSync, mkdirSync } from "node:fs";

const EXECUTABLE =
  process.env.CHROME ??
  globSync(`${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`)
    .sort()
    .pop();

const BASE = process.env.BASE ?? "http://localhost:3000";
const API = process.env.API ?? "http://localhost:8000/api/v1";
const OUT = process.env.SHOTS ?? "invoice-select-all-shots";
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "admin@bahr.local";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? "password";
mkdirSync(OUT, { recursive: true });

async function login(email, password) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.status === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    const { token } = await response.json();
    if (!token) throw new Error(`login failed for ${email}`);
    return token;
  }
}

const TOKEN = await login(STAFF_EMAIL, STAFF_PASSWORD);
const get = async (path) =>
  (await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  })).json();

const clients = (await get("/invoices/clients")).data;
const target = clients[0];
console.log(`picker: ${clients.length} clients; first = ${target.name} (${target.billable_count} to bill)`);

const errors = [];
const browser = await chromium.launch({ executablePath: EXECUTABLE });

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
  await ctx.addInitScript(
    ([token, scheme]) => {
      localStorage.setItem("bahr_token", token);
      localStorage.setItem("theme", scheme);
    },
    [TOKEN, theme],
  );
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/invoices`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "فاتورة جديدة" }).click();
  await page.locator("#inv-client").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${theme}-1-picker.png` });

  await page.getByRole("option").first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${theme}-2-client-picked.png` });

  const selectAll = page.getByRole("checkbox", { name: "تحديد الكل" });
  await selectAll.check();
  await page.waitForTimeout(200);
  const rows = page.locator("ul input[type=checkbox]");
  const checked = await rows.evaluateAll((inputs) => inputs.filter((i) => i.checked).length);
  console.log(`${theme}: select all ticked ${checked} of ${await rows.count()}`);
  await page.screenshot({ path: `${OUT}/${theme}-3-all-selected.png` });

  // Untick one: the header goes to "some" (indeterminate), not stuck on "all".
  await rows.first().uncheck();
  const indeterminate = await selectAll.evaluate((input) => input.indeterminate);
  console.log(`${theme}: after unticking one, header indeterminate = ${indeterminate}`);
  await page.screenshot({ path: `${OUT}/${theme}-4-partial.png` });

  // Clicking the partial header selects everything again; once more clears it.
  await selectAll.click();
  await selectAll.click();
  const left = await rows.evaluateAll((inputs) => inputs.filter((i) => i.checked).length);
  console.log(`${theme}: after select-all then clear, ${left} ticked`);
  await page.keyboard.press("Escape");

  // The client file: every invoice, each with the files it bills.
  const billed = (await get("/invoices?per_page=1")).data[0];
  if (billed?.client) {
    await page.goto(`${BASE}/clients/${billed.client.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${theme}-5-client-file.png`, fullPage: true });
  }

  await ctx.close();
}

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
