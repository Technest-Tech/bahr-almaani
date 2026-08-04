import { chromium } from "playwright-core";

const OUT = process.env.OUT ?? "/tmp";
const BASE = process.env.BASE ?? "http://localhost:3000";

const browser = await chromium.launch({
  executablePath:
    "/Users/ahmedomar/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  headless: true,
});

const errors = [];

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"], input[name="password"]').first().fill("password");
    await page.locator('button[type="submit"]').first().click();
    try {
      await page.waitForFunction(() => !location.pathname.includes("/login"), null, { timeout: 15000 });
      return;
    } catch {
      console.log("login retry", email, attempt);
    }
  }
  throw new Error(`could not log in as ${email}`);
}

async function newPage(theme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${theme} ${m.text().slice(0, 200)}`);
  });
  return page;
}

for (const theme of ["light", "dark"]) {
  // ---- translator: the daily log screen ----
  let page = await newPage(theme);
  await login(page, "translator1@bahr.local");
  await page.goto(`${BASE}/daily-words`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/dw-${theme}-1-translator.png`, fullPage: true });

  // type a new day and blur — the save path a translator actually uses
  const inputs = page.locator("tbody tr input[type='number']:not([disabled])");
  const count = await inputs.count();
  if (count > 0) {
    const target = inputs.nth(Math.min(4, count - 1));
    await target.fill("2750");
    await target.blur();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/dw-${theme}-2-after-save.png`, fullPage: true });
    console.log(theme, "editable day inputs:", count);
  } else {
    console.log(theme, "NO editable inputs found");
  }
  await page.close();

  // ---- accountant: the two new reports ----
  page = await newPage(theme);
  await login(page, "accountant@bahr.local");
  await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  await page.getByRole("button", { name: "الإنتاجية مقابل التارجت" }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/dw-${theme}-3-report-productivity.png`, fullPage: true });

  await page.getByRole("button", { name: "الكلمات اليومية" }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/dw-${theme}-4-report-daily.png`, fullPage: true });
  await page.close();
}

// ---- admin: the monthly target field on the user form ----
const page = await newPage("light");
await login(page, "admin@bahr.local");
await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.locator("table tbody tr").filter({ hasText: "سارة" }).locator("button").first().click();
await page.waitForTimeout(800);
await page.getByText("تعديل البيانات").click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/dw-light-5-user-target.png` });
await page.close();

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
