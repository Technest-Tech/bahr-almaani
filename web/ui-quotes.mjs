import { chromium } from "playwright-core";

const OUT = process.env.SHOTS ?? "/tmp/quote-shots";
const BASE = "http://localhost:3000";

const browser = await chromium.launch({
  executablePath:
    "/Users/ahmedomar/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  headless: true,
});

/** Pages anyone on the internet reaches — no session. */
const PUBLIC_PAGES = [
  { name: "landing", path: "/" },
  { name: "request", path: "/request" },
  { name: "track-quoted", path: "/track?ref=RQ-D7EF-7BKX" },
  { name: "track-new", path: "/track?ref=RQ-AJSH-6YV9" },
];

/** Panel pages behind the login wall. */
const PANEL_PAGES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "quotes-list", path: "/quotes" },
  { name: "quote-detail-quoted", path: "/quotes/3" },
  { name: "quote-detail-new", path: "/quotes/1" },
];

const problems = [];

async function audit(page, label) {
  const report = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const wide = [];
    document.querySelectorAll("body *").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > docWidth + 2 || rect.left < -2)) {
        wide.push({
          tag: el.tagName,
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 70),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        });
      }
    });
    return {
      horizontalScroll: document.documentElement.scrollWidth > docWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: docWidth,
      overflowing: wide.slice(0, 4),
    };
  });
  if (report.horizontalScroll) problems.push({ label, ...report });
  return report;
}

for (const theme of ["light", "dark"]) {
  // ── Public site: a fresh context, so no token leaks in from the panel run.
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  const page = await publicContext.newPage();

  for (const target of PUBLIC_PAGES) {
    await page.goto(BASE + target.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const report = await audit(page, `${theme}/${target.name}`);
    console.log(theme, target.name, JSON.stringify(report));
    await page.screenshot({ path: `${OUT}/${theme}-${target.name}.png`, fullPage: true });
  }

  // Mobile pass over the landing page and the form.
  const mobile = await publicContext.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  for (const target of [PUBLIC_PAGES[0], PUBLIC_PAGES[1]]) {
    await mobile.goto(BASE + target.path, { waitUntil: "networkidle" });
    await mobile.waitForTimeout(900);
    const report = await audit(mobile, `${theme}/mobile-${target.name}`);
    console.log(theme, "mobile", target.name, JSON.stringify(report));
    await mobile.screenshot({ path: `${OUT}/${theme}-mobile-${target.name}.png`, fullPage: true });
  }
  await publicContext.close();

  // ── Panel: log in once, then walk the quote screens.
  const panelContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  const panel = await panelContext.newPage();
  // /auth/login is throttled to 5/min; back off and retry rather than failing the run.
  for (let attempt = 1; ; attempt++) {
    await panel.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await panel.locator('input[type="email"]').first().fill("admin@bahr.local");
    await panel.locator('input[type="password"]').first().fill("password");
    await panel.locator('button[type="submit"]').first().click();
    try {
      await panel.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 12000 });
      break;
    } catch {
      if (attempt >= 4) throw new Error("login kept failing — is the API up?");
      console.log(`login attempt ${attempt} failed (likely throttled) — waiting 65s`);
      await panel.waitForTimeout(65000);
    }
  }
  await panel.waitForTimeout(2500);

  for (const target of PANEL_PAGES) {
    await panel.goto(BASE + target.path, { waitUntil: "networkidle" });
    await panel.waitForTimeout(2000);
    const report = await audit(panel, `${theme}/${target.name}`);
    console.log(theme, target.name, JSON.stringify(report));
    await panel.screenshot({ path: `${OUT}/${theme}-${target.name}.png`, fullPage: true });
  }
  await panelContext.close();
}

await browser.close();

console.log("\n== horizontal overflow ==");
console.log(problems.length ? JSON.stringify(problems, null, 2) : "none");
