import { chromium } from "playwright-core";

const OUT =
  "/private/tmp/claude-501/-Users-ahmedomar-Documents-technest-bahr-almaaani/01a27cc8-bf37-4f29-80dd-8e8eec19571f/scratchpad";

const browser = await chromium.launch({
  executablePath:
    "/Users/ahmedomar/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  headless: true,
});

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.locator('input[type="email"], input[name="email"]').first().fill("admin@bahr.local");
  await page.locator('input[type="password"], input[name="password"]').first().fill("password");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const m = await page.evaluate(() => {
    const overflow = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      const b = r.bottom + window.scrollY;
      const p = el.parentElement;
      const pb = p ? p.getBoundingClientRect().bottom + window.scrollY : 0;
      if (b > document.body.getBoundingClientRect().height + 4 && r.height > 0 && pb <= b - 1) {
        overflow.push({
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
          tag: el.tagName,
          bottom: Math.round(b),
        });
      }
    });
    return {
      viewport: window.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
      bodyHeight: Math.round(document.body.getBoundingClientRect().height),
      verticallyScrollable:
        document.documentElement.scrollHeight > window.innerHeight + 1,
      overflow: overflow.slice(0, 5),
    };
  });
  console.log(theme, JSON.stringify(m));

  await page.screenshot({ path: `${OUT}/fixed-${theme}-full.png`, fullPage: true });

  // also check a long page still scrolls normally
  await page.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const p = await page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    bodyHeight: Math.round(document.body.getBoundingClientRect().height),
  }));
  console.log(theme, "projects", JSON.stringify(p));
  await page.screenshot({ path: `${OUT}/fixed-${theme}-projects.png`, fullPage: true });
  await page.close();
}

await browser.close();
