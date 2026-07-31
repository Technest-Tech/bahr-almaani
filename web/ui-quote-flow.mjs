import { chromium } from "playwright-core";

/**
 * End-to-end walk of the staff side of M13: price a request, record the client's
 * approval, then convert it into a draft project — clicking the real UI.
 *
 * Pass the quote id as argv[2] (defaults to 1, the seeded request with attachments).
 */
const OUT = process.env.SHOTS ?? "/tmp/quote-shots";
const BASE = "http://localhost:3000";
const QUOTE_ID = process.argv[2] ?? "1";

const browser = await chromium.launch({
  executablePath:
    "/Users/ahmedomar/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  headless: true,
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.log("CONSOLE ERROR:", message.text().slice(0, 200));
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.locator('input[type="email"]').first().fill("pm@bahr.local");
await page.locator('input[type="password"]').first().fill("password");
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/quotes/${QUOTE_ID}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

/** Click a button only if this request is still at the step that offers it. */
async function step(label, action) {
  const button = page.getByRole("button", { name: label });
  if ((await button.count()) === 0) {
    console.log(`skip "${label}" — already past this step`);
    return false;
  }
  await button.first().click();
  await action?.();
  return true;
}

// 1 — take it off the "new" pile.
if (await step("بدء الدراسة")) {
  await page.waitForTimeout(1500);
  console.log("status after بدء الدراسة:", await badge(page));
}

// 2 — price it.
if (
  await step(/^(إرسال عرض السعر|تعديل العرض)$/, async () => {
    await page.waitForTimeout(700);
    await page.locator("#r-amount").fill("6750");
    await page.locator("#r-days").fill("4");
    await page
      .locator("#r-note")
      .fill("السعر يشمل التصديق والختم على كل صفحة، وتسليم نسخة إلكترونية ونسختين ورقيتين.");
    await page.screenshot({ path: `${OUT}/flow-1-respond-dialog.png` });
    await page.getByRole("button", { name: /^(إرسال العرض|حفظ وإعادة الإرسال)$/ }).click();
    await page.waitForTimeout(2500);
  })
) {
  console.log("status after respond:", await badge(page));
}

// 3 — the client says yes.
if (await step("العميل وافق")) {
  await page.waitForTimeout(1800);
  console.log("status after accept:", await badge(page));
}
await page.screenshot({ path: `${OUT}/flow-2-accepted.png`, fullPage: true });

// 4 — convert into a draft project.
await page.getByRole("button", { name: "تحويل إلى مشروع" }).click();
await page.waitForTimeout(1200);
await page.locator("#c-deadline").click();
await page.waitForTimeout(600);
// Jump a month ahead, then take the first selectable day — the calendar renders
// Arabic-Indic numerals, so matching a day by its Latin label never works.
await page.locator('button[class*="rdp"][class*="next"], .rdp-button_next').first().click();
await page.waitForTimeout(500);
await page
  .locator('.rdp-day:not([disabled]) button, button.rdp-day_button:not([disabled])')
  .first()
  .click();
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
console.log("deadline set to:", await page.locator("#c-deadline").textContent());
await page.screenshot({ path: `${OUT}/flow-3-convert-dialog.png` });

await page.getByRole("button", { name: "إنشاء المشروع" }).click();
await page.waitForURL(/\/projects\/\d+$/, { timeout: 20000 });
await page.waitForTimeout(2500);
console.log("landed on:", page.url());
await page.screenshot({ path: `${OUT}/flow-4-created-project.png`, fullPage: true });

// 5 — the request is now locked and linked.
await page.goto(`${BASE}/quotes/${QUOTE_ID}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log("final quote status:", await badge(page));
await page.screenshot({ path: `${OUT}/flow-5-quote-converted.png`, fullPage: true });

await browser.close();

async function badge(target) {
  return (await target.locator("span.inline-flex.items-center.gap-1").first().textContent())?.trim();
}
