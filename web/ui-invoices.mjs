/**
 * Walk the invoicing window (change request 2026-09-05): pick the client, the
 * billable list brings the delivered page counts, type a per-page price, the
 * invoice is issued — then render the generated PDF itself for inspection.
 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

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

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("bahr_token", t), token);

await page.goto("http://localhost:3000/invoices", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/invoices-list.png` });

// New invoice: client → billable projects appear with their page counts.
await page.getByRole("button", { name: "فاتورة جديدة" }).click();
await page.waitForTimeout(500);
await page.locator("#inv-client").click();
await page.getByRole("option", { name: "سفارة دولة الإمارات" }).first().click();
await page.waitForTimeout(1500);

// Bill every listed project.
const boxes = page.locator('input[type="checkbox"]');
const count = await boxes.count();
for (let i = 0; i < count; i++) await boxes.nth(i).check();
console.log("billable projects selected:", count);

await page.locator("#inv-unit").fill("150");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/invoice-dialog.png` });

await page.getByRole("button", { name: "إصدار الفاتورة" }).click();
await page.waitForTimeout(6000); // Gotenberg render + list refresh
await page.screenshot({ path: `${OUT}/invoices-after.png` });

// Pull the issued invoice's PDF through the API and rasterize its first page.
const invoices = (await (await fetch(`${API}/invoices`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
})).json()).data;
console.log("invoices:", invoices.map((i) => `${i.number} = ${i.amount} ${i.currency} / ${i.total_pages} صفحة`));

if (invoices[0]) {
  const pdf = await (await fetch(`${API}/invoices/${invoices[0].id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })).arrayBuffer();
  const pdfPath = `${OUT}/invoice.pdf`;
  writeFileSync(pdfPath, Buffer.from(pdf));
  execFileSync("/opt/homebrew/bin/gs", [
    "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER",
    "-sDEVICE=png16m", "-r110",
    "-dFirstPage=1", "-dLastPage=1",
    `-sOutputFile=${OUT}/invoice-pdf.png`,
    pdfPath,
  ]);
  console.log("rendered invoice PDF to invoice-pdf.png");
}

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
