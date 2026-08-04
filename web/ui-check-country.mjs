import { chromium } from "playwright-core";

const OUT =
  "/private/tmp/claude-501/-Users-ahmedomar-Documents-technest-bahr-almaaani/15d6a967-e0f1-4ef3-bfe1-0e8bf85e9b10/scratchpad";

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
  page.on("console", (m) => {
    if (m.type() === "error") console.log(theme, "CONSOLE-ERR", m.text().slice(0, 200));
  });

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000); // let the client bundle hydrate before typing
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('input[type="email"], input[name="email"]').first().fill("admin@bahr.local");
    await page.locator('input[type="password"], input[name="password"]').first().fill("password");
    await page.locator('button[type="submit"]').first().click();
    try {
      await page.waitForFunction(() => !location.pathname.includes("/login"), null, {
        timeout: 15000,
      });
      break;
    } catch {
      console.log(theme, "login retry", attempt, await page.locator("body").innerText().then((t) => t.replace(/\s+/g, " ").slice(0, 160)));
    }
  }

  await page.goto("http://localhost:3000/projects/new", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/country-${theme}-1-closed.png` });

  // open the country combobox
  await page.locator("#p-country").click();
  await page.waitForTimeout(400);
  const total = await page.locator("[cmdk-item]").count();
  await page.screenshot({ path: `${OUT}/country-${theme}-2-open.png` });

  // type like a user — cmdk re-filters and re-sorts per keystroke
  const search = async (term) => {
    await page.locator("[cmdk-input]").fill("");
    await page.waitForTimeout(250);
    await page.locator("[cmdk-input]").pressSequentially(term, { delay: 80 });
    await page.waitForTimeout(600);
    return page.locator("[cmdk-item]").allInnerTexts();
  };

  // search in Arabic
  const arItems = await search("مصر");
  await page.screenshot({ path: `${OUT}/country-${theme}-3-search-ar.png` });

  // search in English
  const enItems = await search("united");
  await page.screenshot({ path: `${OUT}/country-${theme}-4-search-en.png` });

  // search by ISO code — the exact code must rank first
  const egItems = await search("EG");
  const codeItems = await search("DE");

  // pick Germany, then confirm the trigger shows the Arabic name
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(400);
  const trigger = await page.locator("#p-country").innerText();
  await page.screenshot({ path: `${OUT}/country-${theme}-5-selected.png` });

  // horizontal overflow check (RTL layout)
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));

  console.log(
    theme,
    JSON.stringify(
      {
        total,
        arItems: arItems.map((t) => t.replace(/\s+/g, " ")),
        enItems: enItems.map((t) => t.replace(/\s+/g, " ")),
        egFirst: egItems[0]?.replace(/\s+/g, " "),
        codeItems: codeItems.map((t) => t.replace(/\s+/g, " ")).slice(0, 3),
        trigger: trigger.replace(/\s+/g, " "),
        overflow,
      },
      null,
      0,
    ),
  );

  await page.close();
}

await browser.close();
